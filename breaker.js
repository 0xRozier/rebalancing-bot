// === circuitBreaker.js ===

import { CIRCUIT_BREAKERS } from "./config.js";
import { log, formatUSD, calculatePercentChange } from "./utils.js";
import { sendTelegramMessage } from "./notifier.js";

// Historique des valeurs du portfolio
let portfolioHistory = [];
const MAX_HISTORY_HOURS = 24;

/**
 * Enregistre la valeur actuelle du portfolio dans l'historique
 */
export function recordPortfolioValue(totalValueUSD) {
  portfolioHistory.push({
    value: totalValueUSD,
    timestamp: Date.now()
  });
  
  // Nettoyer l'historique (garder seulement les 24 dernières heures)
  const cutoff = Date.now() - (MAX_HISTORY_HOURS * 60 * 60 * 1000);
  portfolioHistory = portfolioHistory.filter(entry => entry.timestamp > cutoff);
}

/**
 * Vérifie si le portfolio a subi une perte critique
 */
function checkPortfolioDrop(currentValue) {
  const checks = [];
  
  // Vérifier la chute sur 1h
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  const recentHistory = portfolioHistory.filter(entry => entry.timestamp > oneHourAgo);
  
  if (recentHistory.length > 0) {
    const maxRecent = Math.max(...recentHistory.map(e => e.value));
    const drop1h = calculatePercentChange(maxRecent, currentValue);
    
    if (drop1h < -CIRCUIT_BREAKERS.MAX_PORTFOLIO_DROP_1H * 100) {
      checks.push({
        severity: 'CRITICAL',
        message: `Portfolio a chuté de ${Math.abs(drop1h).toFixed(2)}% en 1h (max autorisé: ${CIRCUIT_BREAKERS.MAX_PORTFOLIO_DROP_1H * 100}%)`,
        drop: drop1h,
        period: '1h'
      });
    }
  }
  
  // Vérifier la chute sur 24h
  if (portfolioHistory.length > 0) {
    const max24h = Math.max(...portfolioHistory.map(e => e.value));
    const drop24h = calculatePercentChange(max24h, currentValue);
    
    if (drop24h < -CIRCUIT_BREAKERS.MAX_PORTFOLIO_DROP_24H * 100) {
      checks.push({
        severity: 'CRITICAL',
        message: `Portfolio a chuté de ${Math.abs(drop24h).toFixed(2)}% en 24h (max autorisé: ${CIRCUIT_BREAKERS.MAX_PORTFOLIO_DROP_24H * 100}%)`,
        drop: drop24h,
        period: '24h'
      });
    }
  }
  
  return checks;
}

/**
 * Vérifie si un asset a subi une chute critique
 */
function checkAssetDrops(balances, prices, previousPrices) {
  if (!previousPrices) return [];
  
  const checks = [];
  
  for (const symbol of Object.keys(balances)) {
    if (!previousPrices[symbol]) continue;
    
    const priceChange = calculatePercentChange(previousPrices[symbol], prices[symbol]);
    
    if (priceChange < -CIRCUIT_BREAKERS.MAX_SINGLE_ASSET_DROP * 100) {
      checks.push({
        severity: 'HIGH',
        message: `${symbol} a chuté de ${Math.abs(priceChange).toFixed(2)}% (max autorisé: ${CIRCUIT_BREAKERS.MAX_SINGLE_ASSET_DROP * 100}%)`,
        asset: symbol,
        drop: priceChange
      });
    }
  }
  
  return checks;
}

/**
 * Vérifie si le portfolio est en dessous du minimum
 */
function checkMinimumValue(currentValue) {
  if (currentValue < CIRCUIT_BREAKERS.MIN_PORTFOLIO_VALUE_USD) {
    return {
      severity: 'MEDIUM',
      message: `Portfolio value trop faible: ${formatUSD(currentValue)} < ${formatUSD(CIRCUIT_BREAKERS.MIN_PORTFOLIO_VALUE_USD)}`,
      currentValue,
      minValue: CIRCUIT_BREAKERS.MIN_PORTFOLIO_VALUE_USD
    };
  }
  return null;
}

/**
 * Exécute tous les circuit breakers
 * @returns {Object} { triggered: boolean, checks: [], shouldStop: boolean }
 */
export async function executeCircuitBreakers(balances, prices, totalValueUSD, previousPrices = null) {
  log('INFO', 'Vérification des circuit breakers...');
  
  const allChecks = [];
  let shouldStop = false;
  
  // 1. Enregistrer la valeur actuelle
  recordPortfolioValue(totalValueUSD);
  
  // 2. Vérifier les chutes du portfolio
  const portfolioDrops = checkPortfolioDrop(totalValueUSD);
  allChecks.push(...portfolioDrops);
  
  // 3. Vérifier les chutes d'assets individuels
  const assetDrops = checkAssetDrops(balances, prices, previousPrices);
  allChecks.push(...assetDrops);
  
  // 4. Vérifier la valeur minimum
  const minValueCheck = checkMinimumValue(totalValueUSD);
  if (minValueCheck) {
    allChecks.push(minValueCheck);
  }
  
  // 5. Déterminer si on doit stopper
  const criticalChecks = allChecks.filter(c => c.severity === 'CRITICAL');
  if (criticalChecks.length > 0) {
    shouldStop = true;
    
    // Envoyer une alerte critique
    let alertMessage = '🚨 CIRCUIT BREAKER DÉCLENCHÉ 🚨\n\n';
    alertMessage += `Le bot est ARRÊTÉ pour votre protection.\n\n`;
    alertMessage += `Problèmes détectés:\n`;
    
    for (const check of criticalChecks) {
      alertMessage += `❌ ${check.message}\n`;
    }
    
    alertMessage += `\nValeur actuelle: ${formatUSD(totalValueUSD)}\n`;
    alertMessage += `\n⚠️ Veuillez vérifier votre portfolio et relancer manuellement le bot si tout est normal.`;
    
    await sendTelegramMessage(alertMessage);
    
    log('ERROR', '🚨 CIRCUIT BREAKER DÉCLENCHÉ - BOT ARRÊTÉ');
    for (const check of criticalChecks) {
      log('ERROR', check.message);
    }
  } else if (allChecks.length > 0) {
    // Alertes non-critiques
    log('WARN', `${allChecks.length} avertissement(s) détecté(s):`);
    for (const check of allChecks) {
      log('WARN', check.message);
    }
  } else {
    log('SUCCESS', 'Circuit breakers: Tous les checks OK ✅');
  }
  
  return {
    triggered: allChecks.length > 0,
    checks: allChecks,
    shouldStop,
    currentValue: totalValueUSD
  };
}

/**
 * Reset les circuit breakers (utile après intervention manuelle)
 */
export function resetCircuitBreakers() {
  portfolioHistory = [];
  log('INFO', 'Circuit breakers réinitialisés');
}

/**
 * Récupère l'historique du portfolio
 */
export function getPortfolioHistory() {
  return [...portfolioHistory];
}

/**
 * Récupère les statistiques du portfolio
 */
export function getPortfolioStats() {
  if (portfolioHistory.length === 0) {
    return null;
  }
  
  const values = portfolioHistory.map(e => e.value);
  const currentValue = values[values.length - 1];
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const firstValue = values[0];
  
  return {
    current: currentValue,
    max: maxValue,
    min: minValue,
    first: firstValue,
    change: calculatePercentChange(firstValue, currentValue),
    drawdown: calculatePercentChange(maxValue, currentValue),
    dataPoints: portfolioHistory.length
  };
}