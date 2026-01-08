// === balances.js ===

import { ethers } from "ethers";
import dotenv from "dotenv";
import { TOKENS, BOT_CONFIG } from "./config.js";
import { retryWithBackoff, withTimeout, log, sleep } from "./utils.js";
import { getProvider, getWallet, executeWithFallback } from "./rpc_manager.js";


dotenv.config();

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// Cache des balances
let balanceCache = {
    balances: null,
    timestamp: null,
    ttl: 10 * 60 * 1000 // 10 minutes par défaut
};

/**
 * Récupère les balances de tous les tokens
 * @param {boolean} useCache - Utiliser le cache si disponible
 * @returns {Object} Balances de chaque token
 */
export async function getBalances(useCache = true) {
    // Vérifier le cache
    if (useCache && balanceCache.balances && balanceCache.timestamp) {
        const age = Date.now() - balanceCache.timestamp;
        if (age < balanceCache.ttl) {
            log('INFO', `Utilisation du cache de balances (âge: ${Math.round(age / 1000)}s)`);
            return balanceCache.balances;
        }
    }

    const balances = {};
    const errors = [];
    const tokenEntries = Object.entries(TOKENS);

    for (let i = 0; i < tokenEntries.length; i++) {
        const [symbol, token] = tokenEntries[i];
        try {
            const balance = await retryWithBackoff(
                () => getTokenBalance(symbol, token),
                2,
                1000,
                `Balance ${symbol}`
            );
            balances[symbol] = balance;

        } catch (error) {
            log('ERROR', `Erreur lors de la récupération de la balance ${symbol}:`, { error: error.message });
            errors.push({ symbol, error: error.message });
            balances[symbol] = 0;
        }

        if (i < tokenEntries.length - 1) {
            await sleep(BOT_CONFIG.RPC_DELAY_MS || 400); // 400ms entre chaque token
        }

    }


    if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
        try {

            await sleep(BOT_CONFIG.RPC_DELAY_MS || 400);
            const yieldModule = await import('./yield.js');
            const aaveBalance = await yieldModule.getAaveBalance();

            if (aaveBalance > 0) {
                balances.USDC += aaveBalance;
                log('INFO', `💰 USDC total: ${balances.USDC.toFixed(2)} (wallet: ${(balances.USDC - aaveBalance).toFixed(2)}, Aave: ${aaveBalance.toFixed(2)})`);
            }
        } catch (error) {
            log('WARN', `Erreur récupération balance Aave: ${error.message}`);
        }
    }


    // Si trop d'erreurs, ne pas mettre en cache
    if (errors.length === 0) {
        const cacheTTL = BOT_CONFIG.BALANCE_CACHE_TTL || 10 * 60 * 1000;
        balanceCache = {
            balances,
            timestamp: Date.now(),
            ttl: cacheTTL
        };
    } else {
        log('WARN', `${errors.length} erreur(s) lors de la récupération des balances`);
    }

    log('INFO', 'Balances récupérées:', balances);
    return balances;
}

/**
 * Récupère la balance d'un token spécifique
 */
async function getTokenBalance(symbol, token) {

    return await executeWithFallback(async () => {
        const provider = getProvider();
        const wallet = getWallet();
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);

        const rawBalance = await withTimeout(
            contract.balanceOf(wallet.address),
            10000,
            `Timeout balance ${symbol}`
        );

        return parseFloat(ethers.formatUnits(rawBalance, token.decimals));
    });
}

/**
 * Récupère la balance d'un token spécifique sans cache
 */
export async function getTokenBalanceReal(symbol) {
    const token = TOKENS[symbol];
    if (!token) {
        throw new Error(`Token ${symbol} non configuré`);
    }

    return await getTokenBalance(symbol, token);
}

/**
 * Vérifie que le wallet a assez de balance pour un swap
 */
export async function hasEnoughBalance(symbol, amountNeeded) {
    try {
        const balance = await getTokenBalanceReal(symbol);
        const hasEnough = balance >= amountNeeded * 1.01; // +1% de marge de sécurité

        if (!hasEnough) {
            log('WARN', `Balance insuffisante pour ${symbol}: ${balance.toFixed(8)} < ${amountNeeded.toFixed(8)} (+ marge)`);
        }

        return hasEnough;
    } catch (error) {
        log('ERROR', `Erreur vérification balance ${symbol}:`, { error: error.message });
        return false;
    }
}

/**
 * Récupère le gas balance (ETH) pour payer les transactions
 */
export async function getGasBalance() {
    return await executeWithFallback(async () => {
        const provider = getProvider();
        const wallet = getWallet();
        const ethBalance = await provider.getBalance(wallet.address);
        return parseFloat(ethers.formatEther(ethBalance));
    });
}

/**
 * Vérifie que le wallet a assez d'ETH pour payer le gas
 */
export async function hasEnoughGas(estimatedGasCostETH = 0.001) {
    try {
        const gasBalance = await getGasBalance();

        if (gasBalance < estimatedGasCostETH) {
            log('WARN', `⚠️  Gas balance faible: ${gasBalance.toFixed(6)} ETH (minimum recommandé: ${estimatedGasCostETH})`);
            return false;
        }

        return true;
    } catch (error) {
        log('ERROR', 'Erreur vérification gas:', { error: error.message });
        return false;
    }
}

/**
 * Clear le cache (utile pour forcer une mise à jour)
 */
export function clearBalanceCache() {
    const cacheTTL = BOT_CONFIG.BALANCE_CACHE_TTL || 10 * 60 * 1000;
    balanceCache = {
        balances: null,
        timestamp: null,
        ttl: cacheTTL
    };
}

/**
 * Récupère l'adresse du wallet
 */
export function getWalletAddress() {
    return getWallet().address;
}