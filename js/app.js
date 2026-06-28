// ============================================
// 投資帳本 — 前端渲染邏輯
// 只讀取 repo 內的靜態 json（由 GitHub Actions 排程更新），
// 不直接打股價 API，避免 CORS 問題。
// ============================================

const fmtMoney = (n, currency) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const symbol = currency === "USD" ? "$" : "NT$";
  return `${sign}${symbol}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const fmtPct = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const arrow = n > 0 ? "▲" : n < 0 ? "▼" : "▬";
  return `${arrow} ${Math.abs(n).toFixed(2)}%`;
};

const plClass = (n) => (n > 0 ? "gain" : n < 0 ? "loss" : "");

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`無法讀取 ${path}`);
  return res.json();
}

function quoteKey(market, ticker) {
  return `${market}:${ticker}`;
}

function toTWD(amount, currency, fxRate) {
  if (currency === "TW") return amount;
  if (!fxRate || !fxRate.USDTWD) return null;
  return amount * fxRate.USDTWD;
}

let STATE = { holdings: [], watchlist: [], prices: {}, alerts: {} };

async function init() {
  try {
    const [holdingsData, watchlistData, pricesData, alertsData] = await Promise.all([
      loadJSON("data/holdings.json"),
      loadJSON("data/watchlist.json"),
      loadJSON("data/prices.json"),
      loadJSON("data/alerts.json"),
    ]);
    STATE.holdings = holdingsData.holdings || [];
    STATE.watchlist = watchlistData.watchlist || [];
    STATE.prices = pricesData;
    STATE.alerts = alertsData;

    renderLastUpdated(pricesData.lastUpdated);
    renderTicker();
    renderDashboard();
    renderHoldings();
    renderWatchlist();
  } catch (err) {
    console.error(err);
    document.getElementById("lastUpdated").textContent = "資料讀取失敗，稍後再試";
  }
}

function renderLastUpdated(ts) {
  const el = document.getElementById("lastUpdated");
  if (!ts) {
    el.textContent = "尚未有股價資料（等待第一次排程執行）";
    return;
  }
  const d = new Date(ts);
  el.textContent = `股價更新於 ${d.toLocaleString("zh-TW", { hour12: false })}`;
}

function getQuote(market, ticker) {
  const q = STATE.prices.quotes && STATE.prices.quotes[quoteKey(market, ticker)];
  return q && typeof q.price === "number" ? q : null;
}

function computeHolding(h) {
  const q = getQuote(h.market, h.ticker);
  const currency = h.market === "TW" ? "TWD" : "USD";
  const currentPrice = q ? q.price : null;
  const plPct = currentPrice !== null ? ((currentPrice - h.avgCost) / h.avgCost) * 100 : null;
  const investedNative = h.shares * h.avgCost;
  const valueNative = currentPrice !== null ? h.shares * currentPrice : null;
  const investedTWD = toTWD(investedNative, h.market, STATE.prices.fxRate);
  const valueTWD = valueNative !== null ? toTWD(valueNative, h.market, STATE.prices.fxRate) : null;
  return { ...h, currency, currentPrice, plPct, investedNative, valueNative, investedTWD, valueTWD };
}

function renderTicker() {
  const el = document.getElementById("tickerTape");
  el.innerHTML = "";
  const items = STATE.holdings.map(computeHolding);
  if (items.length === 0) {
    el.innerHTML = `<div class="ticker-item"><span class="t-name">尚無持股</span></div>`;
    return;
  }
  items.forEach((it) => {
    const dirClass = it.plPct > 0 ? "up" : it.plPct < 0 ? "down" : "";
    el.insertAdjacentHTML(
      "beforeend",
      `<div class="ticker-item">
         <span class="t-name">${it.ticker}</span>
         <span class="t-price">${it.currentPrice !== null ? it.currentPrice.toLocaleString() : "—"}</span>
         <span class="t-delta ${dirClass}">${fmtPct(it.plPct)}</span>
       </div>`
    );
  });
}

function renderDashboard() {
  const items = STATE.holdings.map(computeHolding);
  const hint = document.getElementById("dashboardHint");

  if (items.length === 0) {
    hint.hidden = false;
    document.getElementById("statInvested").textContent = "—";
    document.getElementById("statValue").textContent = "—";
    document.getElementById("statPL").textContent = "—";
    document.getElementById("rankingList").innerHTML = "";
    return;
  }
  hint.hidden = true;

  let totalInvested = 0, totalValue = 0, hasMissing = false;
  items.forEach((it) => {
    if (it.investedTWD === null || it.valueTWD === null) { hasMissing = true; return; }
    totalInvested += it.investedTWD;
    totalValue += it.valueTWD;
  });
  const totalPL = totalValue - totalInvested;
  const totalPLPct = totalInvested ? (totalPL / totalInvested) * 100 : null;

  document.getElementById("statInvested").textContent = fmtMoney(totalInvested, "TWD");
  document.getElementById("statValue").textContent = fmtMoney(totalValue, "TWD");

  const plEl = document.getElementById("statPL");
  plEl.textContent = `${fmtMoney(totalPL, "TWD")} ${totalPLPct !== null ? `(${fmtPct(totalPLPct)})` : ""}`;
  plEl.className = `stat-value ${plClass(totalPL)}`;

  const ranked = items
    .filter((it) => it.plPct !== null)
    .sort((a, b) => b.plPct - a.plPct);

  const list = document.getElementById("rankingList");
  list.innerHTML = "";
  ranked.forEach((it) => {
    list.insertAdjacentHTML("beforeend", ledgerRowHTML(it));
  });
  if (hasMissing) {
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="hint-box">部分持股還沒有最新股價，等下一次排程更新後金額會更準確。</div>`
    );
  }
}

function ledgerRowHTML(it) {
  const currencySymbol = it.market === "TW" ? "NT$" : "$";
  return `
    <div class="ledger-row">
      <div class="name-block">
        <div><span class="ticker-code">${it.market} ${it.ticker}</span><span class="name">${it.name}</span></div>
        <div class="sub">${it.shares.toLocaleString()} 股 ・ 均成本 ${currencySymbol}${it.avgCost.toLocaleString()}</div>
      </div>
      <div class="num-block">
        <div class="pl-pct ${plClass(it.plPct)}">${fmtPct(it.plPct)}</div>
        <div class="price-line">現價 ${it.currentPrice !== null ? currencySymbol + it.currentPrice.toLocaleString() : "—"}</div>
      </div>
    </div>`;
}

function renderHoldings() {
  const list = document.getElementById("holdingsList");
  list.innerHTML = "";
  if (STATE.holdings.length === 0) {
    list.innerHTML = `<div class="hint-box">目前沒有任何持股。</div>`;
    return;
  }
  STATE.holdings.map(computeHolding).forEach((it) => {
    const lockedAlert = (STATE.alerts.holdingAlerts || []).find((a) => a.holdingId === it.id);
    const lockedCost = lockedAlert ? lockedAlert.lockedCost : it.avgCost;
    const currencySymbol = it.market === "TW" ? "NT$" : "$";
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="ledger-row">
        <div class="name-block">
          <div><span class="ticker-code">${it.market} ${it.ticker}</span><span class="name">${it.name}</span></div>
          <div class="sub">${it.shares.toLocaleString()} 股 ・ 通知基準價 ${currencySymbol}${lockedCost.toLocaleString()}</div>
        </div>
        <div class="num-block">
          <div class="pl-pct ${plClass(it.plPct)}">${fmtPct(it.plPct)}</div>
          <div class="price-line">現價 ${it.currentPrice !== null ? currencySymbol + it.currentPrice.toLocaleString() : "—"}</div>
        </div>
      </div>`
    );
  });
}

function renderWatchlist() {
  const list = document.getElementById("watchlistList");
  list.innerHTML = "";
  if (STATE.watchlist.length === 0) {
    list.innerHTML = `<div class="hint-box">目前沒有觀察標的。</div>`;
    return;
  }
  STATE.watchlist.forEach((w) => {
    const q = getQuote(w.market, w.ticker);
    const currentPrice = q ? q.price : null;
    const currencySymbol = w.market === "TW" ? "NT$" : "$";
    const nearestTarget = [...w.targetPrices].sort((a, b) => b - a)[0];
    const distancePct = currentPrice !== null && nearestTarget
      ? ((currentPrice - nearestTarget) / nearestTarget) * 100
      : null;
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="ledger-row">
        <div class="name-block">
          <div><span class="ticker-code">${w.market} ${w.ticker}</span><span class="name">${w.name}</span></div>
          <div class="sub">目標價 ${w.targetPrices.map((p) => currencySymbol + p.toLocaleString()).join(" / ")}</div>
        </div>
        <div class="num-block">
          <div class="pl-pct">${currentPrice !== null ? currencySymbol + currentPrice.toLocaleString() : "—"}</div>
          <div class="price-line">${distancePct !== null ? `距最近目標 ${fmtPct(distancePct)}` : ""}</div>
        </div>
      </div>`
    );
  });
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(`panel-${tab.dataset.panel}`).classList.add("active");
  });
});

init();
