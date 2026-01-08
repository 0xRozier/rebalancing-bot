// === rebalance.js ===

import { getBalances, clearBalanceCache } from "./balances.js";
import { executeSwap } from "./swap.js";
import { TARGET_RATIOS, TOKENS, MIN_SWAP_USD, BOT_CONFIG } from "./config.js";
import { sendTelegramMessage } from "./notifier.js";
import { executeCircuitBreakers } from "./breaker.js";
import { optimizeUSDCAllocation, depositToAave, withdrawFromAave } from "./yield.js";
import { getDynamicThreshold } from "./prices.js";
import {
  log,
  formatUSD,
  formatNumber,
  generateHealthReport,
  isOutsideBands,
  sleep
} from "./utils.js";

// Garder les prix précédents pour détecter les mouvements
let previousPrices = null;

function getPortfolioValue(balances, prices) {
  return Object.keys(balances).reduce(
    (total, symbol) => total + balances[symbol] * prices[symbol],
    0
  );
}

/**
 * Fusionne les swaps similaires (même paire from → to)
 */
function mergeSimilarSwaps(swapPlan) {
  const merged = {};

  for (const swap of swapPlan) {
    const key = `${swap.from}-${swap.to}`;

    if (merged[key]) {
      merged[key].amountUSD += swap.amountUSD;
    } else {
      merged[key] = { ...swap };
    }
  }

  return Object.values(merged);
}

/**
 * Calcule le plan optimal de swaps en une seule fois
 */
function calculateOptimalSwaps(balances, prices, totalValue) {
  const currentRatios = {};

  // Calculer les ratios actuels
  for (const symbol of Object.keys(balances)) {
    const value = balances[symbol] * prices[symbol];
    currentRatios[symbol] = value / totalValue;
  }

  // Identifier les assets en dehors des bandes
  const toSell = [];
  const toBuy = [];

  for (const [symbol, currentRatio] of Object.entries(currentRatios)) {
    const targetRatio = TARGET_RATIOS[symbol];

    if (isOutsideBands(currentRatio, targetRatio)) {
      const currentValue = balances[symbol] * prices[symbol];
      const targetValue = targetRatio.target * totalValue;
      const diff = currentValue - targetValue;

      if (diff > 0.1) {
        toSell.push({
          symbol,
          diff,
          priority: Math.abs(diff)
        });
      } else if (diff < -0.1) {
        toBuy.push({
          symbol,
          diff,
          priority: Math.abs(diff)
        });
      }
    }
  }

  // Trier par priorité
  toSell.sort((a, b) => b.priority - a.priority);
  toBuy.sort((a, b) => b.priority - a.priority);

  if (toSell.length === 0 || toBuy.length === 0) {
    return [];
  }

  log('INFO', `Assets à vendre: ${toSell.map(s => s.symbol).join(', ')}`);
  log('INFO', `Assets à acheter: ${toBuy.map(s => s.symbol).join(', ')}`);

  // Calculer TOUS les swaps nécessaires
  const swapPlan = [];
  const sellList = toSell.map(s => ({ ...s }));
  const buyList = toBuy.map(b => ({ ...b }));

  while (sellList.length > 0 && buyList.length > 0) {
    const seller = sellList[0];
    const buyer = buyList[0];

    const amountUSD = Math.min(Math.abs(seller.diff), Math.abs(buyer.diff));

    if (amountUSD > 0.1) {
      swapPlan.push({
        from: seller.symbol,
        to: buyer.symbol,
        amountUSD: amountUSD
      });

      seller.diff -= amountUSD;
      buyer.diff += amountUSD;
    }

    if (Math.abs(seller.diff) < 0.1) sellList.shift();
    if (Math.abs(buyer.diff) < 0.1) buyList.shift();
  }

  // Fusionner les swaps similaires
  const mergedPlan = mergeSimilarSwaps(swapPlan);

  // Filtrer les swaps trop petits APRÈS fusion
  const finalPlan = mergedPlan.filter(swap => swap.amountUSD >= MIN_SWAP_USD);

  log('INFO', `\n📋 Plan de swaps: ${finalPlan.length} swap(s) planifié(s)`);
  for (const swap of finalPlan) {
    log('INFO', `   ${swap.from} → ${swap.to}: ${formatUSD(swap.amountUSD)}`);
  }

  return finalPlan;
}

/**
 * Fonction principale de rebalancing
 */
export async function rebalance(prices) {
  const startTime = Date.now();
  log('INFO', '═══════════════════════════════════════');
  log('INFO', '   DÉBUT DU REBALANCING');
  log('INFO', '═══════════════════════════════════════');

  try {
    // 1. Récupérer les balances
    let balances = await getBalances();

    // Vérifier qu'aucune balance critique n'est à zéro
    const missingBalances = Object.entries(balances)
      .filter(([symbol, balance]) => balance === 0 && TARGET_RATIOS[symbol])
      .map(([symbol]) => symbol);

    if (missingBalances.length > 0) {
      log('WARN', `⚠️ Balances manquantes détectées: ${missingBalances.join(', ')}`);
      log('INFO', `🔄 Tentative de récupération avec cache désactivé...`);
      
      // Retry sans cache après un délai
      clearBalanceCache();
      await sleep(3000);
      balances = await getBalances(false);
      
      // Re-vérifier
      const stillMissing = Object.entries(balances)
        .filter(([symbol, balance]) => balance === 0 && TARGET_RATIOS[symbol])
        .map(([symbol]) => symbol);
      
      if (stillMissing.length > 0) {
        log('ERROR', `❌ Impossible de récupérer certaines balances: ${stillMissing.join(', ')}`);
        log('ERROR', `⚠️ Rebalancing annulé pour éviter des trades erronés`);
        
        await sendTelegramMessage(
          `⚠️ Rebalancing annulé\n\n` +
          `Impossible de récupérer les balances: ${stillMissing.join(', ')}\n` +
          `Problème RPC, réessayera dans 2h.`
        );
        
        throw new Error(`Balances manquantes: ${stillMissing.join(', ')}`);
      }
      
      log('SUCCESS', `✅ Balances récupérées après retry !`);
    }

    const totalValue = getPortfolioValue(balances, prices);

    log('INFO', `💰 Valeur totale du portefeuille: ${formatUSD(totalValue)}`);


    // 1.1. Check du heartbeat (avant même de vérifier si rebalancing nécessaire)
    if (!global.lastHeartbeat) {
      global.lastHeartbeat = 0;
    }
    
    const now = Date.now();
    const timeSinceLastHeartbeat = now - global.lastHeartbeat;
    
    if (timeSinceLastHeartbeat >= 24 * 60 * 60 * 1000) {
      log('INFO', '💚 Envoi du heartbeat quotidien...');
      await sendHeartbeat(balances, prices, totalValue);
    }

    // 2. Générer un rapport de santé
    const healthReport = generateHealthReport(balances, prices, TARGET_RATIOS);

    log('INFO', '\n📊 État actuel du portfolio:');
    for (const [symbol, data] of Object.entries(healthReport.assets)) {
      const status = data.isOutsideBands ? '❌' : '✅';
      log('INFO', `${status} ${symbol}: ${formatNumber(data.balance, 4)} (${formatUSD(data.value)}) - ${(data.currentRatio * 100).toFixed(2)}% (target: ${(data.targetRatio * 100).toFixed(2)}%)`);
    }

    // 3. Circuit breakers
    const circuitBreakerResult = await executeCircuitBreakers(balances, prices, totalValue, previousPrices);

    if (circuitBreakerResult.shouldStop) {
      log('ERROR', '🛑 Rebalancing annulé par les circuit breakers');
      return;
    }

    // 4. Vérifier si un rebalancing est nécessaire
    if (!healthReport.needsRebalancing) {
      log('SUCCESS', '✅ Portfolio équilibré, pas de rebalancing nécessaire');

      // Optimiser l'allocation USDC sur Aave même sans rebalancing
      if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
        log('INFO', '\n💰 Vérification du yield USDC...');

        const { getAaveBalance } = await import('./yield.js');
        const aaveBalance = await getAaveBalance();
        const walletUSDC = balances.USDC - aaveBalance;


        const usdcOptimization = await optimizeUSDCAllocation(
          walletUSDC,
          TARGET_RATIOS.USDC.target,
          totalValue
        );

        log('INFO', `   ${usdcOptimization.reason}`);

        if (usdcOptimization.action === 'deposit') {
          try {
            log('INFO', '   📥 Dépôt sur Aave en cours...');
            await depositToAave(usdcOptimization.amount);
            log('SUCCESS', '   ✅ USDC déposé sur Aave avec succès');
          } catch (error) {
            log('ERROR', `   ❌ Échec du dépôt Aave: ${error.message}`);
          }
        } else if (usdcOptimization.action === 'withdraw') {
          try {
            log('INFO', '   📤 Retrait d\'Aave en cours...');
            await withdrawFromAave(usdcOptimization.amount);
            log('SUCCESS', '   ✅ USDC retiré d\'Aave avec succès');
          } catch (error) {
            log('ERROR', `   ❌ Échec du retrait Aave: ${error.message}`);
          }
        }
      }

      await sendHeartbeat(balances, prices, totalValue);
      return;
    }

    // 5. Calculer le threshold dynamique
    const threshold = getDynamicThreshold();
    log('INFO', `📏 Threshold dynamique: ${(threshold * 100).toFixed(2)}%`);

    // 6. Calculer le plan optimal de swaps
    const swapPlan = calculateOptimalSwaps(balances, prices, totalValue);

    if (swapPlan.length === 0) {
      log('INFO', 'Aucun swap nécessaire après calcul du plan');
      return;
    }

    // 7. Vérifier si besoin de retirer d'Aave avant les swaps
    if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
      const totalUSDCToSwap = swapPlan
        .filter(swap => swap.from === 'USDC')
        .reduce((sum, swap) => sum + swap.amountUSD, 0);
  
      if (totalUSDCToSwap > 0) {
        try {
          const { getAaveBalance, withdrawFromAave } = await import('./yield.js');
          const aaveBalance = await getAaveBalance();
          const walletUSDC = balances.USDC - aaveBalance;
      
          log('INFO', `\n💰 Vérification USDC:`);
          log('INFO', `   Wallet: ${formatUSD(walletUSDC)}, Aave: ${formatUSD(aaveBalance)}`);
          log('INFO', `   Besoin: ${formatUSD(totalUSDCToSwap)}`);
      
          if (walletUSDC < totalUSDCToSwap * 1.01) {
            const amountToWithdraw = Math.min(
              totalUSDCToSwap - walletUSDC + 5,
              aaveBalance
            );
        
            if (amountToWithdraw > 1) {
              log('INFO', `📤 Retrait de ${formatUSD(amountToWithdraw)} depuis Aave...`);
              await withdrawFromAave(amountToWithdraw);
              log('SUCCESS', `✅ Retrait Aave réussi`);
          
              await sleep(3000);
              clearBalanceCache();
              Object.assign(balances, await getBalances());
            }
          }
        } catch (error) {
          log('ERROR', `Erreur gestion Aave: ${error.message}`);
        }
      }
    }

    // 8. Exécuter tous les swaps du plan
    const swaps = [];
    const localBalances = { ...balances };

    for (let i = 0; i < swapPlan.length; i++) {
      const plannedSwap = swapPlan[i];

      log('INFO', `\n═══ SWAP ${i + 1}/${swapPlan.length} ═══`);

      const fromToken = TOKENS[plannedSwap.from];
      const toToken = TOKENS[plannedSwap.to];

      const amountToken = plannedSwap.amountUSD / prices[plannedSwap.from];

      // Appliquer marge de sécurité
      const safetyMargin = 0.995;
      const safeAmountToken = amountToken * safetyMargin;
      const safeAmountUSD = safeAmountToken * prices[plannedSwap.from];

      const amountInUnits = BigInt(
        Math.floor(safeAmountToken * 10 ** fromToken.decimals)
      ).toString();

      // Vérifier balance
      const currentBalance = localBalances[plannedSwap.from];
      if (currentBalance < safeAmountToken * 1.01) {
        log('WARN', `Balance insuffisante pour ${plannedSwap.from}: a ${currentBalance.toFixed(8)}, besoin ${(safeAmountToken * 1.01).toFixed(8)}`);
        log('WARN', `Skip ce swap et continue avec les suivants`);
        continue;
      }

      log('INFO', `🔄 Swap ${plannedSwap.from} → ${plannedSwap.to} pour ${formatUSD(plannedSwap.amountUSD)}`);
      log('INFO', `   Montant: ${safeAmountToken.toFixed(8)} ${plannedSwap.from} (${formatUSD(safeAmountUSD)} après marge)`);

      try {
        const swapResult = await executeSwap(
          fromToken.address,
          toToken.address,
          amountInUnits,
          plannedSwap.from,
          plannedSwap.to,
          safeAmountUSD,
          prices.ETH
        );

        swaps.push({
          from: plannedSwap.from,
          to: plannedSwap.to,
          usd: safeAmountUSD,
          hash: swapResult.hash,
          gasCost: swapResult.gasCost,
          dryRun: swapResult.dryRun || false
        });

        // Mettre à jour balances locales
        localBalances[plannedSwap.from] -= safeAmountToken;
        localBalances[plannedSwap.to] += (safeAmountToken * prices[plannedSwap.from]) / prices[plannedSwap.to];

        log('SUCCESS', `✅ Swap réussi !`);

        if (!BOT_CONFIG.DRY_RUN && i < swapPlan.length - 1) {
          log('INFO', `⏳ Attente 5s avant prochain swap...`);
          await sleep(5000);
        }

      } catch (error) {
        log('ERROR', `❌ Échec du swap: ${error.message}`);
        await sendFailureNotification(swaps, error);
        throw error;
      }
    }

    log('INFO', `\n✅ ${swaps.length}/${swapPlan.length} swap(s) exécuté(s) avec succès`);

    // 9. Récupérer les nouvelles balances
    clearBalanceCache();
    const updatedBalances = await getBalances();
    const updatedTotalValue = getPortfolioValue(updatedBalances, prices);

    // 10. Optimiser l'allocation USDC après rebalancing
    if (BOT_CONFIG.ENABLE_YIELD_FARMING && swaps.length > 0) {
      log('INFO', '\n💰 Optimisation du yield USDC...');

      const { getAaveBalance } = await import('./yield.js');
      const aaveBalance = await getAaveBalance();
      const walletUSDC = updatedBalances.USDC - aaveBalance;


      const usdcOptimization = await optimizeUSDCAllocation(
        walletUSDC,
        TARGET_RATIOS.USDC.target,
        updatedTotalValue
      );

      log('INFO', `   ${usdcOptimization.reason}`);

      if (usdcOptimization.action === 'deposit') {
        try {
          log('INFO', '   📥 Dépôt sur Aave en cours...');
          await depositToAave(usdcOptimization.amount);
          log('SUCCESS', '   ✅ USDC déposé sur Aave avec succès');
        } catch (error) {
          log('ERROR', `   ❌ Échec du dépôt Aave: ${error.message}`);
        }
      } else if (usdcOptimization.action === 'withdraw') {
        try {
          log('INFO', '   📤 Retrait d\'Aave en cours...');
          await withdrawFromAave(usdcOptimization.amount);
          log('SUCCESS', '   ✅ USDC retiré d\'Aave avec succès');
        } catch (error) {
          log('ERROR', `   ❌ Échec du retrait Aave: ${error.message}`);
        }
      }
    }

    // 11. Envoyer le résumé
    await sendSuccessNotification(swaps, updatedBalances, prices, updatedTotalValue);

    // 12. Mettre à jour les prix précédents
    previousPrices = { ...prices };

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log('SUCCESS', `\n✅ Rebalancing terminé en ${duration}s`);
    log('INFO', '═══════════════════════════════════════\n');

  } catch (error) {
    log('ERROR', '❌ Erreur pendant le rebalancing:', { error: error.message });
    log('INFO', '═══════════════════════════════════════\n');
    throw error;
  }
}

/**
 * Envoie une notification de succès
 */
async function sendSuccessNotification(swaps, balances, prices, totalValue) {
  if (swaps.length === 0) {
    return;
  }

  let message = `✅ Rebalancing effectué (${swaps.length} swap${swaps.length > 1 ? 's' : ''})\n\n`;

  let totalGasCost = 0;
  for (const swap of swaps) {
    const icon = swap.dryRun ? '🔍' : '💱';
    message += `${icon} ${swap.from} → ${swap.to}: ${formatUSD(swap.usd)}\n`;
    if (!swap.dryRun) {
      message += `   Gas: ${formatUSD(swap.gasCost)}\n`;
      totalGasCost += swap.gasCost;
    }
  }

  if (totalGasCost > 0) {
    message += `\n💸 Coût total gas: ${formatUSD(totalGasCost)}\n`;
  }

  message += `\n📊 Nouveau portefeuille:\n`;
  for (const [symbol, balance] of Object.entries(balances)) {
    if (symbol === 'stETH' && balance === 0) continue;
    const value = balance * prices[symbol];
    const ratio = (value / totalValue) * 100;
    const target = TARGET_RATIOS[symbol] ? TARGET_RATIOS[symbol].target * 100 : 0;
    message += `• ${symbol}: ${formatNumber(balance, 4)} (${formatUSD(value)}) - ${ratio.toFixed(1)}% (target: ${target.toFixed(1)}%)\n`;
  }

  if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
    try {
      const { getAaveBalance } = await import('./yield.js');
      const aaveBalance = await getAaveBalance();
      if (aaveBalance > 0) {
        message += `\n💰 Yield Farming:\n`;
        message += `• USDC sur Aave: ${aaveBalance.toFixed(2)} (~5-7% APY)\n`;
      }
    } catch (error) {
      // Ignore
    }
  }

  message += `\n💰 Valeur totale: ${formatUSD(totalValue)}`;

  await sendTelegramMessage(message);
}

/**
 * Envoie une notification d'échec
 */
async function sendFailureNotification(swapsCompleted, error) {
  let message = `⚠️ Rebalancing interrompu\n\n`;
  message += `Erreur: ${error.message}\n\n`;

  if (swapsCompleted.length > 0) {
    message += `Swaps effectués avant l'échec:\n`;
    for (const swap of swapsCompleted) {
      message += `• ${swap.from} → ${swap.to}: ${formatUSD(swap.usd)}\n`;
    }
  } else {
    message += `Aucun swap n'a été effectué.`;
  }

  await sendTelegramMessage(message);
}

/**
 * Envoie un heartbeat quotidien
 */
async function sendHeartbeat(balances, prices, totalValue) {
  const lastHeartbeat = global.lastHeartbeat || 0;
  const now = Date.now();

  if (now - lastHeartbeat < 24 * 60 * 60 * 1000) {
    return;
  }

  let message = `💚 Bot actif - Portfolio équilibré\n\n`;
  message += `📊 État du portefeuille:\n`;

  for (const [symbol, balance] of Object.entries(balances)) {
    const value = balance * prices[symbol];
    const ratio = (value / totalValue) * 100;
    message += `• ${symbol}: ${formatNumber(balance, 4)} (${formatUSD(value)}) - ${ratio.toFixed(1)}%\n`;
  }

  message += `\n💰 Valeur totale: ${formatUSD(totalValue)}`;

  await sendTelegramMessage(message);
  global.lastHeartbeat = now;
}