// === telegram.js ===

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { log, formatUSD, formatNumber } from "./utils.js";
import { TARGET_RATIOS, BOT_CONFIG, TOKENS } from "./config.js";
import { getPrices } from "./prices.js";
import { getBalances } from "./balances.js";
import { getPnlSummary, getTradeHistory } from "./pnl.js";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  ? Number(process.env.TELEGRAM_CHAT_ID)
  : null;

let bot = null;
let botPaused = false;

/**
 * Vérifie que le message provient du chat autorisé
 */
function isAuthorized(msg) {
  return TELEGRAM_CHAT_ID && msg.chat.id === TELEGRAM_CHAT_ID;
}

/**
 * Envoie une réponse HTML au chat autorisé
 */
async function reply(chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (error) {
    log("ERROR", `Erreur envoi réponse Telegram: ${error.message}`);
  }
}

/**
 * Démarre le bot Telegram en mode polling
 */
export function startTelegramBot({ onStop, onStart, onForceRebalance, getIsRunning }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log("WARN", "Telegram non configuré, bot de commandes désactivé");
    return;
  }

  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  log("INFO", "Bot Telegram démarré (polling)");

  // === /help ===
  bot.onText(/\/help/, async (msg) => {
    if (!isAuthorized(msg)) return;

    const text =
      `<b>Commandes disponibles</b>\n\n` +
      `/status - Portfolio actuel (allocations, valeur, Aave)\n` +
      `/stop - Pause les tâches cron\n` +
      `/start - Reprend les tâches cron\n` +
      `/config - Affiche la configuration\n` +
      `/setconfig &lt;param&gt; &lt;valeur&gt; - Modifie la config\n` +
      `/pnl - Performance depuis inception\n` +
      `/force - Déclenche un rebalancing immédiat\n` +
      `/help - Cette aide\n\n` +
      `<b>Exemples setconfig :</b>\n` +
      `<code>/setconfig ratio BTC 0.30 ETH 0.25 stETH 0.25 USDC 0.20</code>\n` +
      `<code>/setconfig threshold 0.03</code>\n` +
      `<code>/setconfig interval 4</code>\n` +
      `<code>/setconfig emergency_interval 30</code>\n` +
      `<code>/setconfig dryrun on</code>\n` +
      `<code>/setconfig yield off</code>`;

    await reply(msg.chat.id, text);
  });

  // === /status ===
  bot.onText(/\/status/, async (msg) => {
    if (!isAuthorized(msg)) return;

    try {
      const prices = await getPrices(true);
      if (!prices) {
        await reply(msg.chat.id, "Impossible de récupérer les prix.");
        return;
      }

      const balances = await getBalances(true);
      let totalValue = 0;
      for (const symbol of Object.keys(balances)) {
        totalValue += balances[symbol] * prices[symbol];
      }

      let text = `<b>Portfolio</b>\n\n`;

      for (const [symbol, balance] of Object.entries(balances)) {
        const value = balance * prices[symbol];
        const ratio = totalValue > 0 ? (value / totalValue) * 100 : 0;
        const target = TARGET_RATIOS[symbol]
          ? TARGET_RATIOS[symbol].target * 100
          : 0;
        const dev = ratio - target;
        const devIcon = Math.abs(dev) > 2 ? "⚠️" : "✅";
        text += `${devIcon} <b>${symbol}</b>: ${formatNumber(balance, 4)} (${formatUSD(value)})\n`;
        text += `   ${ratio.toFixed(1)}% / cible ${target.toFixed(1)}% (${dev >= 0 ? "+" : ""}${dev.toFixed(1)}%)\n`;
      }

      text += `\n<b>Valeur totale:</b> ${formatUSD(totalValue)}\n`;

      // Aave status
      if (BOT_CONFIG.ENABLE_YIELD_FARMING) {
        try {
          const { getAaveBalance } = await import("./yield.js");
          const aaveBalance = await getAaveBalance();
          if (aaveBalance > 0) {
            text += `\n<b>Aave V3:</b> ${formatUSD(aaveBalance)} USDC`;
          }
        } catch {
          // ignore
        }
      }

      text += `\n\n<b>Bot:</b> ${botPaused ? "En pause" : "Actif"}`;
      text += ` | <b>Dry-run:</b> ${BOT_CONFIG.DRY_RUN ? "Oui" : "Non"}`;

      await reply(msg.chat.id, text);
    } catch (error) {
      await reply(msg.chat.id, `Erreur: ${error.message}`);
    }
  });

  // === /stop ===
  bot.onText(/\/stop/, async (msg) => {
    if (!isAuthorized(msg)) return;

    if (botPaused) {
      await reply(msg.chat.id, "Le bot est déjà en pause.");
      return;
    }

    onStop();
    botPaused = true;
    await reply(msg.chat.id, "⏸ Bot mis en pause. Les tâches cron sont arrêtées.");
  });

  // === /start ===
  bot.onText(/\/start/, async (msg) => {
    if (!isAuthorized(msg)) return;

    if (!botPaused) {
      await reply(msg.chat.id, "Le bot tourne déjà.");
      return;
    }

    onStart();
    botPaused = false;
    await reply(msg.chat.id, "▶️ Bot repris. Les tâches cron sont relancées.");
  });

  // === /config ===
  bot.onText(/\/config$/, async (msg) => {
    if (!isAuthorized(msg)) return;

    let text = `<b>Configuration</b>\n\n`;

    text += `<b>Ratios cibles :</b>\n`;
    for (const [symbol, r] of Object.entries(TARGET_RATIOS)) {
      text += `  ${symbol}: ${(r.target * 100).toFixed(1)}% [${(r.min * 100).toFixed(1)}–${(r.max * 100).toFixed(1)}%]\n`;
    }

    text += `\n<b>Paramètres :</b>\n`;
    text += `  Interval: ${BOT_CONFIG.REBALANCE_INTERVAL_HOURS}h\n`;
    text += `  Emergency check: ${BOT_CONFIG.EMERGENCY_CHECK_INTERVAL_MINUTES} min\n`;
    text += `  Emergency threshold: ${(BOT_CONFIG.EMERGENCY_DEVIATION_THRESHOLD * 100).toFixed(1)}%\n`;
    text += `  Dry-run: ${BOT_CONFIG.DRY_RUN ? "Oui" : "Non"}\n`;
    text += `  Yield farming: ${BOT_CONFIG.ENABLE_YIELD_FARMING ? "Oui" : "Non"}\n`;
    text += `  RPC delay: ${BOT_CONFIG.RPC_DELAY_MS}ms\n`;

    await reply(msg.chat.id, text);
  });

  // === /setconfig ===
  bot.onText(/\/setconfig (.+)/, async (msg, match) => {
    if (!isAuthorized(msg)) return;

    const args = match[1].trim().split(/\s+/);
    const param = args[0].toLowerCase();

    try {
      if (param === "ratio") {
        // Format: ratio BTC 0.30 ETH 0.25 stETH 0.25 USDC 0.20
        const pairs = args.slice(1);
        if (pairs.length % 2 !== 0) {
          await reply(msg.chat.id, "Format: /setconfig ratio BTC 0.30 ETH 0.25 ...");
          return;
        }

        const newRatios = {};
        for (let i = 0; i < pairs.length; i += 2) {
          const symbol = pairs[i];
          const value = parseFloat(pairs[i + 1]);
          if (!TARGET_RATIOS[symbol]) {
            await reply(msg.chat.id, `Asset inconnu: ${symbol}`);
            return;
          }
          if (isNaN(value) || value < 0 || value > 1) {
            await reply(msg.chat.id, `Ratio invalide pour ${symbol}: ${pairs[i + 1]}`);
            return;
          }
          newRatios[symbol] = value;
        }

        const sum = Object.values(newRatios).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1.0) > 0.001) {
          await reply(msg.chat.id, `La somme des ratios doit être 1.0 (actuel: ${sum.toFixed(4)})`);
          return;
        }

        // Appliquer les nouveaux ratios
        for (const [symbol, value] of Object.entries(newRatios)) {
          const margin = Math.max(0.005, value * 0.03);
          TARGET_RATIOS[symbol].target = value;
          TARGET_RATIOS[symbol].min = value - margin;
          TARGET_RATIOS[symbol].max = value + margin;
        }

        let text = `✅ Ratios mis à jour:\n`;
        for (const [symbol, r] of Object.entries(TARGET_RATIOS)) {
          text += `  ${symbol}: ${(r.target * 100).toFixed(1)}%\n`;
        }
        await reply(msg.chat.id, text);

      } else if (param === "threshold") {
        const value = parseFloat(args[1]);
        if (isNaN(value) || value < 0.005 || value > 0.20) {
          await reply(msg.chat.id, "Threshold doit être entre 0.005 et 0.20");
          return;
        }
        BOT_CONFIG.EMERGENCY_DEVIATION_THRESHOLD = value;
        await reply(msg.chat.id, `✅ Emergency threshold: ${(value * 100).toFixed(1)}%`);

      } else if (param === "interval") {
        const value = parseInt(args[1]);
        if (isNaN(value) || value < 1 || value > 24) {
          await reply(msg.chat.id, "Interval doit être entre 1 et 24 heures");
          return;
        }
        BOT_CONFIG.REBALANCE_INTERVAL_HOURS = value;
        await reply(msg.chat.id, `✅ Interval rebalancing: ${value}h\n⚠️ Redémarrer le bot pour appliquer le nouveau cron.`);

      } else if (param === "emergency_interval") {
        const value = parseInt(args[1]);
        if (isNaN(value) || value < 5 || value > 120) {
          await reply(msg.chat.id, "Emergency interval doit être entre 5 et 120 minutes");
          return;
        }
        BOT_CONFIG.EMERGENCY_CHECK_INTERVAL_MINUTES = value;
        await reply(msg.chat.id, `✅ Emergency check interval: ${value} min\n⚠️ Redémarrer le bot pour appliquer le nouveau cron.`);

      } else if (param === "dryrun") {
        const value = args[1]?.toLowerCase();
        if (value !== "on" && value !== "off") {
          await reply(msg.chat.id, "Usage: /setconfig dryrun on|off");
          return;
        }
        BOT_CONFIG.DRY_RUN = value === "on";
        await reply(msg.chat.id, `✅ Dry-run: ${BOT_CONFIG.DRY_RUN ? "activé" : "désactivé"}`);

      } else if (param === "yield") {
        const value = args[1]?.toLowerCase();
        if (value !== "on" && value !== "off") {
          await reply(msg.chat.id, "Usage: /setconfig yield on|off");
          return;
        }
        BOT_CONFIG.ENABLE_YIELD_FARMING = value === "on";
        await reply(msg.chat.id, `✅ Yield farming: ${BOT_CONFIG.ENABLE_YIELD_FARMING ? "activé" : "désactivé"}`);

      } else {
        await reply(msg.chat.id, `Paramètre inconnu: ${param}\nParamètres: ratio, threshold, interval, emergency_interval, dryrun, yield`);
      }
    } catch (error) {
      await reply(msg.chat.id, `Erreur: ${error.message}`);
    }
  });

  // === /pnl ===
  bot.onText(/\/pnl/, async (msg) => {
    if (!isAuthorized(msg)) return;

    try {
      const prices = await getPrices(true);
      if (!prices) {
        await reply(msg.chat.id, "Impossible de récupérer les prix.");
        return;
      }

      const balances = await getBalances(true);
      const summary = getPnlSummary(balances, prices);

      if (!summary) {
        await reply(msg.chat.id, "Pas de données PnL. Le bot doit compléter au moins un cycle.");
        return;
      }

      const pnlSign = summary.pnl.totalUSD >= 0 ? "+" : "";
      const pnlIcon = summary.pnl.totalUSD >= 0 ? "📈" : "📉";

      let text = `<b>${pnlIcon} Performance</b>\n\n`;
      text += `<b>Inception:</b> ${new Date(summary.inception.timestamp).toLocaleDateString("fr-FR")}\n`;
      text += `<b>Durée:</b> ${summary.duration.text}\n\n`;
      text += `<b>Valeur initiale:</b> ${formatUSD(summary.inception.totalValueUSD)}\n`;
      text += `<b>Valeur actuelle:</b> ${formatUSD(summary.current.totalValueUSD)}\n`;
      text += `<b>Return:</b> ${pnlSign}${formatUSD(summary.pnl.totalUSD)} (${pnlSign}${summary.pnl.totalPercent.toFixed(2)}%)\n\n`;

      text += `<b>Par asset :</b>\n`;
      for (const [symbol, data] of Object.entries(summary.assetPnl)) {
        const sign = data.pnlUSD >= 0 ? "+" : "";
        text += `  ${symbol}: ${sign}${formatUSD(data.pnlUSD)} (${sign}${data.pnlPercent.toFixed(1)}%)\n`;
      }

      text += `\n<b>Stats :</b>\n`;
      text += `  Trades: ${summary.stats.totalTradeCount}\n`;
      text += `  Volume: ${formatUSD(summary.stats.totalVolumeUSD)}\n`;
      text += `  Gas total: ${formatUSD(summary.stats.totalGasCostUSD)}`;

      await reply(msg.chat.id, text);
    } catch (error) {
      await reply(msg.chat.id, `Erreur: ${error.message}`);
    }
  });

  // === /force ===
  bot.onText(/\/force/, async (msg) => {
    if (!isAuthorized(msg)) return;

    if (getIsRunning()) {
      await reply(msg.chat.id, "⏳ Un cycle de rebalancing est déjà en cours.");
      return;
    }

    await reply(msg.chat.id, "🔄 Rebalancing forcé lancé...");

    try {
      await onForceRebalance();
      await reply(msg.chat.id, "✅ Rebalancing forcé terminé.");
    } catch (error) {
      await reply(msg.chat.id, `❌ Erreur rebalancing: ${error.message}`);
    }
  });

  // Log polling errors
  bot.on("polling_error", (error) => {
    log("ERROR", `Telegram polling error: ${error.message}`);
  });
}

/**
 * Arrête le bot Telegram proprement
 */
export function stopTelegramBot() {
  if (bot) {
    bot.stopPolling();
    log("INFO", "Bot Telegram arrêté");
    bot = null;
  }
}
