# 🤖 Professional Crypto Rebalancing Bot

**Enterprise-grade portfolio management with circuit breakers, automatic yield farming, and multi-RPC failover.**

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Network](https://img.shields.io/badge/network-Base-blue.svg)

---

## 🎯 What This Bot Does

Automatically maintains your crypto portfolio at optimal ratios while:
- **Protecting you from market crashes** with built-in circuit breakers
- **Earning passive yield** on stablecoins via Aave V3
- **Never going offline** thanks to automatic RPC failover
- **Saving you time** with hands-off automation

**Perfect for:** Anyone holding BTC, ETH, stETH, and USDC who wants professional-grade portfolio management without the complexity.

---

## ⚡ Key Features

### 🛡️ **Circuit Breakers (Market Crash Protection)**
- Automatically stops trading if portfolio drops >15% in 1 hour
- Protects against flash crashes and extreme volatility
- Sends instant Telegram alerts when triggered

### 🔄 **Multi-RPC Failover**
- Never loses connection if your primary RPC goes down
- Automatically switches between Infura, DRPC, and Base Official
- Keeps running 24/7 without manual intervention

### 💰 **Automatic Yield Farming**
- Deposits idle USDC to Aave V3 for passive income (~3-5% APY)
- Maintains liquidity buffer for rebalancing
- Withdraws automatically when needed for swaps

### 📊 **Smart Rebalancing**
- Rebalances every 2 hours (configurable)
- Only swaps when deviation exceeds threshold (saves gas)
- Emergency rebalancing for large market moves
- Validates gas costs before every swap

### 📱 **Telegram Notifications**
- Real-time alerts for all operations
- Portfolio value updates
- Error notifications with context
- Daily summaries
- Notifications are in french, you have to change them yourself

### 🧪 **Dry-Run Mode**
- Test everything without spending a cent
- Simulates all swaps and operations
- Perfect for backtesting strategies

---

## 📈 Default Strategy

**Target Portfolio:**
- 35% BTC (cbBTC)
- 20% ETH (WETH)
- 25% stETH (wstETH) - earns staking rewards
- 20% USDC - earns Aave yield

**Tolerance Bands:**
- Rebalances when any asset deviates ±2% from target
- Emergency rebalance at ±5% deviation

**Fully customizable** - adjust ratios, add tokens, change thresholds.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Base network wallet with some ETH for gas
- 1inch API key (free)
- Infura API key (free) (or Ankr API key)
- Telegram bot token (optional but recommended)

### Installation

```bash
# 1. Clone and install
git clone [your-repo]
cd crypto-rebalancing-bot
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your keys

# 3. Test in dry-run mode
npm run dry-run

# 4. Run live
npm start
```

### Environment Variables

```env
# Required
PRIVATE_KEY=your_wallet_private_key
RPC_URL=your_infura_or_alchemy_url
ONEINCH_API_KEY=your_1inch_api_key

# Optional (but recommended)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
COINGECKO_API_KEY=your_coingecko_key
```

---

## 🎛️ Configuration

Everything is customizable in `config.js`:

```javascript
// Portfolio ratios
export const TARGET_RATIOS = {
    BTC: { target: 0.35, min: 0.34, max: 0.36 },
    ETH: { target: 0.20, min: 0.195, max: 0.205 },
    stETH: { target: 0.25, min: 0.245, max: 0.255 },
    USDC: { target: 0.20, min: 0.195, max: 0.205 },
};

// Rebalancing frequency
export const BOT_CONFIG = {
    REBALANCE_INTERVAL_HOURS: 2,
    EMERGENCY_DEVIATION_THRESHOLD: 0.05,
    ENABLE_YIELD_FARMING: true,
    DRY_RUN: false,
};

// Circuit breakers
export const CIRCUIT_BREAKERS = {
    MAX_PORTFOLIO_DROP_1H: 0.15,    // Stop if -15% in 1h
    MAX_PORTFOLIO_DROP_24H: 0.30,   // Stop if -30% in 24h
    MAX_SINGLE_ASSET_DROP: 0.40,    // Stop if any asset -40%
};
```

---

## 📊 How It Works

1. **Checks portfolio** every 2 hours
2. **Calculates deviations** from target ratios
3. **Validates gas costs** - skips unprofitable swaps
4. **Executes swaps** via 1inch for best prices
5. **Deposits excess USDC** to Aave for yield
6. **Sends notifications** via Telegram
7. **Monitors for crashes** with circuit breakers

---

## 🔧 Advanced Features

### Gas Cost Optimization
- Automatically skips swaps where gas > 5% of swap value
- Waits for lower gas prices when possible
- Validates profitability before execution

### Price Validation
- Detects anomalous price movements (>20% spike)
- Caches prices to reduce API calls
- Falls back to cached data if API fails

### Balance Caching
- Reduces RPC calls with smart caching
- Refreshes only when needed
- Handles stale data gracefully

### Error Recovery
- Automatic retry with exponential backoff
- RPC rotation on failures
- Detailed error logging

---

## 📱 Example Telegram Notifications

**Startup:**
```
🚀 Bot de rebalancing démarré

Mode: PRODUCTION
Fréquence: 2h
Yield farming: Activé ✅

Portfolio initial:
• BTC: 0.0125 ($852.50) - 35.1%
• ETH: 0.1523 ($487.36) - 20.0%
• stETH: 0.1891 ($605.12) - 24.9%
• USDC: 485.23 ($485.23) - 20.0%

Valeur totale: $2,430.21
```

**Rebalancing:**
```
✅ Rebalancing terminé

Swaps exécutés:
• 0.0023 BTC → 73.84 USDC ($73.84)
  Gas: $0.42

Portfolio après:
• BTC: 35.0% (target: 35.0%) ✅
• ETH: 20.1% (target: 20.0%) ✅
• stETH: 24.9% (target: 25.0%) ✅
• USDC: 20.0% (target: 20.0%) ✅

💰 400 USDC déposés sur Aave
```

---

## ⚠️ Important Notes

### Security
- **Never share your private key**
- Store `.env` securely
- Use a dedicated wallet for the bot
- Start with small amounts

### Network
- Built for **Base network** (low fees)
- Can be adapted for other EVM chains

---

## 🛠️ Troubleshooting

### Bot stops rebalancing
- Check RPC endpoints are working
- Verify 1inch API key is valid
- Ensure wallet has enough ETH for gas

### Telegram notifications not working
- Verify bot token and chat ID
- Check bot was started with `/start` command

### "Insufficient balance" errors
- Ensure wallet has all required tokens
- Check token addresses in config.js
- Verify network is Base (not Ethereum mainnet)

### High gas costs
- Increase `MAX_GAS_COST_PERCENT` in config.js
- Reduce rebalancing frequency
- Wait for lower gas prices

---

## 📈 Performance Tips

1. **Start in dry-run mode** to test your configuration
2. **Monitor for 1 week** before deploying larger amounts
3. **Adjust thresholds** based on market volatility
4. **Enable Telegram** to stay informed
5. **Review logs** regularly for optimization opportunities

---

## 🤝 Support

**Issues or questions?** 

Contact via:
- Email: rozier.exe@gmail.com

---

## 📜 License

MIT License - Use at your own risk.

**Disclaimer:** This bot interacts with DeFi protocols and executes trades autonomously. Always understand the risks involved. Not financial advice.

---

This project is free and open-source, so if you want to thank me you can make a donation :

- USDC, ETH (Base network)
    0x88463bC135e78577c38e7CdA66F092cAF69d4243
  
- USD, ETH (Ethereum Mainnet)
    0x88463bC135e78577c38e7CdA66F092cAF69d4243
  
- BTC
    bc1qpua6ysll7249gua5c5vfvh6llxaefmlx2p04up


*Built with ❤️ for crypto traders who value their time.*
