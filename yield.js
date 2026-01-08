// === yieldFarming.js ===

import { ethers } from "ethers";
import dotenv from "dotenv";
import { DEFI_PROTOCOLS, TOKENS, BOT_CONFIG } from "./config.js";
import { log, formatUSD, retryWithBackoff } from "./utils.js";
import { getProvider, getWallet, executeWithFallback } from "./rpc_manager.js";

dotenv.config();

// ABI Aave V3 Pool (simplifié)
const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
];

// ABI ERC20
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

/**
 * Dépose de l'USDC sur Aave pour générer du yield
 */
export async function depositToAave(amountUSDC) {
  if (!BOT_CONFIG.ENABLE_YIELD_FARMING) {
    log('INFO', 'Yield farming désactivé dans la config');
    return null;
  }

  const aaveConfig = DEFI_PROTOCOLS.AAVE_V3_BASE;

  if (!aaveConfig.enabled) {
    log('INFO', 'Aave désactivé dans la config');
    return null;
  }

  if (amountUSDC < aaveConfig.minDeposit) {
    log('INFO', `Montant trop faible pour déposer sur Aave: ${formatUSD(amountUSDC)} < ${formatUSD(aaveConfig.minDeposit)}`);
    return null;
  }

  try {
    log('INFO', `Dépôt de ${formatUSD(amountUSDC)} USDC sur Aave...`);

    const usdcToken = TOKENS.USDC;
    const amountInUnits = BigInt(Math.floor(amountUSDC * 10 ** usdcToken.decimals));

    // Mode dry-run
    if (BOT_CONFIG.DRY_RUN) {
      log('INFO', '[DRY RUN] Dépôt Aave simulé ✅');
      return { dryRun: true, amount: amountUSDC };
    }


    return await executeWithFallback(async () => {
      const wallet = getWallet();
      const provider = getProvider();

      // Créer les contrats
      const usdcContract = new ethers.Contract(usdcToken.address, ERC20_ABI, wallet);
      const aavePool = new ethers.Contract(aaveConfig.poolAddress, AAVE_POOL_ABI, wallet);

      // Vérifier l'allowance
      const currentAllowance = await usdcContract.allowance(wallet.address, aaveConfig.poolAddress);

      if (BigInt(currentAllowance) < amountInUnits) {
        log('INFO', 'Approbation USDC pour Aave...');
        const approveTx = await usdcContract.approve(aaveConfig.poolAddress, ethers.MaxUint256);
        await approveTx.wait();
        log('SUCCESS', 'Approbation confirmée ✅');
      }

      // Déposer sur Aave
      const supplyTx = await retryWithBackoff(
        () => aavePool.supply(
          usdcToken.address,
          amountInUnits,
          wallet.address,
          0 // referral code
        ),
        2,
        3000,
        "Dépôt Aave"
      );

      log('INFO', `Transaction de dépôt envoyée: ${supplyTx.hash}`);
      const receipt = await supplyTx.wait();
      log('SUCCESS', `Dépôt Aave confirmé au bloc ${receipt.blockNumber} ✅`);

      return {
        hash: receipt.hash,
        amount: amountUSDC,
        protocol: 'Aave V3',
        success: true
      };
    });

  } catch (error) {
    log('ERROR', 'Erreur lors du dépôt sur Aave:', { error: error.message });
    throw error;
  }
}

/**
 * Retire de l'USDC depuis Aave
 */
export async function withdrawFromAave(amountUSDC) {
  if (!BOT_CONFIG.ENABLE_YIELD_FARMING) {
    return null;
  }

  const aaveConfig = DEFI_PROTOCOLS.AAVE_V3_BASE;

  if (!aaveConfig.enabled) {
    return null;
  }

  try {
    log('INFO', `Retrait de ${formatUSD(amountUSDC)} USDC depuis Aave...`);

    const usdcToken = TOKENS.USDC;
    const amountInUnits = amountUSDC === -1
      ? ethers.MaxUint256 // Retirer tout
      : BigInt(Math.floor(amountUSDC * 10 ** usdcToken.decimals));

    // Mode dry-run
    if (BOT_CONFIG.DRY_RUN) {
      log('INFO', '[DRY RUN] Retrait Aave simulé ✅');
      return { dryRun: true, amount: amountUSDC };
    }

    return await executeWithFallback(async () => {
      const wallet = getWallet();
      const aavePool = new ethers.Contract(aaveConfig.poolAddress, AAVE_POOL_ABI, wallet);

      // Retirer depuis Aave
      const withdrawTx = await retryWithBackoff(
        () => aavePool.withdraw(
          usdcToken.address,
          amountInUnits,
          wallet.address
        ),
        2,
        3000,
        "Retrait Aave"
      );

      log('INFO', `Transaction de retrait envoyée: ${withdrawTx.hash}`);
      const receipt = await withdrawTx.wait();
      log('SUCCESS', `Retrait Aave confirmé au bloc ${receipt.blockNumber} ✅`);

      return {
        hash: receipt.hash,
        amount: amountUSDC,
        protocol: 'Aave V3',
        success: true
      };
    });

  } catch (error) {
    log('ERROR', 'Erreur lors du retrait depuis Aave:', { error: error.message });
    throw error;
  }
}

/**
 * Récupère la balance USDC sur Aave (aUSDC)
 */
export async function getAaveBalance() {
  const aaveConfig = DEFI_PROTOCOLS.AAVE_V3_BASE;

  if (!aaveConfig.enabled) {
    return 0;
  }

  try {
    return await executeWithFallback(async () => {
      const provider = getProvider();
      const wallet = getWallet();
      const aUSDCContract = new ethers.Contract(aaveConfig.aUSDC, ERC20_ABI, provider);
      const balance = await aUSDCContract.balanceOf(wallet.address);

      return parseFloat(ethers.formatUnits(balance, TOKENS.USDC.decimals));
    });
  } catch (error) {
    log('ERROR', 'Erreur récupération balance Aave:', { error: error.message });
    return 0;
  }
}

/**
 * Récupère les infos du compte sur Aave
 */
export async function getAaveAccountData() {
  const aaveConfig = DEFI_PROTOCOLS.AAVE_V3_BASE;

  if (!aaveConfig.enabled) {
    return null;
  }

  try {
    return await executeWithFallback(async () => {
      const provider = getProvider();
      const wallet = getWallet();
      const aavePool = new ethers.Contract(aaveConfig.poolAddress, AAVE_POOL_ABI, provider);
      const accountData = await aavePool.getUserAccountData(wallet.address);

      return {
        totalCollateralUSD: parseFloat(ethers.formatUnits(accountData[0], 8)), // Base 8 decimals
        totalDebtUSD: parseFloat(ethers.formatUnits(accountData[1], 8)),
        availableBorrowsUSD: parseFloat(ethers.formatUnits(accountData[2], 8)),
        healthFactor: parseFloat(ethers.formatUnits(accountData[5], 18))
      };
    });
  } catch (error) {
    log('ERROR', 'Erreur récupération données Aave:', { error: error.message });
    return null;
  }
}

/**
 * Optimise l'allocation USDC entre wallet et Aave
 */
export async function optimizeUSDCAllocation(currentUSDCBalance, targetUSDCRatio, totalPortfolioValue) {
  if (!BOT_CONFIG.ENABLE_YIELD_FARMING) {
    return { action: 'none', reason: 'Yield farming désactivé' };
  }

  const aaveConfig = DEFI_PROTOCOLS.AAVE_V3_BASE;

  // Calculer combien d'USDC on devrait avoir au total
  const targetUSDCValue = totalPortfolioValue * targetUSDCRatio;

  // Récupérer la balance sur Aave
  const aaveBalance = await getAaveBalance();
  const totalUSDC = currentUSDCBalance + aaveBalance;

  log('INFO', `USDC: Wallet ${currentUSDCBalance.toFixed(2)}, Aave ${aaveBalance.toFixed(2)}, Total ${totalUSDC.toFixed(2)}`);

  // On garde toujours un buffer de liquidité dans le wallet pour les rebalancing
  const bufferRatio = 0.3; // 30% du target en liquidité
  const targetWalletUSDC = targetUSDCValue * bufferRatio;
  const targetAaveUSDC = targetUSDCValue * (1 - bufferRatio);

  // Si on a trop dans le wallet, déposer sur Aave
  if (currentUSDCBalance > targetWalletUSDC + aaveConfig.minDeposit) {
    const amountToDeposit = currentUSDCBalance - targetWalletUSDC;
    return {
      action: 'deposit',
      amount: amountToDeposit,
      reason: `Optimisation yield: déposer ${formatUSD(amountToDeposit)} sur Aave`
    };
  }

  // Si le montant total est trop faible pour Aave
  if (totalUSDC < aaveConfig.minDeposit && aaveBalance === 0) {
    return {
      action: 'none',
      reason: `USDC insuffisant pour Aave (${formatUSD(totalUSDC)} < ${formatUSD(aaveConfig.minDeposit)} minimum)`,
      walletBalance: currentUSDCBalance,
      aaveBalance: aaveBalance
    };
  }

  // Si on n'a pas assez de liquidité dans le wallet, retirer d'Aave
  if (currentUSDCBalance < targetWalletUSDC * 0.5 && aaveBalance > 0) {
    const amountToWithdraw = Math.min(targetWalletUSDC - currentUSDCBalance, aaveBalance);
    return {
      action: 'withdraw',
      amount: amountToWithdraw,
      reason: `Besoin de liquidité: retirer ${formatUSD(amountToWithdraw)} depuis Aave`
    };
  }

  return {
    action: 'none',
    reason: `Allocation USDC optimale (Wallet: ${formatUSD(currentUSDCBalance)}, Aave: ${formatUSD(aaveBalance)})`,
    walletBalance: currentUSDCBalance,
    aaveBalance: aaveBalance
  };
}