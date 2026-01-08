// === prices.js ===

import axios from "axios";
import { COINGECKO_IDS, BOT_CONFIG } from "./config.js";
import { retryWithBackoff, withTimeout, log } from "./utils.js";

// Cache des prix pour éviter les appels répétés
let priceCache = {
    prices: null,
    timestamp: null,
    ttl: 10 * 60 * 1000 // 10 minutes par défaut
};

// Historique des prix pour détecter les anomalies
let priceHistory = [];
const MAX_HISTORY_LENGTH = 24; // 24h d'historique (si appelé toutes les heures)

/**
 * Récupère les prix USD des tokens via CoinGecko
 * @param {boolean} useCache - Utiliser le cache si disponible
 * @returns {Object|null} Exemple : { BTC: 68000, ETH: 3200, USDC: 1 }
 */
export async function getPrices(useCache = true) {
    // Vérifier le cache
    if (useCache && priceCache.prices && priceCache.timestamp) {
        const age = Date.now() - priceCache.timestamp;
        if (age < priceCache.ttl) {
            log('INFO', `Utilisation du cache de prix (âge: ${Math.round(age / 1000)}s)`);
            return priceCache.prices;
        }
    }

    try {
        const prices = await retryWithBackoff(
            () => fetchPricesFromCoinGecko(),
            3,
            2000,
            "Récupération des prix"
        );

        // Valider les prix
        if (!validatePrices(prices)) {
            throw new Error("Prix invalides détectés");
        }

        // Détecter les anomalies
        if (priceHistory.length > 0) {
            const anomalies = detectPriceAnomalies(prices);
            if (anomalies.length > 0) {
                log('WARN', '⚠️  Anomalies de prix détectées:');
                anomalies.forEach(a => {
                    log('WARN', `   ${a.symbol}: ${a.oldPrice} → ${a.newPrice} (${a.change})`);
                });
            }
        }

        // Mettre à jour le cache et l'historique
        const cacheTTL = BOT_CONFIG.PRICE_CACHE_TTL || 10 * 60 * 1000;
        priceCache = {
            prices,
            timestamp: Date.now(),
            ttl: cacheTTL
        };

        priceHistory.push({
            prices: { ...prices },
            timestamp: Date.now()
        });

        // Limiter la taille de l'historique
        if (priceHistory.length > MAX_HISTORY_LENGTH) {
            priceHistory = priceHistory.slice(-MAX_HISTORY_LENGTH);
        }

        log('INFO', 'Prix récupérés:', prices);
        return prices;

    } catch (error) {
        log('ERROR', 'Échec de récupération des prix:', { error: error.message });

        // En cas d'échec, utiliser les prix du cache si disponibles
        if (priceCache.prices) {
            const cacheAge = Date.now() - priceCache.timestamp;
            if (cacheAge < 30 * 60 * 1000) { // 30 minutes max
                log('WARN', `Utilisation du cache de secours (âge: ${Math.round(cacheAge / 60000)} min)`);
                return priceCache.prices;
            }
        }

        return null;
    }
}

/**
 * Récupère les prix depuis CoinGecko API
 */
async function fetchPricesFromCoinGecko() {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const url = "https://api.coingecko.com/api/v3/simple/price";

    const config = {
        params: {
            ids,
            vs_currencies: "usd",
            include_24hr_change: true,
        },
    };

    if (process.env.COINGECKO_API_KEY) {
        // Pour le plan gratuit, utiliser le header x-cg-demo-api-key
        config.headers = {
            'x-cg-demo-api-key': process.env.COINGECKO_API_KEY
        };
        log('INFO', '🔑 Utilisation de la clé API CoinGecko (Demo)');
    }

    const response = await withTimeout(
        axios.get(url, config),
        10000,
        "Timeout lors de la récupération des prix"
    );

    const data = response.data;
    const prices = {};

    for (const [symbol, coingeckoId] of Object.entries(COINGECKO_IDS)) {
        const priceData = data[coingeckoId];

        if (!priceData || !priceData.usd) {
            throw new Error(`Prix manquant pour ${symbol}`);
        }

        prices[symbol] = priceData.usd;

        // Logger les gros mouvements (> 10% en 24h)
        if (priceData.usd_24h_change) {
            const change = priceData.usd_24h_change;
            if (Math.abs(change) > 10) {
                log('WARN', `${symbol}: Mouvement important en 24h: ${change.toFixed(2)}%`);
            }
        }
    }

    return prices;
}

/**
 * Valide que les prix sont cohérents
 */
function validatePrices(prices) {
    for (const [symbol, price] of Object.entries(prices)) {
        // Prix doit être un nombre positif
        if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
            log('ERROR', `Prix invalide pour ${symbol}: ${price}`);
            return false;
        }

        // Vérifications de sanité mentale
        if (symbol === 'USDC' && (price < 0.95 || price > 1.05)) {
            log('ERROR', `USDC hors de la plage normale: $${price}`);
            return false;
        }

        if (symbol === 'BTC' && price < 10000) {
            log('ERROR', `BTC prix anormalement bas: $${price}`);
            return false;
        }

        if (symbol === 'ETH' && price < 1000) {
            log('ERROR', `ETH prix anormalement bas: $${price}`);
            return false;
        }
    }

    return true;
}

/**
 * Détecte les anomalies de prix par rapport à l'historique
 */
function detectPriceAnomalies(newPrices) {
    if (priceHistory.length === 0) return [];

    const anomalies = [];
    const lastPrices = priceHistory[priceHistory.length - 1].prices;
    const timeDiff = Date.now() - priceHistory[priceHistory.length - 1].timestamp;

    // Si plus de 2h depuis le dernier prix, skip la vérification
    if (timeDiff > 2 * 60 * 60 * 1000) {
        return [];
    }

    for (const [symbol, newPrice] of Object.entries(newPrices)) {
        const oldPrice = lastPrices[symbol];
        if (!oldPrice) continue;

        const change = ((newPrice - oldPrice) / oldPrice) * 100;

        // Mouvement > 20% en moins de 2h = suspect
        if (Math.abs(change) > 20) {
            anomalies.push({
                symbol,
                oldPrice,
                newPrice,
                change: change.toFixed(2) + '%',
                timeDiff: Math.round(timeDiff / 60000) + ' min'
            });
        }
    }

    return anomalies;
}

/**
 * Récupère l'historique des prix
 */
export function getPriceHistory() {
    return [...priceHistory];
}

/**
 * Calcule la volatilité sur l'historique disponible
 */
export function calculateVolatility(symbol) {
    if (priceHistory.length < 3) return 0;

    const prices = priceHistory.map(h => h.prices[symbol]).filter(p => p !== undefined);
    if (prices.length < 3) return 0;

    // Calcul de la volatilité (écart-type des returns)
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    return volatility;
}

/**
 * Calcule un threshold dynamique basé sur la volatilité
 */
export function getDynamicThreshold(baseThreshold = 0.02) {
    const volatilities = Object.keys(COINGECKO_IDS).map(symbol => calculateVolatility(symbol));
    const avgVolatility = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;


    if (avgVolatility < 0.02) {
        return baseThreshold * 1.25;
    } else if (avgVolatility > 0.05) {
        return baseThreshold * 0.75;
    }

    return baseThreshold;
}

/**
 * Clear le cache (utile pour les tests)
 */
export function clearPriceCache() {
    const cacheTTL = BOT_CONFIG.PRICE_CACHE_TTL || 10 * 60 * 1000;
    priceCache.prices = null;
    priceCache.timestamp = null;
    priceCache.ttl = cacheTTL;
    priceHistory = [];
    log('INFO', '🗑️  Cache de prix effacé');
}