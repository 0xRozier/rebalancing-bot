# Frequently Asked Questions

Quick answers to common questions about the bot.

---

## 📊 General Questions

### Can I use different tokens?

**Yes, 100% customizable.**

Edit `config.js`:

```javascript
export const TOKENS = {
    // Add your token
    SOL: {
        symbol: "SOL",
        address: "0x...",  // Token address on Base
        decimals: 9
    },
    // Remove tokens you don't want
    // ...
};

export const TARGET_RATIOS = {
    SOL: { target: 0.30, min: 0.29, max: 0.31 },
    // Adjust ratios (must sum to 1.0)
};
```

**Note:** Token must exist on Base network with sufficient liquidity on 1inch.

### Does it work on other networks?

**Built for Base** (lowest fees), but can be adapted:

**Easy to adapt:**
- Ethereum mainnet
- Arbitrum
- Optimism
- Polygon

**Changes needed:**
1. Update `CHAIN_ID` in swap.js
2. Update token addresses in config.js
3. Update Aave addresses (if using yield farming)
4. Update RPC URLs in .env

---

## 🔧 Technical Questions

### Do I need coding skills?

**Minimal skills required:**
- Copy/paste commands in terminal ✅
- Edit text files (like .env) ✅
- Follow step-by-step instructions ✅

**Don't need:**
- Write code ❌
- Understand blockchain internals ❌
- Debug complex issues ❌


If you can use Terminal and follow instructions, you can set this up.


**Breakdown:**
- Install Node.js: 2-3 min (if not installed)
- Clone repo & install: 2-3 min
- Configure .env: 3-5 min
- Test dry-run: 2-3 min
- Deploy: 1 min

**VPS setup:** +15-20 min extra

### What if my RPC goes down?

**Bot handles this automatically.**

**How it works:**
1. Primary RPC (Infura) fails
2. Bot detects error
3. Switches to DRPC (backup)
4. If that fails → Base Official
5. Logs the rotation
6. Sends you Telegram alert

**You don't need to do anything.**

Bot has saved me twice when Infura had outages.

### Can I run this on my laptop?

**Yes, but not recommended for 24/7 operation.**

**Pros:**
- Free (no VPS cost)
- Easy to monitor

**Cons:**
- Laptop must stay on 24/7
- Loses connection if you sleep/close laptop
- Home internet less reliable than VPS

**Recommendation:**
- Test on laptop first
- Deploy to VPS for production ($5-10/month)

**VPS providers:**
- Vultr: $5/month
- DigitalOcean: $6/month
- Linode: $5/month

### What happens if bot crashes?

**Depends on how you're running it:**

**With PM2 (recommended for VPS):**
- PM2 restarts bot automatically
- No manual intervention needed
- You get a Telegram alert

**Without PM2:**
- Bot stops
- You need to manually restart
- Set up PM2 to avoid this

**How to setup PM2:**
```bash
npm install -g pm2
pm2 start index.js --name rebalancing-bot
pm2 startup  # Auto-start on server reboot
pm2 save
```

---

## 🛡️ Security Questions

### Is my private key safe?

**Yes, if you follow best practices:**

**What the bot does:**
- Stores key in `.env` file locally
- Never sends it anywhere
- Uses it only to sign transactions
- Open source = you can audit the code

**What you should do:**
- ✅ Use a dedicated wallet (not your main wallet)
- ✅ Keep `.env` secure (never commit to GitHub)
- ✅ Start with small amounts
- ✅ Review the code if you know JavaScript

**What the bot CANNOT do:**
- Cannot withdraw to addresses you didn't authorize
- Cannot access wallets other than the one in .env
- Cannot modify itself to steal funds

### Can the bot steal my funds?

**No.**

**Why:**
- Bot only has permission to trade tokens you authorize
- Cannot withdraw to external addresses
- Cannot transfer funds out of your wallet
- All swaps go through 1inch (trusted aggregator)
- You can audit the open source code

**Additional safety:**
- Start with small amounts ($500-1K)
- Monitor for first week
- Increase gradually as you build trust

### What if there's a bug?

**Multiple layers of protection:**

1. **Dry-run mode** - Test before going live
2. **Circuit breakers** - Stop trading during extreme scenarios
3. **Gas validation** - Won't make unprofitable swaps
4. **Retry logic** - Handles temporary failures gracefully
5. **My support** - I fix bugs for life

**If you find a bug:**
- Stop the bot (Ctrl+C)
- Contact me with details
- I'll investigate and fix ASAP
- Update pushed to repo
- You pull latest version

---

## 💰 Financial Questions

### How much does it cost to run?

**Total monthly cost:**

**VPS:** $5-10/month
- Vultr/DigitalOcean/Linode basic plan

**Gas costs:** Variable based on frequency
- negligible

**APIs:** $0
- 1inch free tier is sufficient
- CoinGecko free tier works fine

**ROI calculation:**
- Time saved: 10+ hrs/month × $20/hr = $200 value
- Aave yield: $3-5/month passive income
- Never missing opportunities: Priceless

### What about the one-time payment?

**€179 one-time = permanent ownership**

### Can I get a refund?

**No refunds.**

**Why:**
- You get immediate access to full source code
- Digital product = can't "return" it
- But I'll help you get it working

**Instead of refunds:**
- 1 week setup support included
- I'll help troubleshoot any issues
- Fair pricing (much cheaper than competitors)

### Do you offer discounts?

**Standard price: €179**

**No pressure - only buy if the value makes sense for you.**

---

## 🔄 Circuit Breakers

### When do circuit breakers trigger?

**Default thresholds:**

1. **Portfolio drops >15% in 1 hour**
   - Example: $2,500 → $2,125 in 1h

2. **Portfolio drops >30% in 24 hours**
   - Example: $2,500 → $1,750 in 24h

3. **Single asset crashes >40%**
   - Example: BTC drops from $68K → $41K

**All configurable** in config.js

### What happens when triggered?

**Automatic actions:**
1. Bot stops all trading immediately
2. Sends Telegram alert (if configured)
3. Logs the event
4. Waits for manual restart

**You receive:**
```
🚨 CIRCUIT BREAKER DÉCLENCHÉ 🚨

Le bot est ARRÊTÉ pour votre protection.

Problème:
❌ Portfolio a chuté de 16.2% en 1h

Valeur actuelle: $2,038.45

⚠️ Vérifiez le marché et relancez
   manuellement si vous décidez de
   continuer à trader.
```

**What to do:**
1. Check what caused the crash
2. Assess if it's recovering or continuing
3. Decide: restart bot or stay in cash
4. Restart with `npm start` when ready

### Can I customize the thresholds?

**Yes, fully customizable.**

Edit `config.js`:

```javascript
export const CIRCUIT_BREAKERS = {
    MAX_PORTFOLIO_DROP_1H: 0.20,   // Stop if -20% in 1h (was 15%)
    MAX_PORTFOLIO_DROP_24H: 0.40,  // Stop if -40% in 24h (was 30%)
    MAX_SINGLE_ASSET_DROP: 0.50,   // Stop if asset -50% (was 40%)
};
```

**Conservative (for volatile markets):**
- 10% in 1h
- 20% in 24h
- 30% single asset

**Aggressive (for stable markets):**
- 25% in 1h
- 50% in 24h
- 60% single asset

### Can I disable circuit breakers?

**Yes, but NOT recommended.**

To disable, set thresholds very high:

```javascript
export const CIRCUIT_BREAKERS = {
    MAX_PORTFOLIO_DROP_1H: 0.99,  // Essentially disabled
    MAX_PORTFOLIO_DROP_24H: 0.99,
    MAX_SINGLE_ASSET_DROP: 0.99,
};
```

**Why keep them:**
- Flash crashes happen
- Protects you when you're asleep
- Better safe than sorry
- Can always adjust thresholds

---

## 💰 Yield Farming (Aave)

### How does Aave yield work?

**Automatic process:**

1. Bot checks your USDC balance
2. Calculates how much is "excess" (beyond rebalancing needs)
3. Deposits excess to Aave V3
4. You earn ~3-5% APY automatically
5. Withdraws when needed for swaps

**Example:**
- Portfolio: $2,500
- USDC allocation: 20% = $500
- Buffer needed for rebalancing: $150
- Deposits to Aave: $350
- Monthly yield: ~$1.25-1.75

### Is Aave safe?

**Aave is one of the most trusted DeFi protocols:**

- TVL: $10B+ (billions locked)
- Audited multiple times
- 4+ years of operation
- Used by institutions

**But risks exist:**
- Smart contract risk (all DeFi has this)
- Liquidation risk (not applicable here - we're only supplying)
- Oracle risk (minimal)

**My take:** I use it personally. Safer than most DeFi.

### Can I disable yield farming?

**Yes, simple config change.**

Edit `config.js`:

```javascript
export const BOT_CONFIG = {
    ENABLE_YIELD_FARMING: false,  // Was true
    // ...
};
```

Bot will keep all USDC in wallet.

**Why you might disable:**
- Don't want any smart contract risk
- Need maximum liquidity
- Already farming elsewhere

---

## 🎛️ Customization

### Can I add more assets?

**Yes, but requires some work.**

**Steps:**
1. Find token contract address on Base
2. Check it has liquidity on 1inch
3. Add to `TOKENS` in config.js
4. Add to `TARGET_RATIOS`
5. Add CoinGecko ID to `COINGECKO_IDS`
6. Test in dry-run mode

**Example adding LINK:**

```javascript
export const TOKENS = {
    // Existing tokens...
    LINK: {
        symbol: "LINK",
        address: "0x...", // LINK address on Base
        decimals: 18
    },
};

export const TARGET_RATIOS = {
    BTC: { target: 0.30, min: 0.29, max: 0.31 },
    ETH: { target: 0.20, min: 0.19, max: 0.21 },
    LINK: { target: 0.10, min: 0.09, max: 0.11 }, // New
    stETH: { target: 0.20, min: 0.19, max: 0.21 },
    USDC: { target: 0.20, min: 0.19, max: 0.21 },
    // Must sum to 1.0!
};

export const COINGECKO_IDS = {
    // Existing...
    LINK: "chainlink",
};
```

### How do I change rebalancing frequency?

**Edit config.js:**

```javascript
export const BOT_CONFIG = {
    REBALANCE_INTERVAL_HOURS: 4,  // Change from 2 to 4
};
```

**Recommendations:**
- **2 hours:** Volatile markets, want tight control
- **4 hours:** Normal markets (recommended)
- **6-8 hours:** Stable markets, minimize gas
- **12+ hours:** Very low volatility

**Trade-off:**
- More frequent = tighter control + higher gas
- Less frequent = lower gas + looser control

### Can I set different slippage?

**Yes, edit config.js:**

```javascript
export const MAX_SLIPPAGE = 5;  // 5% max slippage (was 3%)
```

**When to increase:**
- Low liquidity tokens
- Large swaps
- Volatile markets

**When to decrease:**
- High liquidity tokens
- Small swaps
- Stable markets

**Recommendation:** Keep at 3% for most cases.

---

## 🔍 Monitoring & Maintenance

### How do I know if the bot is working?

**Multiple ways to monitor:**

1. **Telegram notifications** (if configured)
   - Every rebalancing sends update
   - Errors send alerts
   - Daily summary

2. **Logs**
   - Check terminal output
   - Or: `pm2 logs` if using PM2

3. **Check your wallet**
   - See if ratios are maintained
   - Check Aave balance

**Healthy bot shows:**
- Regular rebalancing (every 2-4h)
- No repeated errors
- Portfolio stays balanced
- Telegram alerts arriving

### What maintenance is needed?

**Weekly:**
- Quick check that bot is running
- Review Telegram history for errors
- Verify portfolio ratios look good

**Monthly:**
- Check for bot updates (git pull)
- Review gas costs vs yield
- Adjust thresholds if needed

**Quarterly:**
- Review overall strategy
- Consider changing ratios
- Update Node.js if major version

**That's it.** Very low maintenance once set up.

### How do I update the bot?

**When updates are available:**

```bash
cd crypto-rebalancing-bot
git pull origin main
npm install  # In case dependencies changed
pm2 restart all  # If using PM2
```

**Updates include:**
- Bug fixes
- New features
- Security patches
- Performance improvements

**You'll be notified** when updates are available (via GitHub watch or my announcement).

---

## 🆘 Troubleshooting

### Bot won't start

**Check these in order:**

1. **Node.js version**
   ```bash
   node --version  # Should be v18+
   ```

2. **.env file exists and is configured**
   ```bash
   ls -la | grep .env  # Should show .env file
   ```

3. **All dependencies installed**
   ```bash
   npm install
   ```

4. **Private key format**
   - Should be 64 hex characters
   - With or without 0x prefix

### "Insufficient balance" errors

**Causes:**
1. Don't have all 4 tokens in wallet
2. Wrong network (not Base)
3. Token addresses wrong in config
4. Not enough of a specific token

**How to fix:**
1. Check wallet on basescan.org
2. Verify you have BTC, ETH, stETH, USDC
3. Verify network is Base (chain ID 8453)
4. Check config.js token addresses match actual tokens

### Telegram not working

**Check:**
1. Did you send `/start` to your bot?
2. Is token correct in .env?
3. Is chat ID correct?
4. Is bot blocked?

**Test:**
```bash
# In bot directory
node -e "
const notifier = require('./notifier.js');
notifier.sendTelegramMessage('Test message');
"
```

If you see error, token/chat ID is wrong.

### "RPC error" or connection issues

**Try:**
1. Check RPC URL in .env is correct
2. Verify RPC endpoint is working (check Infura/Alchemy dashboard)
3. Try public RPC: `https://mainnet.base.org`
4. Bot will auto-rotate to backups

**If persists:**
- Contact your RPC provider
- Check if your IP is blocked
- Verify internet connection

---

## 💬 Getting Help

### What's included in support?

**1 week of setup support:**
- Help with installation
- Configuration issues
- Understanding how it works
- Basic troubleshooting

**Not included:**
- Extensive customization (basic help OK)
- Teaching JavaScript/blockchain
- 24/7 availability (I reply in the day usually)

### How to contact me

**For support:**
- **Email:** rozier.exe@gmail.com

**For bugs:**
- GitHub Issues (if you want it tracked)

**When contacting:**
- Describe the issue clearly
- Include error messages (copy/paste)
- Say what you've already tried
- Screenshots help

**Response time:**
- Usually 12-24 hours
- Sometimes faster
- Rarely >48 hours

### What if I'm stuck?

**Don't panic. Common issues:**

1. **Config problems** - 80% of issues
   - Re-read SETUP.md carefully
   - Check .env file character by character

2. **Wallet/network issues** - 15%
   - Verify Base network
   - Check you have all tokens

3. **Actual bugs** - 5%
   - Contact me with details
   - I'll fix ASAP

**Most issues are solved in <1 hour** with proper info.

---

## 📚 Resources

### Useful Links

- **Main README:** [README.md](README.md)
- **1inch API:** https://portal.1inch.dev
- **Aave V3 Docs:** https://docs.aave.com
- **Base Network:** https://base.org
- **Basescan Explorer:** https://basescan.org

### Community

- **GitHub Issues:** Report bugs

### Learning Resources

**Want to understand DeFi better?**
- Finematics YouTube (DeFi explained)
- Aave documentation
- 1inch documentation

**Want to learn JavaScript/Node.js?**
- Node.js official docs
- JavaScript.info
- MDN Web Docs

---

**Still have questions? Contact me: @YOUR_TELEGRAM_HANDLE**
