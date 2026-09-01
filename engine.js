/* BTC Advisor engine — fetch, indicators, stack, backtest. No keys. */
(function (global) {
  "use strict";
  const REFRESH_MS = 30000;
  const START_CASH = 10000;
  const RSI_N = 14;
  const SMA_FAST = 20;
  const SMA_SLOW = 50;
  const VOL_N = 20;
  const SWING_L = 5;
  const SWING_R = 5;
  const WANT = 1000;
  const RECENT_BARS = 180;
  const SR_NEAR = 0.012;
  const VOL_HEAVY = 1.3;

  const TF = {
    "1h": { interval: "1h", gran: 3600, ms: 3600000, label: "1 hour" },
    "4h": { interval: "4h", gran: 14400, ms: 14400000, label: "4 hour" },
    "1d": { interval: "1d", gran: 86400, ms: 86400000, label: "Daily" }
  };

  const state = {
    series: { "1h": [], "4h": [], "1d": [] },
    usd: null,
    gbp: null,
    chg24: null,
    source: "",
    lastOk: 0,
    chartTf: "1h",
    chartRange: "recent",
    live: null,
    backtest: null
  };

  function usd(n, digits) {
    if (n == null || Number.isNaN(n)) return "—";
    const d = digits == null ? 2 : digits;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: d,
      maximumFractionDigits: d
    }).format(n);
  }

  function gbp(n) {
    if (n == null || Number.isNaN(n)) return "£ —";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  }

  function fmtBtc(n) { return (n || 0).toFixed(8); }

  function fmtWhen(ts) {
    try {
      return new Date(ts).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }) + " UK";
    } catch (e) {
      return new Date(ts).toLocaleString();
    }
  }

  function pct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + (n * 100).toFixed(1) + "%";
  }

  function sma(values, period) {
    if (!values || values.length < period) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return sum / period;
  }

  function smaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function rsiWilder(closes, period) {
    if (!closes || closes.length < period + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  function swings(candles) {
    const highs = [];
    const lows = [];
    const n = candles.length;
    for (let i = SWING_L; i < n - SWING_R; i++) {
      let isH = true, isL = true;
      for (let j = i - SWING_L; j <= i + SWING_R; j++) {
        if (j === i) continue;
        if (candles[j].h >= candles[i].h) isH = false;
        if (candles[j].l <= candles[i].l) isL = false;
      }
      if (isH) highs.push({ i: i, t: candles[i].t, p: candles[i].h });
      if (isL) lows.push({ i: i, t: candles[i].t, p: candles[i].l });
    }
    return { highs: highs, lows: lows };
  }

  function nearestSR(price, highs, lows) {
    let support = null, resist = null;
    for (let i = 0; i < lows.length; i++) {
      const s = lows[i];
      if (s.p <= price && (!support || s.p > support.p)) support = s;
    }
    for (let i = 0; i < highs.length; i++) {
      const s = highs[i];
      if (s.p >= price && (!resist || s.p < resist.p)) resist = s;
    }
    return { support: support, resist: resist };
  }

  function indicators(candles, endIdx) {
    if (!candles || endIdx == null || endIdx < SMA_SLOW) return null;
    const slice = candles.slice(0, endIdx + 1);
    const closes = slice.map(function (c) { return c.c; });
    const vols = slice.map(function (c) { return c.v; });
    const rsi = rsiWilder(closes, RSI_N);
    const sma20 = sma(closes, SMA_FAST);
    const sma50 = sma(closes, SMA_SLOW);
    const prev20 = sma(closes.slice(0, -1), SMA_FAST);
    const prev50 = sma(closes.slice(0, -1), SMA_SLOW);
    const bullCross = prev20 != null && prev50 != null && sma20 != null && sma50 != null && prev20 <= prev50 && sma20 > sma50;
    const bearCross = prev20 != null && prev50 != null && sma20 != null && sma50 != null && prev20 >= prev50 && sma20 < sma50;
    const volSma = sma(vols, VOL_N);
    const vol = vols[vols.length - 1];
    const volRatio = volSma ? vol / volSma : 1;
    const sw = swings(slice);
    const price = closes[closes.length - 1];
    const sr = nearestSR(price, sw.highs, sw.lows);
    const nearSupport = !!(sr.support && (price - sr.support.p) / price <= SR_NEAR);
    const nearResist = !!(sr.resist && (sr.resist.p - price) / price <= SR_NEAR);
    let trend = "FLAT";
    if (sma20 != null && sma50 != null) {
      if (sma20 > sma50) trend = "UP";
      else if (sma20 < sma50) trend = "DOWN";
    }
    return {
      rsi: rsi, sma20: sma20, sma50: sma50, bullCross: bullCross, bearCross: bearCross,
      vol: vol, volSma: volSma, volRatio: volRatio, price: price, trend: trend,
      support: sr.support, resist: sr.resist, nearSupport: nearSupport, nearResist: nearResist,
      swings: sw
    };
  }

  function lastAtOrBefore(candles, t) {
    let lo = 0, hi = candles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].t <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function h4Trigger(h4) {
    if (!h4 || h4.rsi == null) return { buy: false, sell: false, whyBuy: "", whySell: "" };
    const buyOversold = h4.rsi < 30;
    const buyCross = h4.bullCross;
    const buySr = h4.nearSupport && h4.rsi < 45;
    const sellOver = h4.rsi > 70;
    const sellCross = h4.bearCross;
    const sellSr = h4.nearResist && h4.rsi > 55;
    let whyBuy = "";
    if (buyOversold) whyBuy = "RSI oversold at " + h4.rsi.toFixed(0);
    else if (buyCross) whyBuy = "20-period average crossed above 50";
    else if (buySr) whyBuy = "price bounced near 4h swing support";
    let whySell = "";
    if (sellOver) whySell = "RSI stretched at " + h4.rsi.toFixed(0);
    else if (sellCross) whySell = "20-period average crossed below 50";
    else if (sellSr) whySell = "price stalled near 4h swing resistance";
    return {
      buy: buyOversold || buyCross || buySr,
      sell: sellOver || sellCross || sellSr,
      whyBuy: whyBuy,
      whySell: whySell
    };
  }

  function combine(d, h4, h1) {
    if (!d || !h4 || !h1) {
      return { signal: "HOLD", why: "Need more history on daily, 4-hour and 1-hour before the stack can vote.", trig: null };
    }
    const trig = h4Trigger(h4);
    const h1BuyTime = h1.rsi != null && h1.rsi < 62 && !h1.nearResist;
    const h1SellTime = h1.rsi != null && h1.rsi > 38 && !h1.nearSupport;
    const heavy = (h4.volRatio || 0) >= VOL_HEAVY || (h1.volRatio || 0) >= VOL_HEAVY;
    const volBit = heavy ? " Volume is heavy versus the last 20 bars." : "";
    const srBit = h1.nearSupport && h1.support
      ? " 1h is hugging swing support near " + usd(h1.support.p, 0) + "."
      : h1.nearResist && h1.resist
      ? " 1h is under swing resistance near " + usd(h1.resist.p, 0) + "."
      : "";
    let signal = "HOLD";
    if (d.trend === "UP" && trig.buy && h1BuyTime) signal = "BUY";
    else if (d.trend === "DOWN" && trig.sell && h1SellTime) signal = "SELL";
    let why;
    if (signal === "BUY") {
      why = "Daily trend is up (SMA 20 above SMA 50), the 4-hour chart triggered (" + trig.whyBuy + "), and 1-hour timing is not stretched into resistance.";
    } else if (signal === "SELL") {
      why = "Daily trend is down (SMA 20 below SMA 50), the 4-hour chart triggered (" + trig.whySell + "), and 1-hour timing is not washed out into support.";
    } else if (d.trend === "UP" && !trig.buy) {
      why = "Daily trend is up, but the 4-hour trigger has not fired (no oversold RSI, bullish cross, or support bounce) so the stack holds.";
    } else if (d.trend === "UP" && trig.buy && !h1BuyTime) {
      why = "Daily is up and 4-hour triggered, but 1-hour timing is poor (RSI high or sitting under resistance) so the stack holds.";
    } else if (d.trend === "DOWN" && !trig.sell) {
      why = "Daily trend is down, but the 4-hour trigger has not fired (no overbought RSI, bearish cross, or resistance stall) so the stack holds.";
    } else if (d.trend === "DOWN" && trig.sell && !h1SellTime) {
      why = "Daily is down and 4-hour triggered, but 1-hour timing is poor (RSI low or sitting on support) so the stack holds.";
    } else {
      why = "Daily averages are not clearly stacked, so the three-timeframe call is hold.";
    }
    why += volBit + srBit;
    return { signal: signal, why: why, trig: trig, heavy: heavy, h1BuyTime: h1BuyTime, h1SellTime: h1SellTime };
  }

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, 14000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function parseBinance(rows) {
    return rows.map(function (k) {
      return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] };
    });
  }

  async function binanceKlines(host, interval, want) {
    const limit = Math.min(1000, want);
    const url = host + "/klines?symbol=BTCUSDT&interval=" + interval + "&limit=" + limit;
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || !rows.length) throw new Error("no klines " + interval);
    return parseBinance(rows);
  }

  function parseCoinbase(rows) {
    return rows.map(function (r) {
      return { t: r[0] * 1000, l: +r[1], h: +r[2], o: +r[3], c: +r[4], v: +r[5] };
    }).sort(function (a, b) { return a.t - b.t; });
  }

  async function coinbaseKlines(granularity, want) {
    const max = 300;
    const out = [];
    const seen = {};
    let end = Math.floor(Date.now() / 1000);
    let pages = 0;
    while (out.length < want && pages < 5) {
      pages += 1;
      const start = end - max * granularity;
      const url = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=" +
        granularity + "&start=" + new Date(start * 1000).toISOString() +
        "&end=" + new Date(end * 1000).toISOString();
      const batch = await fetchJson(url);
      if (!Array.isArray(batch) || !batch.length) break;
      const mapped = parseCoinbase(batch);
      for (let i = 0; i < mapped.length; i++) {
        const c = mapped[i];
        if (!seen[c.t]) { seen[c.t] = 1; out.push(c); }
      }
      end = Math.floor(mapped[0].t / 1000) - granularity;
      if (mapped.length < 20) break;
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(-want);
  }

  function mergeCandles(existing, incoming) {
    const map = {};
    const all = (existing || []).concat(incoming || []);
    for (let i = 0; i < all.length; i++) map[all[i].t] = all[i];
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return map[t]; });
  }

  function stitchLive(candles, intervalMs, px) {
    if (!candles.length || !px) return candles;
    const last = candles[candles.length - 1];
    if (Date.now() - last.t < intervalMs * 1.05) {
      last.c = px;
      if (px > last.h) last.h = px;
      if (px < last.l) last.l = px;
    }
    return candles;
  }

  async function fromBinance(host, label, full) {
    const tasks = full
      ? [binanceKlines(host, "1h", WANT), binanceKlines(host, "4h", WANT), binanceKlines(host, "1d", WANT)]
      : [binanceKlines(host, "1h", 3), binanceKlines(host, "4h", 3), binanceKlines(host, "1d", 3)];
    const usd24 = fetchJson(host + "/ticker/24hr?symbol=BTCUSDT");
    const gbpP = fetchJson(host + "/ticker/price?symbol=BTCGBP").catch(function () { return null; });
    const pack = await Promise.all(tasks.concat([usd24, gbpP]));
    const h1 = pack[0], h4 = pack[1], d1 = pack[2], t24 = pack[3], gbpTick = pack[4];
    const lastUsd = +t24.lastPrice;
    return {
      h1: stitchLive(h1, TF["1h"].ms, lastUsd),
      h4: stitchLive(h4, TF["4h"].ms, lastUsd),
      d1: stitchLive(d1, TF["1d"].ms, lastUsd),
      usd: lastUsd,
      gbp: gbpTick ? +gbpTick.price : null,
      chg24: t24.priceChangePercent != null ? +t24.priceChangePercent : null,
      source: label
    };
  }

  async function fromCoinbase(full) {
    const want = full ? WANT : 3;
    const h1 = await coinbaseKlines(3600, want);
    const h4 = await coinbaseKlines(14400, want);
    const d1 = await coinbaseKlines(86400, want);
    const ticker = await fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker");
    const stats = await fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/stats");
    let gbpPx = null;
    try {
      const g = await fetchJson("https://api.exchange.coinbase.com/products/BTC-GBP/ticker");
      gbpPx = g && g.price != null ? +g.price : null;
    } catch (e) { gbpPx = null; }
    const lastUsd = +ticker.price;
    const open = stats && stats.open != null ? +stats.open : null;
    return {
      h1: stitchLive(h1, TF["1h"].ms, lastUsd),
      h4: stitchLive(h4, TF["4h"].ms, lastUsd),
      d1: stitchLive(d1, TF["1d"].ms, lastUsd),
      usd: lastUsd,
      gbp: gbpPx,
      chg24: open ? ((lastUsd - open) / open) * 100 : null,
      source: "Coinbase"
    };
  }

  async function loadMarket(full) {
    const attempts = [
      function () { return fromBinance("https://api.binance.com/api/v3", "Binance", full); },
      function () { return fromBinance("https://api.binance.us/api/v3", "Binance US", full); },
      function () { return fromCoinbase(full); }
    ];
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        const m = await attempts[i]();
        if (!m.h1 || m.h1.length < 60 || !m.usd) throw new Error("incomplete");
        if (full) {
          state.series["1h"] = m.h1;
          state.series["4h"] = m.h4;
          state.series["1d"] = m.d1;
        } else {
          state.series["1h"] = mergeCandles(state.series["1h"], m.h1);
          state.series["4h"] = mergeCandles(state.series["4h"], m.h4);
          state.series["1d"] = mergeCandles(state.series["1d"], m.d1);
          stitchLive(state.series["1h"], TF["1h"].ms, m.usd);
          stitchLive(state.series["4h"], TF["4h"].ms, m.usd);
          stitchLive(state.series["1d"], TF["1d"].ms, m.usd);
        }
        state.usd = m.usd;
        state.gbp = m.gbp;
        state.chg24 = m.chg24;
        state.source = m.source;
        state.lastOk = Date.now();
        return m.source;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("all price feeds failed");
  }

  function liveAdvice() {
    const h1s = state.series["1h"];
    const h4s = state.series["4h"];
    const d1s = state.series["1d"];
    const i1 = h1s.length - 1;
    const i4 = h4s.length - 1;
    const id = d1s.length - 1;
    const h1 = indicators(h1s, i1);
    const h4 = indicators(h4s, i4);
    const d = indicators(d1s, id);
    const c = combine(d, h4, h1);
    const ev = layerEvidence(d, h4, h1);
    return { d: d, h4: h4, h1: h1, signal: c.signal, why: c.why, trig: c.trig, evidence: ev };
  }

  function runBacktest() {
    const h1s = state.series["1h"];
    const h4s = state.series["4h"];
    const d1s = state.series["1d"];
    const equity = [];
    const closed = [];
    let cash = START_CASH;
    let btc = 0;
    let entry = null;
    let lastSig = "HOLD";
    let peak = START_CASH;
    let maxDd = 0;
    const start = SMA_SLOW + 2;
    for (let i = start; i < h1s.length; i++) {
      const t = h1s[i].t;
      const px = h1s[i].c;
      const i4 = lastAtOrBefore(h4s, t);
      const id = lastAtOrBefore(d1s, t);
      const h1 = indicators(h1s, i);
      const h4 = i4 >= SMA_SLOW ? indicators(h4s, i4) : null;
      const d = id >= SMA_SLOW ? indicators(d1s, id) : null;
      const sig = combine(d, h4, h1).signal;
      if (sig === "BUY" && lastSig !== "BUY" && btc === 0 && cash > 1) {
        btc = cash / px;
        entry = { t: t, px: px, qty: btc };
        cash = 0;
      } else if (sig === "SELL" && btc > 0) {
        cash = btc * px;
        const ret = (px - entry.px) / entry.px;
        closed.push({ t: t, px: px, entry: entry.px, ret: ret, qty: btc });
        btc = 0;
        entry = null;
      }
      lastSig = sig;
      const eq = cash + btc * px;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDd) maxDd = dd;
      equity.push({ t: t, eq: eq });
    }
    const lastPx = h1s.length ? h1s[h1s.length - 1].c : 0;
    const endEq = cash + btc * lastPx;
    const wins = closed.filter(function (tr) { return tr.ret > 0; }).length;
    return {
      equity: equity,
      closed: closed,
      trades: closed.length,
      wins: wins,
      winRate: closed.length ? wins / closed.length : null,
      endEq: endEq,
      ret: (endEq - START_CASH) / START_CASH,
      maxDd: maxDd,
      open: btc > 0,
      bars: Math.max(0, h1s.length - start)
    };
  }


  function gapPct(a, b) {
    if (a == null || b == null || !b) return null;
    return (a - b) / b;
  }

  function layerEvidence(d, h4, h1) {
    const trig = h4Trigger(h4);
    const h1BuyTime = !!(h1 && h1.rsi != null && h1.rsi < 62 && !h1.nearResist);
    const h1SellTime = !!(h1 && h1.rsi != null && h1.rsi > 38 && !h1.nearSupport);
    function pack(name, ind, vote, rule) {
      if (!ind) {
        return { name: name, vote: "NO", rule: "Not enough bars yet.", rsi: null, sma20: null, sma50: null, gap: null, trend: null, volRatio: null, distSup: null, distRes: null, support: null, resist: null, price: null };
      }
      return {
        name: name,
        vote: vote ? "YES" : "NO",
        rule: rule,
        rsi: ind.rsi,
        sma20: ind.sma20,
        sma50: ind.sma50,
        gap: gapPct(ind.sma20, ind.sma50),
        trend: ind.trend,
        volRatio: ind.volRatio,
        distSup: ind.support ? (ind.price - ind.support.p) / ind.price : null,
        distRes: ind.resist ? (ind.resist.p - ind.price) / ind.price : null,
        support: ind.support ? ind.support.p : null,
        resist: ind.resist ? ind.resist.p : null,
        price: ind.price
      };
    }
    let dRule = "Need daily SMA 50.";
    if (d) {
      const g = gapPct(d.sma20, d.sma50);
      const gTxt = g == null ? "" : " SMA20 is " + (g * 100).toFixed(2) + "% " + (g >= 0 ? "above" : "below") + " SMA50.";
      dRule = "Daily trend is " + d.trend + "." + gTxt + " BUY needs UP, SELL needs DOWN.";
    }
    let h4Rule = "Need 4h indicators.";
    if (h4 && h4.rsi != null) {
      const bits = [];
      bits.push("RSI " + h4.rsi.toFixed(1) + (h4.rsi < 30 ? " (<30 oversold)" : h4.rsi > 70 ? " (>70 stretched)" : " (not in 30/70 extremes)"));
      if (h4.bullCross) bits.push("bullish SMA cross this bar");
      if (h4.bearCross) bits.push("bearish SMA cross this bar");
      if (h4.nearSupport) bits.push("within 1.2% of swing support");
      if (h4.nearResist) bits.push("within 1.2% of swing resistance");
      if (trig.buy) h4Rule = "BUY trigger: " + (trig.whyBuy || bits.join("; ")) + ".";
      else if (trig.sell) h4Rule = "SELL trigger: " + (trig.whySell || bits.join("; ")) + ".";
      else h4Rule = "No 4h trigger. " + bits.join("; ") + ". Need RSI<30, bullish cross, or support bounce (sell: RSI>70, bearish cross, or resistance stall).";
    }
    let h1Rule = "Need 1h indicators.";
    if (h1 && h1.rsi != null) {
      const ds = h1.support ? ((h1.price - h1.support.p) / h1.price * 100).toFixed(2) + "% above support" : "no support below";
      const dr = h1.resist ? ((h1.resist.p - h1.price) / h1.price * 100).toFixed(2) + "% below resistance" : "no resistance above";
      if (h1BuyTime && !h1SellTime) h1Rule = "Timing OK for BUY only. RSI " + h1.rsi.toFixed(1) + "; " + ds + "; " + dr + ".";
      else if (h1SellTime && !h1BuyTime) h1Rule = "Timing OK for SELL only. RSI " + h1.rsi.toFixed(1) + "; " + ds + "; " + dr + ".";
      else if (h1BuyTime && h1SellTime) h1Rule = "Timing allows both. RSI " + h1.rsi.toFixed(1) + "; " + ds + "; " + dr + ".";
      else h1Rule = "Timing veto. RSI " + h1.rsi.toFixed(1) + " (BUY needs RSI<62 and not under resistance; SELL needs RSI>38 and not on support). " + ds + "; " + dr + ".";
    }
    const dBuy = !!(d && d.trend === "UP");
    const dSell = !!(d && d.trend === "DOWN");
    return {
      daily: pack("Daily trend", d, dBuy || dSell, dRule),
      h4: pack("4h trigger", h4, !!(trig && (trig.buy || trig.sell)), h4Rule),
      h1: pack("1h timing", h1, h1BuyTime || h1SellTime, h1Rule),
      trig: trig,
      h1BuyTime: h1BuyTime,
      h1SellTime: h1SellTime
    };
  }

  function stats(arr) {
    if (!arr || !arr.length) return { n: 0, mean: null, median: null, pos: null };
    const s = arr.slice().sort(function (a, b) { return a - b; });
    const n = s.length;
    const mean = s.reduce(function (a, b) { return a + b; }, 0) / n;
    const median = n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
    const pos = s.filter(function (x) { return x > 0; }).length / n;
    return { n: n, mean: mean, median: median, pos: pos };
  }

  function forwardStudy() {
    const h1s = state.series["1h"];
    const h4s = state.series["4h"];
    const d1s = state.series["1d"];
    const horizons = [6, 24, 168];
    const buckets = {
      BUY: { 6: [], 24: [], 168: [] },
      SELL: { 6: [], 24: [], 168: [] },
      HOLD: { 6: [], 24: [], 168: [] }
    };
    const start = SMA_SLOW + 2;
    let changes = 0;
    let last = null;
    for (let i = start; i < h1s.length; i++) {
      const t = h1s[i].t;
      const i4 = lastAtOrBefore(h4s, t);
      const id = lastAtOrBefore(d1s, t);
      const h1 = indicators(h1s, i);
      const h4 = i4 >= SMA_SLOW ? indicators(h4s, i4) : null;
      const d = id >= SMA_SLOW ? indicators(d1s, id) : null;
      const sig = combine(d, h4, h1).signal;
      if (last && sig !== last) changes += 1;
      last = sig;
      const px = h1s[i].c;
      for (let h = 0; h < horizons.length; h++) {
        const hrs = horizons[h];
        const j = i + hrs;
        if (j < h1s.length && buckets[sig]) {
          buckets[sig][hrs].push((h1s[j].c - px) / px);
        }
      }
    }
    const hours = Math.max(0, h1s.length - start);
    const out = {};
    ["BUY", "SELL", "HOLD"].forEach(function (sig) {
      out[sig] = {
        6: stats(buckets[sig][6]),
        24: stats(buckets[sig][24]),
        168: stats(buckets[sig][168])
      };
    });
    return { hours: hours, changes: changes, bySignal: out };
  }

  global.ADV = {
    REFRESH_MS: REFRESH_MS,
    START_CASH: START_CASH,
    TF: TF,
    state: state,
    usd: usd,
    gbp: gbp,
    fmtBtc: fmtBtc,
    fmtWhen: fmtWhen,
    pct: pct,
    loadMarket: loadMarket,
    liveAdvice: liveAdvice,
    runBacktest: runBacktest,
    layerEvidence: layerEvidence,
    forwardStudy: forwardStudy,
    smaSeries: smaSeries
  };
})(window);
