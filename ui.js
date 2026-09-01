/* BTC Advisor UI — paper book, charts, wiring. */
(function () {
  "use strict";
  const A = window.ADV;
  const el = function (id) { return document.getElementById(id); };
  const state = A.state;
  const usd = A.usd;
  const gbp = A.gbp;
  const fmtBtc = A.fmtBtc;
  const fmtWhen = A.fmtWhen;
  const pct = A.pct;
  const TF = A.TF;
  const START_CASH = A.START_CASH;
  const REFRESH_MS = A.REFRESH_MS;
  const BOOK_KEY = "btc-advisor-book-v1";
  const HIST_KEY = "btc-advisor-signals-v1";
  const MAX_HISTORY = 12;
  const MAX_FILLS = 20;
  const RECENT_BARS = 180;
  const SMA_FAST = 20;
  const SMA_SLOW = 50;
  const smaSeries = A.smaSeries;
  const loadMarket = A.loadMarket;
  const liveAdvice = A.liveAdvice;
  const runBacktest = A.runBacktest;

  function setFeed(kind, label, meta) {
    el("feedDot").className = "dot " + kind;
    el("feedLabel").textContent = label;
    if (meta) el("feedMeta").textContent = meta;
  }

  function showBanner(msg) {
    const b = el("banner");
    if (!msg) { b.hidden = true; b.textContent = ""; return; }
    b.hidden = false;
    b.textContent = msg;
  }

  function paintPrice() {
    el("priceUsd").textContent = usd(state.usd);
    el("priceGbp").textContent = state.gbp != null ? gbp(state.gbp) + " approx" : "GBP feed unavailable";
    const chg = el("chg24");
    if (state.chg24 == null) { chg.textContent = "24h —"; chg.className = "pill"; }
    else {
      const sign = state.chg24 >= 0 ? "+" : "";
      chg.textContent = "24h " + sign + state.chg24.toFixed(2) + "%";
      chg.className = "pill " + (state.chg24 >= 0 ? "up" : "down");
    }
    const n1 = state.series["1h"].length;
    const n4 = state.series["4h"].length;
    const nd = state.series["1d"].length;
    el("asOf").textContent = state.lastOk
      ? fmtWhen(state.lastOk) + " · " + n1 + "x1h " + n4 + "x4h " + nd + "x1d"
      : "loading history…";
  }

  function volLabel(ind) {
    if (!ind || ind.volRatio == null) return "—";
    return ind.volRatio.toFixed(2) + "x";
  }

  function paintMinis(live) {
    function fillMini(id, ind, biasEl, rsi, s20, s50, vol, extra) {
      const card = el(id);
      const trend = ind ? ind.trend : "FLAT";
      card.className = "card mini " + (trend === "UP" ? "up" : trend === "DOWN" ? "down" : "flat");
      el(biasEl).textContent = !ind ? "—" : trend === "UP" ? "UP" : trend === "DOWN" ? "DOWN" : "FLAT";
      el(rsi).textContent = ind && ind.rsi != null ? ind.rsi.toFixed(1) : "—";
      el(s20).textContent = ind && ind.sma20 != null ? usd(ind.sma20, 0) : "—";
      el(s50).textContent = ind && ind.sma50 != null ? usd(ind.sma50, 0) : "—";
      el(vol).textContent = volLabel(ind);
      if (extra) extra(ind);
    }
    fillMini("miniD", live.d, "miniDBias", "dRsi", "dS20", "dS50", "dVol");
    fillMini("mini4", live.h4, "mini4Bias", "h4Rsi", "h4S20", "h4S50", "h4Vol");
    fillMini("mini1", live.h1, "mini1Bias", "h1Rsi", "h1Sup", "h1Res", "h1Vol", function (ind) {
      el("h1Sup").textContent = ind && ind.support ? usd(ind.support.p, 0) : "—";
      el("h1Res").textContent = ind && ind.resist ? usd(ind.resist.p, 0) : "—";
    });
    el("dailyBias").textContent = live.d ? live.d.trend : "—";
    el("h4Trig").textContent = !live.trig ? "—" : live.trig.buy ? "BUY trig" : live.trig.sell ? "SELL trig" : "quiet";
    el("h1Time").textContent = !live.h1 ? "—" : live.h1.nearResist ? "at resist" : live.h1.nearSupport ? "at support" : (live.h1.rsi != null ? "RSI " + live.h1.rsi.toFixed(0) : "—");
  }

  function paintSignal(live) {
    state.live = live;
    const card = el("signalCard");
    card.className = "card signal-card " + live.signal.toLowerCase();
    el("signalWord").textContent = live.signal;
    el("signalWhy").textContent = live.why;
    paintMinis(live);
    rememberSignal(live);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  function rememberSignal(adv) {
    if (!adv || !adv.signal) return;
    const hist = loadJson(HIST_KEY, []);
    if (hist[0] && hist[0].signal === adv.signal) return;
    hist.unshift({ signal: adv.signal, why: adv.why, price: state.usd, t: Date.now() });
    saveJson(HIST_KEY, hist.slice(0, MAX_HISTORY));
    paintHistory();
  }

  function escapeHtml(s) {
    return String(s).replace(/\u0026/g, "\u0026amp;").replace(/\u003c/g, "\u0026lt;").replace(/\u003e/g, "\u0026gt;");
  }

  function paintHistory() {
    const hist = loadJson(HIST_KEY, []);
    const box = el("history");
    if (!hist.length) {
      box.innerHTML = '<li class="empty">Waiting for the first call…</li>';
      return;
    }
    box.innerHTML = hist.map(function (h) {
      return "<li><div><span class=\"badge " + h.signal + "\">" + h.signal +
        '</span> <span class="muted">' + fmtWhen(h.t) + "</span></div><div>" +
        escapeHtml(h.why) + '</div><div class="muted">Price ' + usd(h.price) + "</div></li>";
    }).join("");
  }

  function defaultBook() { return { cash: START_CASH, btc: 0, fills: [] }; }

  function getBook() {
    const b = loadJson(BOOK_KEY, null);
    if (!b || typeof b.cash !== "number") return defaultBook();
    return b;
  }

  function paintBook() {
    const book = getBook();
    const px = state.usd || 0;
    const eq = book.cash + book.btc * px;
    const pnl = eq - START_CASH;
    el("statCash").textContent = usd(book.cash);
    el("statBtc").textContent = fmtBtc(book.btc);
    el("statEquity").textContent = usd(eq);
    const pnlEl = el("statPnl");
    pnlEl.textContent = (pnl > 0 ? "+" : "") + usd(pnl);
    pnlEl.className = Math.abs(pnl) < 0.005 ? "flat" : pnl > 0 ? "up" : "down";
    const canBuy = px > 0 && book.cash >= 1;
    const canSell = px > 0 && book.btc > 0;
    document.querySelectorAll("[data-buy]").forEach(function (b) { b.disabled = !canBuy; });
    document.querySelectorAll("[data-sell]").forEach(function (b) { b.disabled = !canSell; });
    const fills = el("fills");
    if (!book.fills.length) fills.innerHTML = '<li class="empty">No paper fills yet.</li>';
    else {
      fills.innerHTML = book.fills.map(function (f) {
        return "<li><div><strong>" + (f.side === "buy" ? "Bought" : "Sold") + "</strong> " +
          fmtBtc(f.qty) + " BTC @ " + usd(f.price) + '</div><div class="muted">' +
          fmtWhen(f.t) + " · " + usd(f.notional) + "</div></li>";
      }).join("");
    }
  }

  function flash(msg) {
    const n = el("tradeFlash");
    n.hidden = false;
    n.textContent = msg;
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { n.hidden = true; }, 4000);
  }

  function buyFrac(frac) {
    const book = getBook();
    const px = state.usd;
    if (!px) return flash("No live price yet.");
    const spend = book.cash * frac;
    if (spend < 1) return flash("Not enough cash to buy.");
    const qty = spend / px;
    book.cash -= spend;
    book.btc += qty;
    book.fills.unshift({ side: "buy", qty: qty, price: px, notional: spend, t: Date.now() });
    book.fills = book.fills.slice(0, MAX_FILLS);
    saveJson(BOOK_KEY, book);
    paintBook();
    flash("Paper buy: " + fmtBtc(qty) + " BTC for " + usd(spend) + ".");
  }

  function sellFrac(frac) {
    const book = getBook();
    const px = state.usd;
    if (!px) return flash("No live price yet.");
    const qty = book.btc * frac;
    if (qty <= 0) return flash("No BTC to sell.");
    const notional = qty * px;
    book.btc -= qty;
    if (book.btc < 1e-12) book.btc = 0;
    book.cash += notional;
    book.fills.unshift({ side: "sell", qty: qty, price: px, notional: notional, t: Date.now() });
    book.fills = book.fills.slice(0, MAX_FILLS);
    saveJson(BOOK_KEY, book);
    paintBook();
    flash("Paper sell: " + fmtBtc(qty) + " BTC for " + usd(notional) + ".");
  }

  function resetBook() {
    if (!confirm("Reset the paper book to $10,000 cash and zero BTC?")) return;
    saveJson(BOOK_KEY, defaultBook());
    paintBook();
    flash("Paper book reset.");
  }

  function sizeCanvas(canvas, cssH) {
    const wrap = canvas.parentElement;
    const cssW = Math.max(280, wrap.clientWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  function drawChart() {
    const cssH = window.innerWidth < 640 ? 260 : 360;
    const s = sizeCanvas(el("chart"), cssH);
    const ctx = s.ctx, W = s.w, H = s.h;
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, W, H);
    let candles = state.series[state.chartTf] || [];
    if (state.chartRange === "recent") candles = candles.slice(-RECENT_BARS);
    if (!candles.length) {
      ctx.fillStyle = "#8b96a8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Loading candles…", 16, H / 2);
      return;
    }
    el("chartTitle").textContent = "BTC · " + TF[state.chartTf].label + " · " + candles.length + " bars";
    const pad = { t: 14, r: 62, b: 22, l: 8 };
    const volH = Math.max(36, H * 0.18);
    const plotH = H - pad.t - pad.b - volH - 8;
    const plotW = W - pad.l - pad.r;
    let lo = Infinity, hi = -Infinity, maxV = 0;
    candles.forEach(function (c) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
      if (c.v > maxV) maxV = c.v;
    });
    const closes = candles.map(function (c) { return c.c; });
    const s20 = smaSeries(closes, SMA_FAST);
    const s50 = smaSeries(closes, SMA_SLOW);
    s20.concat(s50).forEach(function (v) {
      if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    });
    const live = state.live && state.live[state.chartTf === "1h" ? "h1" : state.chartTf === "4h" ? "h4" : "d"];
    if (live && live.support) lo = Math.min(lo, live.support.p);
    if (live && live.resist) hi = Math.max(hi, live.resist.p);
    const padY = (hi - lo) * 0.06 || 1;
    lo -= padY; hi += padY;
    const span = hi - lo || 1;
    const n = candles.length;
    const slot = plotW / n;
    function yOf(p) { return pad.t + ((hi - p) / span) * plotH; }
    function xOf(i) { return pad.l + (i + 0.5) * slot; }
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.fillStyle = "#8b96a8";
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const p = lo + (span * i) / 4;
      const y = yOf(p);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
      ctx.fillText(usd(p, 0), pad.l + plotW + 6, y + 3);
    }
    if (live && live.support) {
      ctx.strokeStyle = "rgba(192,132,252,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, yOf(live.support.p)); ctx.lineTo(pad.l + plotW, yOf(live.support.p)); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (live && live.resist) {
      ctx.strokeStyle = "rgba(192,132,252,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, yOf(live.resist.p)); ctx.lineTo(pad.l + plotW, yOf(live.resist.p)); ctx.stroke();
      ctx.setLineDash([]);
    }
    const bodyW = Math.max(1.2, slot * 0.62);
    const volTop = pad.t + plotH + 10;
    candles.forEach(function (c, i) {
      const x = xOf(i);
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? "#3dd68c" : "#ff5d6c";
      ctx.fillStyle = up ? "#3dd68c" : "#ff5d6c";
      ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
      const y1 = yOf(Math.max(c.o, c.c));
      const y2 = yOf(Math.min(c.o, c.c));
      ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1));
      const vh = maxV ? (c.v / maxV) * volH : 0;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = up ? "#2a6b4a" : "#6b3038";
      ctx.fillRect(x - bodyW / 2, volTop + volH - vh, bodyW, vh);
      ctx.globalAlpha = 1;
    });
    function strokeMa(series, color) {
      ctx.beginPath();
      let started = false;
      series.forEach(function (v, i) {
        if (v == null) return;
        const x = xOf(i), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    strokeMa(s20, "#f7931a");
    strokeMa(s50, "#6ec8ff");
    ctx.fillStyle = "#e8edf4";
    ctx.textAlign = "left";
    ctx.fillText(fmtWhen(candles[0].t).replace(" UK", ""), pad.l, H - 6);
    ctx.textAlign = "right";
    ctx.fillText(fmtWhen(candles[n - 1].t).replace(" UK", ""), pad.l + plotW, H - 6);
  }

  function drawEquity() {
    const cssH = 180;
    const s = sizeCanvas(el("equity"), cssH);
    const ctx = s.ctx, W = s.w, H = s.h;
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, W, H);
    const bt = state.backtest;
    if (!bt || !bt.equity.length) {
      ctx.fillStyle = "#8b96a8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Equity curve appears after history loads.", 16, H / 2);
      return;
    }
    const pad = { t: 12, r: 56, b: 22, l: 8 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    let lo = Infinity, hi = -Infinity;
    bt.equity.forEach(function (p) { if (p.eq < lo) lo = p.eq; if (p.eq > hi) hi = p.eq; });
    lo = Math.min(lo, START_CASH);
    hi = Math.max(hi, START_CASH);
    const padY = (hi - lo) * 0.08 || 1;
    lo -= padY; hi += padY;
    const span = hi - lo || 1;
    function yOf(v) { return pad.t + ((hi - v) / span) * plotH; }
    const n = bt.equity.length;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.fillStyle = "#8b96a8";
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    for (let i = 0; i <= 3; i++) {
      const v = lo + (span * i) / 3;
      const y = yOf(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
      ctx.fillText(usd(v, 0), pad.l + plotW + 6, y + 3);
    }
    const y0 = yOf(START_CASH);
    ctx.strokeStyle = "rgba(232,197,71,0.35)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(pad.l + plotW, y0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    bt.equity.forEach(function (p, i) {
      const x = pad.l + (i / Math.max(1, n - 1)) * plotW;
      const y = yOf(p.eq);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = bt.ret >= 0 ? "#3dd68c" : "#ff5d6c";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = "#e8edf4";
    ctx.textAlign = "left";
    ctx.fillText(fmtWhen(bt.equity[0].t).replace(" UK", ""), pad.l, H - 6);
    ctx.textAlign = "right";
    ctx.fillText(fmtWhen(bt.equity[n - 1].t).replace(" UK", ""), pad.l + plotW, H - 6);
  }

  function paintBacktest() {
    const bt = state.backtest;
    if (!bt) return;
    el("btSample").textContent = bt.bars + " hourly bars tested";
    el("btTrades").textContent = String(bt.trades) + (bt.open ? " (+open)" : "");
    el("btWin").textContent = bt.winRate == null ? "n/a" : (bt.winRate * 100).toFixed(0) + "% (" + bt.wins + "/" + bt.trades + ")";
    const retEl = el("btRet");
    retEl.textContent = pct(bt.ret);
    retEl.className = bt.ret > 0 ? "up" : bt.ret < 0 ? "down" : "flat";
    el("btDd").textContent = "-" + (bt.maxDd * 100).toFixed(1) + "%";
    el("btEq").textContent = usd(bt.endEq);
    const pnl = bt.endEq - START_CASH;
    const pnlEl = el("btPnl");
    pnlEl.textContent = (pnl > 0 ? "+" : "") + usd(pnl);
    pnlEl.className = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
    const box = el("btFills");
    if (!bt.closed.length) {
      box.innerHTML = '<li class="empty">No round trips on this download — the stack stayed mostly on hold. Small sample, not a verdict.</li>';
    } else {
      const rows = bt.closed.slice(-12).reverse();
      box.innerHTML = rows.map(function (t) {
        const cls = t.ret > 0 ? "up" : "down";
        return "<li><div>Buy " + usd(t.entry) + " -> sell " + usd(t.px) +
          ' <strong class="' + cls + '">' + pct(t.ret) + "</strong></div><div class=\"muted\">" +
          fmtWhen(t.t) + "</div></li>";
      }).join("");
    }
    drawEquity();
  }

  async function tick(full) {
    try {
      const source = await loadMarket(full);
      showBanner("");
      const n = state.series["1h"].length;
      setFeed("live", "Live · " + source, source + " · " + n + " hourly bars · refresh ~30s (ticker + last candles)");
      paintPrice();
      const live = liveAdvice();
      paintSignal(live);
      paintBook();
      if (full || !state.backtest) {
        state.backtest = runBacktest();
        paintBacktest();
      }
      drawChart();
    } catch (err) {
      setFeed("err", "Feed error", "Keeping last good data if we have it");
      showBanner("Could not refresh prices (" + (err && err.message ? err.message : "network") +
        "). Tried Binance, Binance US, then Coinbase. Will retry. Paper trading only.");
      if (state.series["1h"].length) { paintPrice(); paintBook(); drawChart(); }
    }
  }

  function bind() {
    document.querySelectorAll("[data-buy]").forEach(function (btn) {
      btn.addEventListener("click", function () { buyFrac(parseFloat(btn.getAttribute("data-buy"))); });
    });
    document.querySelectorAll("[data-sell]").forEach(function (btn) {
      btn.addEventListener("click", function () { sellFrac(parseFloat(btn.getAttribute("data-sell"))); });
    });
    el("resetBtn").addEventListener("click", resetBook);
    document.querySelectorAll("[data-tf]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chartTf = btn.getAttribute("data-tf");
        document.querySelectorAll("[data-tf]").forEach(function (b) { b.classList.toggle("on", b === btn); });
        drawChart();
      });
    });
    document.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chartRange = btn.getAttribute("data-range");
        document.querySelectorAll("[data-range]").forEach(function (b) { b.classList.toggle("on", b === btn); });
        drawChart();
      });
    });
    window.addEventListener("resize", function () {
      drawChart();
      drawEquity();
    });
  }

  bind();
  paintHistory();
  paintBook();
  drawChart();
  drawEquity();
  tick(true);
  setInterval(function () { tick(false); }, REFRESH_MS);
})();
