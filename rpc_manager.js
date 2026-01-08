// === rpc_manager.js ===

import { ethers } from "ethers";
import dotenv from "dotenv";
import { log, sleep } from "./utils.js";

dotenv.config();

const RPC_ENDPOINTS = [
  process.env.RPC_URL, // Infura primary
  'https://base.drpc.org', // DRPC
  

];

let currentRPCIndex = 0;
let provider = null;
let wallet = null;
let failureCount = {};

// Initialiser le compteur d'échecs pour chaque RPC
RPC_ENDPOINTS.forEach((_, index) => {
  failureCount[index] = 0;
});

// Initialiser le provider
export function initializeProvider() {
  provider = new ethers.JsonRpcProvider(RPC_ENDPOINTS[currentRPCIndex]);
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  log('INFO', `🌐 RPC initialisé: ${getRPCName(currentRPCIndex)}`);
  return { provider, wallet };
}

// Obtenir le provider actuel
export function getProvider() {
  if (!provider) {
    initializeProvider();
  }
  return provider;
}

// Obtenir le wallet actuel
export function getWallet() {
  if (!wallet) {
    initializeProvider();
  }
  return wallet;
}

function getRPCName(index) {
  const url = RPC_ENDPOINTS[index];
  if (url.includes('infura')) return 'Infura';
  if (url.includes('mainnet.base.org')) return 'Base Official';
  if (url.includes('drpc')) return 'DRPC';
  return `RPC-${index}`;
}


// Rotation vers le prochain RPC
export function rotateToNextRPC() {
  const previousIndex = currentRPCIndex;
  currentRPCIndex = (currentRPCIndex + 1) % RPC_ENDPOINTS.length;
  const newRPC = RPC_ENDPOINTS[currentRPCIndex];

  log('WARN', `🔄 Rotation RPC: ${getRPCName(previousIndex)} → ${getRPCName(currentRPCIndex)}`);

  provider = new ethers.JsonRpcProvider(newRPC);
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  failureCount[previousIndex] = (failureCount[previousIndex] || 0) + 1;

  return { provider, wallet };
}

// Détecter si c'est une erreur RPC qui nécessite rotation
export function shouldRotateRPC(error) {
  const isRateLimited =
    error.code === -32005 ||
    error.code === 'RATE_LIMITED' ||
    error.message?.includes('Too Many Requests') ||
    error.message?.includes('rate limit') ||
    error.message?.includes('429') ||
    error.response?.status === 429;

  const isServerError =
    error.code === -32603 ||
    error.code === 'UNKNOWN_ERROR' ||
    error.code === 'SERVER_ERROR' ||
    error.code === 'NETWORK_ERROR' ||
    error.message?.includes('Internal error') ||
    error.message?.includes('internal server error') ||
    error.message?.includes('502') ||
    error.message?.includes('503') ||
    error.message?.includes('504');

  const isTimeout =
    error.code === 'TIMEOUT' ||
    error.message?.includes('timeout') ||
    error.message?.includes('timed out');

  const isConnectionError =
    error.code === 'ECONNREFUSED' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.message?.includes('network') ||
    error.message?.includes('connection');

  return isRateLimited || isServerError || isTimeout || isConnectionError;
}

// Exécuter une fonction avec fallback automatique
export async function executeWithFallback(fn, maxRotations = RPC_ENDPOINTS.length) {
  let lastError;
  let attemptCount = 0;

  for (let rotation = 0; rotation < maxRotations; rotation++) {
    try {
      attemptCount++;
      if (rotation > 0) {
        log('INFO', `🔄 Tentative ${attemptCount}/${maxRotations} avec ${getRPCName(currentRPCIndex)}`);
      }

      const result = await fn();

      // Réinitialiser le compteur d'échecs en cas de succès
      failureCount[currentRPCIndex] = 0;

      return result;

    } catch (error) {
      lastError = error;

      // Log détaillé de l'erreur
      log('WARN', `❌ Erreur RPC (${getRPCName(currentRPCIndex)}): ${error.message}`);

      if (shouldRotateRPC(error) && rotation < maxRotations - 1) {
        rotateToNextRPC();

        // Attendre progressivement plus longtemps à chaque rotation
        const delayMs = Math.min(2000 * Math.pow(1.5, rotation), 10000);
        log('INFO', `⏳ Attente ${delayMs}ms avant retry...`);
        await sleep(delayMs);
        continue;
      }

      // Si ce n'est pas une erreur RPC ou si on a épuisé les rotations
      throw error;
    }
  }

  log('ERROR', `❌ Échec après ${maxRotations} tentatives sur tous les RPC`);
  throw lastError;
}

export function getCurrentRPC() {
  return RPC_ENDPOINTS[currentRPCIndex];
}

// Obtenir le nom du RPC actuel
export function getCurrentRPCName() {
  return getRPCName(currentRPCIndex);
}

// Obtenir les statistiques des RPC
export function getRPCStats() {
  return {
    current: getCurrentRPCName(),
    currentIndex: currentRPCIndex,
    failureCounts: Object.entries(failureCount).map(([index, count]) => ({
      rpc: getRPCName(parseInt(index)),
      failures: count
    })),
    totalEndpoints: RPC_ENDPOINTS.length
  };
}

// Réinitialiser les compteurs d'échecs
export function resetRPCStats() {
  Object.keys(failureCount).forEach(key => {
    failureCount[key] = 0;
  });
  log('INFO', '📊 Statistiques RPC réinitialisées');
}

// Test de connexion de tous les RPC
export async function testAllRPCs() {
  log('INFO', '🧪 Test de connexion de tous les RPC...');
  const results = [];

  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const testProvider = new ethers.JsonRpcProvider(RPC_ENDPOINTS[i]);
    const name = getRPCName(i);

    try {
      const blockNumber = await Promise.race([
        testProvider.getBlockNumber(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);

      results.push({ name, status: 'OK', blockNumber });
      log('SUCCESS', `✅ ${name}: OK (block ${blockNumber})`);

    } catch (error) {
      results.push({ name, status: 'FAIL', error: error.message });
      log('ERROR', `❌ ${name}: FAIL (${error.message})`);
    }
  }

  return results;
}