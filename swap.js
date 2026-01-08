// === swap.js ===

import axios from "axios";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { MAX_SLIPPAGE, BOT_CONFIG, COST_LIMITS } from "./config.js";
import { retryWithBackoff, withTimeout, log, formatUSD, estimateGasCostUSD, isSwapViable } from "./utils.js";
import { hasEnoughBalance, getTokenBalanceReal } from "./balances.js";
import { getProvider, getWallet, executeWithFallback } from "./rpc_manager.js";

dotenv.config();

const CHAIN_ID = 8453;
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;

const BASE_API = `https://api.1inch.dev/swap/v5.2/${CHAIN_ID}`;
const HEADERS = {
  accept: "application/json",
  Authorization: `Bearer ${ONEINCH_API_KEY}`,
};

// ABI minimum ERC20
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)"
];

// Adresse spéciale
const ONEINCH_SPENDER = "0x1111111254eeb25477b68fb85ed929f73a960582";

/**
 * S'assure que le token a l'allowance nécessaire pour 1inch
 */
async function ensureAllowance(tokenAddress, amountRequired) {
  try {
    const wallet = getWallet();
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const currentAllowance = await tokenContract.allowance(wallet.address, ONEINCH_SPENDER);

    if (BigInt(currentAllowance) < BigInt(amountRequired)) {
      log('INFO', `Approbation nécessaire pour ${tokenAddress.slice(0, 10)}...`);

      if (BOT_CONFIG.DRY_RUN) {
        log('INFO', '[DRY RUN] Approbation simulée');
        return;
      }

      const tx = await tokenContract.approve(ONEINCH_SPENDER, ethers.MaxUint256);
      log('INFO', `Transaction d'approbation envoyée: ${tx.hash}`);

      await tx.wait();
      log('SUCCESS', 'Approbation confirmée ✅');
    }
  } catch (error) {
    log('ERROR', 'Erreur lors de l\'approbation:', { error: error.message });
    throw error;
  }
}

/**
 * Récupère un quote (estimation) pour un swap
 */
async function getSwapQuote(fromTokenAddress, toTokenAddress, amountInUnits) {
  try {
    const url = `${BASE_API}/quote`;

    const response = await withTimeout(
      axios.get(url, {
        headers: HEADERS,
        params: {
          src: fromTokenAddress,
          dst: toTokenAddress,
          amount: amountInUnits,
        },
      }),
      10000,
      "Timeout lors de la récupération du quote"
    );

    return response.data;
  } catch (error) {
    log('ERROR', 'Erreur lors de la récupération du quote:', {
      error: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

/**
 * Valide qu'un swap est économiquement viable
 */
async function validateSwap(quoteData, swapAmountUSD, ethPriceUSD) {
  return await executeWithFallback(async () => {
    const provider = getProvider();
    const estimatedGas = quoteData.estimatedGas || 300000;
    const gasPrice = await provider.getFeeData();
    const gasPriceGwei = Number(gasPrice.gasPrice) / 1e9;

    const gasCostUSD = estimateGasCostUSD(estimatedGas, gasPriceGwei, ethPriceUSD);

    log('INFO', `Estimation: Gas ${estimatedGas}, Prix ${gasPriceGwei.toFixed(2)} Gwei, Coût ${formatUSD(gasCostUSD)}`);

    // Vérifier que le coût du gas ne dépasse pas le seuil
    const gasCostPercent = gasCostUSD / swapAmountUSD;
    if (gasCostPercent > COST_LIMITS.MAX_GAS_COST_PERCENT) {
      throw new Error(
        `Coût du gas trop élevé: ${(gasCostPercent * 100).toFixed(2)}% du swap (max: ${COST_LIMITS.MAX_GAS_COST_PERCENT * 100}%)`
      );
    }

    // Vérifier que le swap est viable
    if (!isSwapViable(swapAmountUSD, gasCostUSD, COST_LIMITS.MIN_PROFIT_RATIO)) {
      throw new Error(
        `Swap non viable: ${formatUSD(swapAmountUSD)} < ${formatUSD(gasCostUSD * COST_LIMITS.MIN_PROFIT_RATIO)} (coût x${COST_LIMITS.MIN_PROFIT_RATIO})`
      );
    }

    return { gasCostUSD, estimatedGas };
  });
}

/**
 * Exécute un swap avec toutes les protections
 */
export async function executeSwap(
  fromTokenAddress,
  toTokenAddress,
  amountInUnits,
  fromSymbol,
  toSymbol,
  swapAmountUSD,
  ethPriceUSD,
  slippage = MAX_SLIPPAGE
) {
  log('INFO', `Préparation du swap: ${fromSymbol} → ${toSymbol} (${formatUSD(swapAmountUSD)})`);

  try {
    const wallet = getWallet();
    // 1. Calculer le montant en tokens
    const fromTokenDecimals = fromSymbol === 'ETH' ? 18 :
                             fromSymbol === 'BTC' ? 8 :
                             fromSymbol === 'stETH' ? 18 : 6;

    const toTokenDecimals = toSymbol === 'ETH' ? 18 :
                           toSymbol === 'BTC' ? 8 :
                           toSymbol === 'stETH' ? 18 : 6;

    const amountInToken = parseFloat(ethers.formatUnits(amountInUnits, fromTokenDecimals));

    log('INFO', `   Montant: ${amountInToken.toFixed(8)} ${fromSymbol}`);

    // 2. Vérifier la balance
    const hasBalance = await hasEnoughBalance(fromSymbol, amountInToken);

    if (!hasBalance) {
      const actualBalance = await getTokenBalanceReal(fromSymbol);
      throw new Error(`Balance insuffisante: ${actualBalance.toFixed(8)} ${fromSymbol} disponible, ${amountInToken.toFixed(8)} requis`);
    }

    // 3. Récupérer un quote
    log('INFO', 'Récupération du quote...');
    const quoteData = await retryWithBackoff(
      () => getSwapQuote(fromTokenAddress, toTokenAddress, amountInUnits),
      2,
      2000,
      "Quote"
    );

    const estimatedOutput = quoteData.toAmount;
    log('INFO', `Estimation: ${ethers.formatUnits(estimatedOutput, toTokenDecimals)} ${toSymbol}`);

    // 4. Valider que le swap est économiquement viable
    const { gasCostUSD } = await validateSwap(quoteData, swapAmountUSD, ethPriceUSD);

    // 5. Mode dry-run
    if (BOT_CONFIG.DRY_RUN) {
      log('INFO', '[DRY RUN] Swap simulé avec succès ✅');
      log('INFO', `[DRY RUN] Coût estimé: ${formatUSD(gasCostUSD)}`);
      return {
        dryRun: true,
        hash: '0xDRYRUN',
        gasCost: gasCostUSD,
        success: true
      };
    }

    // 6. Assurer l'allowance
    await ensureAllowance(fromTokenAddress, amountInUnits);

    // 7. Récupérer les données de transaction
    log('INFO', 'Récupération des données de swap...');
    const url = `${BASE_API}/swap`;

    const response = await withTimeout(
      axios.get(url, {
        headers: HEADERS,
        params: {
          src: fromTokenAddress,
          dst: toTokenAddress,
          amount: amountInUnits,
          from: wallet.address,
          slippage,
          disableEstimate: false,
          allowPartialFill: false,
        },
      }),
      15000,
      "Timeout lors de la récupération du swap"
    );

    const tx = response.data.tx;

    if (!tx || !tx.to || !tx.data) {
      throw new Error("Données de transaction invalides reçues de 1inch");
    }

    // 8. Envoyer la transaction avec retry
    const txResponse = await executeWithFallback(async () => {
      const currentWallet = getWallet();
      return await retryWithBackoff(
        async () => {
          return await currentWallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : 0n,
            gasLimit: tx.gas ? BigInt(tx.gas) : undefined,
          });
        },
        2,
        3000,
        "Envoi de transaction"
      );
    });

    log('SUCCESS', `Transaction envoyée: ${txResponse.hash}`);

    // 9. Attendre la confirmation
    const receipt = await executeWithFallback(async () => {
      return await txResponse.wait();
    });

    log('SUCCESS', `Confirmée au bloc ${receipt.blockNumber} ✅`);

    // 10. Calculer le coût réel
    const actualGasCost = Number(receipt.gasUsed) * Number(receipt.gasPrice || receipt.effectiveGasPrice);
    const actualGasCostETH = actualGasCost / 1e18;
    const actualGasCostUSD = actualGasCostETH * ethPriceUSD;

    log('INFO', `Coût gas réel: ${actualGasCostETH.toFixed(6)} ETH (${formatUSD(actualGasCostUSD)})`);

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      gasCost: actualGasCostUSD,
      success: receipt.status === 1
    };

  } catch (error) {
    log('ERROR', 'Erreur lors du swap:', {
      from: fromSymbol,
      to: toSymbol,
      amount: swapAmountUSD,
      error: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

/**
 * Estime le coût en gas d'un swap sans l'exécuter
 */
export async function estimateSwapCost(fromTokenAddress, toTokenAddress, amountInUnits, ethPriceUSD) {
  try {
    const quoteData = await getSwapQuote(fromTokenAddress, toTokenAddress, amountInUnits);

    return await executeWithFallback(async () => {
      const provider = getProvider();
      const estimatedGas = quoteData.estimatedGas || 300000;
      const gasPrice = await provider.getFeeData();
      const gasPriceGwei = Number(gasPrice.gasPrice) / 1e9;

      return estimateGasCostUSD(estimatedGas, gasPriceGwei, ethPriceUSD);
    });
  } catch (error) {
    log('ERROR', 'Erreur estimation coût:', { error: error.message });
    return 0;
  }
}