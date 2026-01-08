// === index.js ===

import dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { getPrices, clearPriceCache } from "./prices.js";
import { rebalance } from "./rebalance.js";
import { validateEnv, log, calculateMaxDeviation } from "./utils.js";
import { validateConfig, BOT_CONFIG, TARGET_RATIOS } from "./config.js";
import { sendTelegramMessage } from "./notifier.js";
import { getBalances } from "./balances.js";
import { resetCircuitBreakers } from "./breaker.js";

// Flag pour éviter les exécutions concurrentes
let isRunning = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

global.hasRetriedRPC = false;

/**
 * Fonction principale de rebalancing
 */
async function runRebalancing() {
  if (isRunning) {
    log('WARN', '⏳ Rebalancing déjà en cours, skip...');
    return;
  }

  isRunning = true;
  const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  try {
    log('INFO', `\n${'='.repeat(50)}`);
    log('INFO', `🤖 Rebalancing lancé - ${timestamp}`);
    log('INFO', `${'='.repeat(50)}\n`);

    // Récupérer les prix
    const prices = await getPrices();
    if (!prices) {
      throw new Error('Impossible de récupérer les prix');
    }

    // Exécuter le rebalancing
    await rebalance(prices);

    // Reset le compteur d'erreurs en cas de succès
    consecutiveErrors = 0;
    global.hasRetriedRPC = false;

  } catch (error) {
    log('ERROR', `❌ Exception pendant le rebalancing: ${error.message}`);
    console.error(error);

    await handleRebalancingError(error);

    // Si trop d'erreurs consécutives, envoyer une alerte et arrêter
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const alertMsg = `🚨 ALERTE CRITIQUE\n\n${MAX_CONSECUTIVE_ERRORS} erreurs consécutives détectées.\nLe bot est arrêté pour éviter les problèmes.\n\nDernière erreur: ${error.message}\n\nVeuillez vérifier les logs et relancer manuellement.`;
      await sendTelegramMessage(alertMsg);
      log('ERROR', '🛑 Arrêt du bot après trop d erreurs consécutives');
      process.exit(1);
    }
  } finally {
    isRunning = false;
    log('INFO', `${'='.repeat(50)}`);
    log('INFO', '✓ Cycle terminé\n');
  }
}


/**
 * Gère les erreurs de rebalancing avec retry intelligent
 */
async function handleRebalancingError(error) {
  const isRPCError = 
    error.message?.includes('Balances manquantes') ||
    error.message?.includes('missing revert data') ||
    error.message?.includes('CALL_EXCEPTION') ||
    error.code === 'CALL_EXCEPTION' ||
    error.code === 'UNKNOWN_ERROR';
  
  if (isRPCError && !global.hasRetriedRPC) {
    log('WARN', '⚠️ Erreur RPC détectée, retry dans 3 minutes...');
    
    await sendTelegramMessage(
      `⚠️ Rebalancing échoué (RPC instable)\n\n` +
      `Le bot va réessayer dans 3 minutes avec d'autres RPC.`
    );
    
    global.hasRetriedRPC = true;
    
    // Attendre 3 minutes
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    
    log('INFO', '🔄 Retry du rebalancing après erreur RPC...');
    
    try {
      // Forcer rotation RPC
      const { rotateToNextRPC } = await import('./rpc_manager.js');
      rotateToNextRPC();
      
      // Clear tous les caches
      const { clearBalanceCache } = await import('./balances.js');
      const { clearPriceCache } = await import('./prices.js');
      clearBalanceCache();
      clearPriceCache();
      
      // Retry
      const newPrices = await getPrices(false); // Sans cache
      if (!newPrices) {
        throw new Error('Impossible de récupérer les prix après retry');
      }
      
      await rebalance(newPrices);
      
      log('SUCCESS', '✅ Retry réussi après erreur RPC !');
      consecutiveErrors = 0;
      global.hasRetriedRPC = false;
      
      await sendTelegramMessage('✅ Retry réussi après erreur RPC !');
      
    } catch (retryError) {
      log('ERROR', `❌ Retry échoué: ${retryError.message}`);
      global.hasRetriedRPC = false;
      consecutiveErrors++;
      
      await sendTelegramMessage(
        `❌ Retry échoué après erreur RPC\n\n` +
        `Erreur: ${retryError.message}\n\n` +
        `Le bot réessayera au prochain cycle (2h).`
      );
    }
  } else {
    // Erreur non-RPC ou déjà retry
    consecutiveErrors++;
    global.hasRetriedRPC = false;
  }
}


/**
 * Check d'urgence pour détecter les déviations importantes
 */
async function runEmergencyCheck() {

  if (global.hasRetriedRPC) {
    log('INFO', '⏳ Retry RPC en cours, skip emergency check');
    return;
  }

  if (isRunning) {
    return; // Ne pas interférer si un rebalancing est en cours
  }

  try {
    const prices = await getPrices(true); // Utiliser le cache si disponible
    if (!prices) return;

    const balances = await getBalances(true);

    const missingBalances = Object.entries(balances)
      .filter(([symbol, balance]) => balance === 0 && TARGET_RATIOS[symbol])
      .map(([symbol]) => symbol);
    
    if (missingBalances.length > 0) {
      log('WARN', `⚠️ Emergency check: balances manquantes (${missingBalances.join(', ')}), skip`);
      return; // Ne pas déclencher d'urgence avec des balances fausses !
    }

    const deviation = calculateMaxDeviation(balances, prices, TARGET_RATIOS);

    if (deviation > BOT_CONFIG.EMERGENCY_DEVIATION_THRESHOLD) {
      log('WARN', `⚠️  Déviation importante détectée: ${(deviation * 100).toFixed(2)}%`);
      log('INFO', '🚨 Déclenchement d\'un rebalancing d\'urgence');

      await sendTelegramMessage(
        `⚠️ Rebalancing d'urgence déclenché\n\nDéviation détectée: ${(deviation * 100).toFixed(2)}%\n(Seuil: ${BOT_CONFIG.EMERGENCY_DEVIATION_THRESHOLD * 100}%)`
      );

      await runRebalancing();
    }
  } catch (error) {
    log('ERROR', `Erreur lors du check d'urgence: ${error.message}`);
  }
}

/**
 * Initialisation du bot
 */
async function initialize() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🤖  REBALANCING BOT - DÉMARRAGE');
    console.log('='.repeat(60) + '\n');

    // Validation de l'environnement
    log('INFO', '1️⃣  Validation des variables d\'environnement...');
    validateEnv();

    // Validation de la configuration
    log('INFO', '2️⃣  Validation de la configuration...');
    validateConfig();

    // Mode dry-run
    if (BOT_CONFIG.DRY_RUN) {
      log('WARN', '⚠️  MODE DRY-RUN ACTIVÉ - Aucune transaction ne sera exécutée');
    }

    // Yield farming
    if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
      log('INFO', '💰 Yield farming activé');
    }

    // Afficher la configuration
    log('INFO', '\n📋 Configuration:');
    log('INFO', `   - Rebalancing: toutes les ${BOT_CONFIG.REBALANCE_INTERVAL_HOURS}h`);
    log('INFO', `   - Check d'urgence: toutes les ${BOT_CONFIG.EMERGENCY_CHECK_INTERVAL_MINUTES} min`);
    log('INFO', `   - Seuil d'urgence: ${BOT_CONFIG.EMERGENCY_DEVIATION_THRESHOLD * 100}%`);

    log('INFO', '\n🎯 Ratios cibles:');
    for (const [symbol, ratios] of Object.entries(BOT_CONFIG.TARGET_RATIOS || {})) {
      log('INFO', `   - ${symbol}: ${(ratios.target * 100).toFixed(1)}% (min: ${(ratios.min * 100).toFixed(1)}%, max: ${(ratios.max * 100).toFixed(1)}%)`);
    }

    // Test de connexion
    log('INFO', '\n3️⃣  Test de connexion...');
    const prices = await getPrices(false);
    if (!prices) {
      throw new Error('Impossible de récupérer les prix initiaux');
    }

    const balances = await getBalances(false);
    log('SUCCESS', '   Connexion établie ✅');

    // Envoyer une notification de démarrage
    let startMsg = '🚀 Bot de rebalancing démarré\n\n';
    startMsg += `Mode: ${BOT_CONFIG.DRY_RUN ? 'DRY-RUN (simulation)' : 'PRODUCTION'}\n`;
    startMsg += `Fréquence: ${BOT_CONFIG.REBALANCE_INTERVAL_HOURS}h\n`;
    startMsg += `Yield farming: ${BOT_CONFIG.ENABLE_YIELD_FARMING ? 'Activé ✅' : 'Désactivé'}\n\n`;
    startMsg += `Portfolio initial:\n`;

    let totalValue = 0;
    for (const [symbol, balance] of Object.entries(balances)) {
      const value = balance * prices[symbol];
      totalValue += value;
    }

    for (const [symbol, balance] of Object.entries(balances)) {
      const value = balance * prices[symbol];
      const ratio = (value / totalValue) * 100;
      startMsg += `• ${symbol}: ${balance.toFixed(4)} ($${value.toFixed(2)}) - ${ratio.toFixed(1)}%\n`;
    }

    startMsg += `\nValeur totale: $${totalValue.toFixed(2)}`;

    await sendTelegramMessage(startMsg);

    log('SUCCESS', '\n✅ Initialisation terminée\n');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    log('ERROR', `❌ Erreur lors de l'initialisation: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Gestion de l'arrêt propre
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    log('WARN', `\n⚠️  Signal ${signal} reçu, arrêt du bot...`);

    if (isRunning) {
      log('INFO', 'Attente de la fin du rebalancing en cours...');
      // Attendre maximum 60 secondes
      const maxWait = 60000;
      const startWait = Date.now();

      while (isRunning && (Date.now() - startWait) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await sendTelegramMessage('🛑 Bot arrêté');
    log('SUCCESS', '✅ Arrêt propre du bot');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Point d'entrée principal
 */
async function main() {
  try {
    // Initialisation
    await initialize();

    // Setup graceful shutdown
    setupGracefulShutdown();

    // Lancer une première fois immédiatement
    log('INFO', '🎬 Lancement du premier rebalancing...\n');
    await runRebalancing();

    // Planifier les rebalancing réguliers
    const rebalanceCron = `0 */${BOT_CONFIG.REBALANCE_INTERVAL_HOURS} * * *`;
    log('INFO', `📅 Planification: rebalancing toutes les ${BOT_CONFIG.REBALANCE_INTERVAL_HOURS}h`);
    cron.schedule(rebalanceCron, runRebalancing);

    // Planifier les checks d'urgence
    const emergencyCron = `*/${BOT_CONFIG.EMERGENCY_CHECK_INTERVAL_MINUTES} * * * *`;
    log('INFO', `📅 Planification: check d'urgence toutes les ${BOT_CONFIG.EMERGENCY_CHECK_INTERVAL_MINUTES} min\n`);
    cron.schedule(emergencyCron, runEmergencyCheck);

    log('SUCCESS', '🎯 Bot en cours d\'exécution...\n');

  } catch (error) {
    log('ERROR', `❌ Erreur fatale: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Lancer le bot
main();