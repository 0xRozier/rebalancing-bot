// === pnl.js ===

import fs from "fs";
import path from "path";
import { log } from "./utils.js";

const DATA_DIR = path.join(process.cwd(), "data");
const PNL_FILE = path.join(DATA_DIR, "pnl.json");

const MAX_SNAPSHOTS = 1000;
const MAX_TRADES = 500;

let pnlData = null;

/**
 * Initialise le suivi PnL : crée data/ si absent, charge pnl.json ou initialise un objet vide
 */
export function initPnl() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log("INFO", "Dossier data/ créé");
  }

  if (fs.existsSync(PNL_FILE)) {
    try {
      const raw = fs.readFileSync(PNL_FILE, "utf-8");
      pnlData = JSON.parse(raw);
      log("INFO", `PnL chargé: ${pnlData.snapshots.length} snapshots, ${pnlData.trades.length} trades`);
    } catch (error) {
      log("WARN", `Erreur lecture pnl.json, réinitialisation: ${error.message}`);
      pnlData = createEmptyPnl();
    }
  } else {
    pnlData = createEmptyPnl();
    log("INFO", "PnL initialisé (vide)");
  }

  return pnlData;
}

function createEmptyPnl() {
  return {
    inception: null,
    snapshots: [],
    trades: [],
    stats: {
      totalTradeCount: 0,
      totalGasCostUSD: 0,
      totalVolumeUSD: 0,
    },
  };
}

/**
 * Écrit pnl.json de manière atomique (tmp + rename)
 */
function savePnl() {
  try {
    const tmpFile = PNL_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(pnlData, null, 2), "utf-8");
    fs.renameSync(tmpFile, PNL_FILE);
  } catch (error) {
    log("ERROR", `Erreur écriture pnl.json: ${error.message}`);
  }
}

/**
 * Enregistre un snapshot du portfolio (appelé à chaque cycle)
 * Fixe inception au premier snapshot
 */
export function recordSnapshot(balances, prices, rebalanced) {
  if (!pnlData) return;

  const assets = {};
  let totalValueUSD = 0;

  for (const [symbol, balance] of Object.entries(balances)) {
    const priceUSD = prices[symbol] || 0;
    const valueUSD = balance * priceUSD;
    assets[symbol] = { balance, priceUSD, valueUSD };
    totalValueUSD += valueUSD;
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    totalValueUSD,
    assets,
    rebalanced,
  };

  // Fixer inception au premier snapshot
  if (!pnlData.inception) {
    pnlData.inception = {
      timestamp: snapshot.timestamp,
      totalValueUSD,
      assets: JSON.parse(JSON.stringify(assets)),
    };
    log("INFO", `PnL inception fixée: $${totalValueUSD.toFixed(2)}`);
  }

  pnlData.snapshots.push(snapshot);

  // FIFO : garder les MAX_SNAPSHOTS derniers
  if (pnlData.snapshots.length > MAX_SNAPSHOTS) {
    pnlData.snapshots = pnlData.snapshots.slice(-MAX_SNAPSHOTS);
  }

  savePnl();
}

/**
 * Enregistre un trade (swap)
 */
export function recordTrade({ from, to, amountUSD, txHash, gasCostUSD, dryRun }) {
  if (!pnlData) return;

  const trade = {
    timestamp: new Date().toISOString(),
    from,
    to,
    amountUSD,
    txHash: txHash || null,
    gasCostUSD: gasCostUSD || 0,
    dryRun: dryRun || false,
  };

  pnlData.trades.push(trade);

  // Mettre à jour les stats agrégées
  pnlData.stats.totalTradeCount++;
  pnlData.stats.totalGasCostUSD += trade.gasCostUSD;
  pnlData.stats.totalVolumeUSD += trade.amountUSD;

  // FIFO : garder les MAX_TRADES derniers
  if (pnlData.trades.length > MAX_TRADES) {
    pnlData.trades = pnlData.trades.slice(-MAX_TRADES);
  }

  savePnl();
}

/**
 * Calcule le PnL total et par asset vs inception
 */
export function getPnlSummary(currentBalances, currentPrices) {
  if (!pnlData || !pnlData.inception) {
    return null;
  }

  const inception = pnlData.inception;

  // Valeur actuelle
  let currentTotalUSD = 0;
  const currentAssets = {};
  for (const [symbol, balance] of Object.entries(currentBalances)) {
    const priceUSD = currentPrices[symbol] || 0;
    const valueUSD = balance * priceUSD;
    currentAssets[symbol] = { balance, priceUSD, valueUSD };
    currentTotalUSD += valueUSD;
  }

  // PnL total
  const totalPnlUSD = currentTotalUSD - inception.totalValueUSD;
  const totalPnlPercent = inception.totalValueUSD > 0
    ? (totalPnlUSD / inception.totalValueUSD) * 100
    : 0;

  // PnL par asset
  const assetPnl = {};
  for (const [symbol, current] of Object.entries(currentAssets)) {
    const inceptionAsset = inception.assets[symbol];
    if (inceptionAsset) {
      assetPnl[symbol] = {
        inceptionValue: inceptionAsset.valueUSD,
        currentValue: current.valueUSD,
        pnlUSD: current.valueUSD - inceptionAsset.valueUSD,
        pnlPercent: inceptionAsset.valueUSD > 0
          ? ((current.valueUSD - inceptionAsset.valueUSD) / inceptionAsset.valueUSD) * 100
          : 0,
      };
    }
  }

  // Durée depuis inception
  const inceptionDate = new Date(inception.timestamp);
  const now = new Date();
  const durationMs = now - inceptionDate;
  const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
  const durationHours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    inception: {
      timestamp: inception.timestamp,
      totalValueUSD: inception.totalValueUSD,
    },
    current: {
      totalValueUSD: currentTotalUSD,
    },
    pnl: {
      totalUSD: totalPnlUSD,
      totalPercent: totalPnlPercent,
    },
    assetPnl,
    duration: {
      days: durationDays,
      hours: durationHours,
      text: `${durationDays}j ${durationHours}h`,
    },
    stats: { ...pnlData.stats },
  };
}

/**
 * Retourne les N derniers trades
 */
export function getTradeHistory(limit = 10) {
  if (!pnlData) return [];
  return pnlData.trades.slice(-limit);
}
