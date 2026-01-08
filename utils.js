// === utils.js ===

import dotenv from "dotenv";
dotenv.config();

// Validation des variables d'environnement au démarrage
export function validateEnv() {
    const required = [
        'PRIVATE_KEY',
        'RPC_URL',
        'ONEINCH_API_KEY',
    ];

    const optional = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHAT_ID',
    ];

    const missing = [];

    for (const key of required) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Variables d'environnement manquantes: ${missing.join(', ')}`);
    }

    // Vérifier le format de la clé privée
    const privateKey = process.env.PRIVATE_KEY;
    const isValid = privateKey.match(/^0x[0-9a-fA-F]{64}$/) || privateKey.match(/^[0-9a-fA-F]{64}$/);
    if (!isValid) {
        throw new Error("Format de PRIVATE_KEY invalide (doit être 64 caractères hex, avec ou sans 0x)");
    }

    // Vérifier l'URL RPC
    if (!process.env.RPC_URL.startsWith('http')) {
        throw new Error("RPC_URL doit commencer par http:// ou https://");
    }

    const missingOptional = optional.filter(key => !process.env[key]);
    if (missingOptional.length > 0) {
        console.warn(`⚠️  Variables optionnelles manquantes: ${missingOptional.join(', ')}`);
        console.warn("   Les notifications Telegram seront désactivées.");
    }

    console.log("✅ Variables d'environnement validées");
}

// Sleep utility avec timeout
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry avec backoff exponentiel
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000, errorMsg = "Opération") {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }

            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.warn(`[RETRY] ${errorMsg} échoué (tentative ${attempt}/${maxRetries}). Nouvelle tentative dans ${delay}ms...`);
            console.warn(`[RETRY] Erreur: ${error.message}`);

            await sleep(delay);
        }
    }
}

// Formattage de nombres avec séparateurs
export function formatNumber(num, decimals = 2) {
    return num.toLocaleString('fr-FR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// Formattage USD
export function formatUSD(amount) {
    return `$${formatNumber(amount, 2)}`;
}

// Calcul du pourcentage de variation
export function calculatePercentChange(oldValue, newValue) {
    if (oldValue === 0) return 0;
    return ((newValue - oldValue) / oldValue) * 100;
}

// Vérifier si une valeur est dans les limites
export function isWithinBounds(value, min, max) {
    return value >= min && value <= max;
}

// Logger avec timestamp
export function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
        'INFO': '✓',
        'WARN': '⚠️',
        'ERROR': '❌',
        'SUCCESS': '✅',
    }[level] || 'ℹ️';

    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

// Calculer le gas cost estimé en USD
export function estimateGasCostUSD(gasUsed, gasPriceGwei, ethPriceUSD) {
    const gasCostETH = (gasUsed * gasPriceGwei) / 1e9;
    return gasCostETH * ethPriceUSD;
}

// Vérifier si un swap est économiquement viable
export function isSwapViable(swapAmountUSD, gasCostUSD, minProfitRatio = 1.2) {
    // Le swap doit valoir au moins minProfitRatio fois le coût du gas
    const minViableAmount = gasCostUSD * minProfitRatio;
    return swapAmountUSD >= minViableAmount;
}

// Créer un résumé du portfolio
export function createPortfolioSummary(balances, prices) {
    const summary = {
        assets: {},
        totalValueUSD: 0,
        timestamp: new Date().toISOString()
    };

    for (const [symbol, balance] of Object.entries(balances)) {
        const valueUSD = balance * prices[symbol];
        summary.assets[symbol] = {
            balance,
            priceUSD: prices[symbol],
            valueUSD,
            percentage: 0 // Calculé après
        };
        summary.totalValueUSD += valueUSD;
    }

    // Calculer les pourcentages
    for (const asset of Object.values(summary.assets)) {
        asset.percentage = (asset.valueUSD / summary.totalValueUSD) * 100;
    }

    return summary;
}

// Calculer la déviation maximale par rapport aux ratios cibles
export function calculateMaxDeviation(balances, prices, targetRatios) {
    const totalValue = Object.entries(balances).reduce(
        (sum, [symbol, balance]) => sum + balance * prices[symbol],
        0
    );

    let maxDeviation = 0;

    for (const [symbol, ratios] of Object.entries(targetRatios)) {
        const currentValue = balances[symbol] * prices[symbol];
        const currentRatio = currentValue / totalValue;
        const deviation = Math.abs(currentRatio - ratios.target);

        if (deviation > maxDeviation) {
            maxDeviation = deviation;
        }
    }

    return maxDeviation;
}

// Vérifier si un asset est en dehors de ses bandes
export function isOutsideBands(currentRatio, targetRatio) {
    return currentRatio < targetRatio.min || currentRatio > targetRatio.max;
}

// Générer un rapport de santé du portfolio
export function generateHealthReport(balances, prices, targetRatios, previousValue = null) {
    const summary = createPortfolioSummary(balances, prices);
    const totalValue = summary.totalValueUSD;

    const report = {
        timestamp: summary.timestamp,
        totalValue: totalValue,
        valueChange: previousValue ? calculatePercentChange(previousValue, totalValue) : null,
        assets: {},
        deviations: [],
        needsRebalancing: false,
        isHealthy: true
    };

    for (const [symbol, asset] of Object.entries(summary.assets)) {
        const target = targetRatios[symbol];
        const currentRatio = asset.percentage / 100;
        const deviation = currentRatio - target.target;
        const isOutside = isOutsideBands(currentRatio, target);

        report.assets[symbol] = {
            balance: asset.balance,
            value: asset.valueUSD,
            currentRatio: currentRatio,
            targetRatio: target.target,
            deviation: deviation,
            deviationPercent: (deviation / target.target) * 100,
            isOutsideBands: isOutside
        };

        if (isOutside) {
            report.needsRebalancing = true;
            report.deviations.push({
                symbol,
                deviation: deviation,
                severity: Math.abs(deviation) / target.target
            });
        }
    }

    // Trier les déviations par sévérité
    report.deviations.sort((a, b) => b.severity - a.severity);

    return report;
}

// Timeout wrapper pour les promesses
export function withTimeout(promise, timeoutMs, errorMessage = "Opération timeout") {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
}