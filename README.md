# BTC Advisor

A static Bitcoin **buy / sell / hold advisor** with paper trading and a history backtest. Built for learning — not for real money.

It loads about **1,000 candles each** on **1 hour, 4 hour, and daily**, stacks them into one call, draws volume plus nearby swing support/resistance, and runs the **same rules** over that download so you can see how the toy behaved. Everything runs in the browser. No backend, no login, no exchange API keys.

**This is not financial advice.** Past signals and backtests are not future returns. Paper trading only.

Live (once GitHub Pages is enabled on `main` / root):
https://mozzer20.github.io/btc-advisor/

## How to run locally

No build step and no dependencies.

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/

Opening `index.html` as a `file://` page can block the public API fetches; a tiny local server is more reliable.

## GitHub Pages

Static files at the repo root. Enable Pages: **Settings → Pages → Deploy from a branch → main / (root)**. `.nojekyll` is included so Jekyll does not process the site.

## How the live call is stacked

| Layer | Job |
| --- | --- |
| **Daily** | Trend. SMA 20 above SMA 50 = up; below = down. |
| **4 hour** | Trigger. RSI(14) under 30, a bullish SMA 20/50 cross, or a bounce near 4h swing support (and the mirror for sells). |
| **1 hour** | Timing. Do not buy into nearby resistance / a high RSI; do not sell into nearby support / a low RSI. |

**BUY** only if daily is up **and** 4h triggered **and** 1h timing is OK.
**SELL** only if daily is down **and** 4h triggered **and** 1h timing is OK.
Anything mixed is **HOLD**. The one-sentence reason names which layer agreed or vetoed.

Also shown (they colour the sentence; they do not override the stack):

- **Volume** vs its 20-bar average (heavy if 1.3x or more)
- **Swing highs/lows**: local fractal, 5 bars either side, confirmed (no lookahead on unconfirmed bars). Nearest swing below price = support; nearest above = resistance. Near = within about 1.2%.

RSI uses Wilder smoothing on closes. SMAs are simple averages.

## Backtest (how this setup did X is computed)

After history loads, the app walks **each 1-hour close** in the download (after a 50-bar warmup so SMA 50 exists):

1. Look up the latest 4h and daily candles at that timestamp.
2. Compute the **same** daily / 4h / 1h indicators and the **same** BUY/SELL/HOLD stack.
3. **Long-only:** first BUY while flat spends the whole virtual $10,000 at that hour's close. Next SELL sells all BTC at that close. HOLD does nothing. BUY while already long is ignored.
4. Round-trip return = (sell - buy) / buy. Win rate = profitable exits / closed exits.
5. Equity is marked to market every hour. Max drawdown is the worst peak-to-trough on that curve.

Fills at the **same bar's close** as the signal — kinder than a real order. Open trades at the end are marked to the last price but not counted as wins/losses until closed.

The panel labels this as **past data on this download**, not a guarantee. A handful of trades is a small sample, not an edge.

Paper-trading buttons on the page are separate: they use the live USD print and `localStorage`, not the backtest ledger.

## Data source

Tried in order, public, no key. Full history on first load (~1,000 x 3 timeframes). Every **30 seconds** only the ticker and the last few candles are refreshed so the API is not spammed.

1. **Binance** `https://api.binance.com/api/v3/` — BTCUSDT klines (`1h`, `4h`, `1d`, limit 1000), 24h ticker, BTCGBP spot
2. **Binance US** `https://api.binance.us/api/v3/` if `.com` is geo-blocked
3. **Coinbase Exchange** `https://api.exchange.coinbase.com` — BTC-USD candles paginated (~300 per page) plus BTC-GBP ticker

## Disclaimer

Educational paper trading only. Not financial advice, not a broker, not an exchange. Bitcoin is volatile; you can lose money. Do not use this to place real orders.
