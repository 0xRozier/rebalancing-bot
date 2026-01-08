// === config.js ===

export const TOKENS = {
    BTC: {
        symbol: "cbBTC",
        address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        decimals: 8
    },
    ETH: {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18
    },
    stETH: {
        symbol: "wstETH",
        address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", // wstETH sur Base
        decimals: 18,
        isYieldBearing: true,
        expectedAPY: 0.035
    },
    USDC: {
        symbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6
    },
};

// Ratios cibles avec bandes de tolérance
export const TARGET_RATIOS = {
    BTC: {
        target: 0.35,
        min: 0.34,
        max: 0.36,
        description: "Bitcoin - Ancre de stabilité"
    },
    ETH: {
        target: 0.20,
        min: 0.195,
        max: 0.205,
        description: "Ethereum - Liquidité"
    },
    stETH: {
        target: 0.25,
        min: 0.245,
        max: 0.255,
        description: "Staked ETH - Yield passif"
    },
    USDC: {
        target: 0.20,
        min: 0.195,
        max: 0.205,
        description: "Stablecoin - Buffer + Yield"
    },
};

// Seuils de rebalancing
export const THRESHOLD = 0.02; // 2% de déviation avant rebalancing
export const MIN_SWAP_USD = 5; // Minimum $5 par swap
export const MAX_SLIPPAGE = 3; // 3% slippage max

// Circuit breakers - Protection contre les mouvements extrêmes
export const CIRCUIT_BREAKERS = {
    MAX_PORTFOLIO_DROP_1H: 0.15, // Si portfolio perd 15% en 1h, stop
    MAX_PORTFOLIO_DROP_24H: 0.30, // Si portfolio perd 30% en 24h, stop
    MAX_SINGLE_ASSET_DROP: 0.40, // Si un asset perd 40%, stop
    MIN_PORTFOLIO_VALUE_USD: 50, // Ne pas rebalancer si portfolio < $50
};

// Configuration des coûts
export const COST_LIMITS = {
    MAX_GAS_COST_PERCENT: 0.05, // Max 5% du swap en gas
    MIN_PROFIT_RATIO: 1.2, // Le gain doit être 1.2x supérieur aux coûts
};

// Protocoles DeFi pour yield farming
export const DEFI_PROTOCOLS = {
    AAVE_V3_BASE: {
        name: "Aave V3",
        poolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Aave Pool sur Base
        aUSDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", // aUSDC token
        enabled: true,
        minDeposit: 20, // Minimum $20 pour déposer
    }
};

// CoinGecko IDs pour les prix
export const COINGECKO_IDS = {
    BTC: "coinbase-wrapped-btc",
    ETH: "weth",
    stETH: "wrapped-steth", // wstETH
    USDC: "usd-coin",
};

// Configuration du bot
export const BOT_CONFIG = {
    REBALANCE_INTERVAL_HOURS: 2, // Rebalancing toutes les 2h
    EMERGENCY_CHECK_INTERVAL_MINUTES: 20, // Check d'urgence toutes les heures
    EMERGENCY_DEVIATION_THRESHOLD: 0.05, // Rebalancing d'urgence si déviation > 5%
    DRY_RUN: false, // Mode simulation (ne pas exécuter les transactions)
    ENABLE_YIELD_FARMING: true, // Activer le yield farming
    RPC_DELAY_MS: 400, // Délai entre appels RPC (ms)
    BALANCE_CACHE_TTL: 10 * 60 * 1000, // Cache balances: 10 minutes
    PRICE_CACHE_TTL: 10 * 60 * 1000, // Cache prix: 10 minutes

    TARGET_RATIOS: TARGET_RATIOS,

};

// Validation de la configuration au démarrage
export function validateConfig() {
    const errors = [];

    // Vérifier que les ratios somment à 1
    const totalRatio = Object.values(TARGET_RATIOS).reduce((sum, r) => sum + r.target, 0);
    if (Math.abs(totalRatio - 1.0) > 0.001) {
        errors.push(`Les ratios cibles doivent sommer à 1.0 (actuellement: ${totalRatio})`);
    }

    // Vérifier que min < target < max
    for (const [symbol, ratios] of Object.entries(TARGET_RATIOS)) {
        if (ratios.min >= ratios.target || ratios.target >= ratios.max) {
            errors.push(`${symbol}: min < target < max non respecté`);
        }
    }

    // Vérifier que tous les tokens ont un CoinGecko ID
    for (const symbol of Object.keys(TOKENS)) {
        if (!COINGECKO_IDS[symbol]) {
            errors.push(`${symbol}: CoinGecko ID manquant`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Erreurs de configuration:\n${errors.join('\n')}`);
    }

    console.log("✅ Configuration validée");
}