// === notifier.js ===

import axios from "axios";
import dotenv from "dotenv";
import { log, retryWithBackoff, withTimeout } from "./utils.js";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Envoie un message via Telegram
 */
export async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('WARN', 'Telegram non configuré, notification ignorée');
    return false;
  }

  try {
    await retryWithBackoff(
      () => sendTelegramMessageInternal(message),
      3,
      2000,
      "Notification Telegram"
    );
    
    log('SUCCESS', '📱 Message Telegram envoyé');
    return true;
    
  } catch (error) {
    log('ERROR', 'Échec envoi Telegram:', { error: error.message });
    return false;
  }
}

/**
 * Fonction interne pour envoyer le message
 */
async function sendTelegramMessageInternal(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  const response = await withTimeout(
    axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    10000,
    "Timeout notification Telegram"
  );
  
  return response.data;
}

/**
 * Envoie un message d'alerte critique
 */
export async function sendCriticalAlert(title, details) {
  const message = `🚨 <b>ALERTE CRITIQUE</b> 🚨\n\n<b>${title}</b>\n\n${details}`;
  return await sendTelegramMessage(message);
}

/**
 * Envoie un message d'avertissement
 */
export async function sendWarning(title, details) {
  const message = `⚠️ <b>AVERTISSEMENT</b>\n\n<b>${title}</b>\n\n${details}`;
  return await sendTelegramMessage(message);
}

/**
 * Envoie un message de succès
 */
export async function sendSuccess(title, details) {
  const message = `✅ <b>${title}</b>\n\n${details}`;
  return await sendTelegramMessage(message);
}

/**
 * Test la connexion Telegram
 */
export async function testTelegramConnection() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return false;
  }
  
  try {
    await sendTelegramMessage('🧪 Test de connexion Telegram - Bot opérationnel');
    return true;
  } catch (error) {
    return false;
  }
}