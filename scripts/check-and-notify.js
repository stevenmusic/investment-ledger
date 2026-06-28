// ============================================
// GitHub Action 用腳本：
// 1. 抓台股/美股即時價 + 美元匯率
// 2. 寫入 ../data/prices.json
// 3. 比對 alert 門檻（方案A：鎖定建立時成本，每5%通知一次）
// 4. 觸發的通知透過 web-push 送給所有訂閱裝置
// 5. 失效的訂閱（推播回410 Gone）會自動從 subscriptions.json 移除
//
// 執行方式（由 .github/workflows/update-prices.yml 呼叫）：
//   node scripts/check-and-notify.js
// ============================================

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const DATA_DIR = path.join(__dirname, "..", "data");
const paths = {
  holdings: path.join(DATA_DIR, "holdings.json"),
  watchlist: path.join(DATA_DIR, "watchlist.json"),
  prices: path.join(DATA_DIR, "prices.json"),
  alerts: path.join(DATA_DIR, "alerts.json"),
  subscriptions: path.join(DATA_DIR, "subscriptions.json"),
};

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

// ---------- 股價來源 ----------

// 台股：證交所 MIS 即時報價（非官方但廣泛使用，免金鑰）
async function fetchTWQuotes(tickers) {
  const out = {};
  if (tickers.length === 0) return out;
  try {
    // 先打首頁拿 session cookie
    const home = await fetch("https://mis.twse.com.tw/stock/index.jsp", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const cookie = home.headers.get("set-cookie") || "";

    const exch = tickers.map((t) => `tse_${t}.tw`).join("|");
    const res = await fetch(
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exch}&_=${Date.now()}`,
      { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://mis.twse.com.tw/stock/index.jsp", Cookie: cookie } }
    );
    const json = await res.json();
    (json.msgArray || []).forEach((row) => {
      const ticker = row.c; // 股票代號
      const price = parseFloat(row.z) || parseFloat(row.y); // z=成交價，無成交時退回昨收 y
      const prevClose = parseFloat(row.y);
      if (ticker && !Number.isNaN(price)) {
        out[ticker] = { price, prevClose: Number.isNaN(prevClose) ? null : prevClose };
      }
    });
  } catch (err) {
    console.error("台股報價抓取失敗：", err.message);
  }
  return out;
}

// 美股：Yahoo Finance chart API（免金鑰）
async function fetchUSQuotes(tickers) {
  const out = {};
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        const json = await res.json();
        const meta = json?.chart?.result?.[0]?.meta;
        if (meta && typeof meta.regularMarketPrice === "number") {
          out[t] = { price: meta.regularMarketPrice, prevClose: meta.previousClose ?? null };
        }
      } catch (err) {
        console.error(`美股 ${t} 報價抓取失敗：`, err.message);
      }
    })
  );
  return out;
}

// 匯率：frankfurter.app（免金鑰、開源）
async function fetchUSDTWD() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=TWD");
    const json = await res.json();
    return json?.rates?.TWD ?? null;
  } catch (err) {
    console.error("匯率抓取失敗：", err.message);
    return null;
  }
}

// ---------- 主流程 ----------

async function main() {
  const holdingsData = readJSON(paths.holdings);
  const watchlistData = readJSON(paths.watchlist);
  const prevPrices = fs.existsSync(paths.prices) ? readJSON(paths.prices) : { quotes: {} };
  const alerts = readJSON(paths.alerts);
  const subsData = readJSON(paths.subscriptions);

  const holdings = holdingsData.holdings || [];
  const watchlist = watchlistData.watchlist || [];

  const twTickers = [...new Set([
    ...holdings.filter((h) => h.market === "TW").map((h) => h.ticker),
    ...watchlist.filter((w) => w.market === "TW").map((w) => w.ticker),
  ])];
  const usTickers = [...new Set([
    ...holdings.filter((h) => h.market === "US").map((h) => h.ticker),
    ...watchlist.filter((w) => w.market === "US").map((w) => w.ticker),
  ])];

  const [twQuotes, usQuotes, usdtwd] = await Promise.all([
    fetchTWQuotes(twTickers),
    fetchUSQuotes(usTickers),
    fetchUSDTWD(),
  ]);

  const quotes = { ...(prevPrices.quotes || {}) };
  Object.entries(twQuotes).forEach(([ticker, q]) => { quotes[`TW:${ticker}`] = q; });
  Object.entries(usQuotes).forEach(([ticker, q]) => { quotes[`US:${ticker}`] = q; });

  const fxRate = { USDTWD: usdtwd ?? prevPrices?.fxRate?.USDTWD ?? null };

  const newPrices = { lastUpdated: new Date().toISOString(), fxRate, quotes };
  writeJSON(paths.prices, newPrices);

  // ---------- Alert 檢查（方案A） ----------
  const notifications = []; // { title, body, tag }

  alerts.holdingAlerts = alerts.holdingAlerts || [];
  holdings.forEach((h) => {
    let entry = alerts.holdingAlerts.find((a) => a.holdingId === h.id);
    if (!entry) {
      entry = { id: `a-${h.id}`, holdingId: h.id, lockedCost: h.avgCost, thresholds: [5, 10, 15], notified: [] };
      alerts.holdingAlerts.push(entry);
    }
    const q = quotes[`${h.market}:${h.ticker}`];
    if (!q) return;
    const dropPct = ((entry.lockedCost - q.price) / entry.lockedCost) * 100;

    if (dropPct <= 0) {
      // 價格回到鎖定成本之上，重置門檻，下次再跌會重新從5%開始通知
      if (entry.notified.length > 0) entry.notified = [];
      return;
    }

    entry.thresholds
      .slice()
      .sort((a, b) => a - b)
      .forEach((threshold) => {
        if (dropPct >= threshold && !entry.notified.includes(threshold)) {
          entry.notified.push(threshold);
          notifications.push({
            title: `${h.name} (${h.ticker}) 跌破 -${threshold}%`,
            body: `通知基準價 ${entry.lockedCost} → 現價 ${q.price}（${dropPct.toFixed(1)}%）`,
            tag: `holding-${h.id}-${threshold}`,
          });
        }
      });
  });

  alerts.watchlistAlerts = alerts.watchlistAlerts || [];
  watchlist.forEach((w) => {
    let entry = alerts.watchlistAlerts.find((a) => a.watchlistId === w.id);
    if (!entry) {
      entry = { id: `wa-${w.id}`, watchlistId: w.id, notifiedPrices: [] };
      alerts.watchlistAlerts.push(entry);
    }
    const q = quotes[`${w.market}:${w.ticker}`];
    if (!q) return;

    (w.targetPrices || []).forEach((target) => {
      const alreadyNotified = entry.notifiedPrices.includes(target);
      if (q.price <= target && !alreadyNotified) {
        entry.notifiedPrices.push(target);
        notifications.push({
          title: `${w.name} (${w.ticker}) 到價`,
          body: `目標價 ${target} → 現價 ${q.price}`,
          tag: `watch-${w.id}-${target}`,
        });
      } else if (q.price > target && alreadyNotified) {
        // 價格回升超過目標價，之後再跌破可以重新通知
        entry.notifiedPrices = entry.notifiedPrices.filter((p) => p !== target);
      }
    });
  });

  writeJSON(paths.alerts, alerts);

  // ---------- 發送 Web Push ----------
  if (notifications.length > 0 && subsData.subscriptions && subsData.subscriptions.length > 0) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error("缺少 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 環境變數，無法發送通知");
    } else {
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:example@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

      const stillValid = [];
      for (const sub of subsData.subscriptions) {
        let alive = true;
        for (const note of notifications) {
          try {
            await webpush.sendNotification(
              sub,
              JSON.stringify({ title: note.title, body: note.body, tag: note.tag, url: "./index.html" })
            );
          } catch (err) {
            console.error("推播失敗：", err.statusCode, err.body || err.message);
            if (err.statusCode === 404 || err.statusCode === 410) alive = false;
          }
        }
        if (alive) stillValid.push(sub);
      }
      if (stillValid.length !== subsData.subscriptions.length) {
        subsData.subscriptions = stillValid;
        writeJSON(paths.subscriptions, subsData);
      }
      console.log(`已發送 ${notifications.length} 則通知給 ${stillValid.length} 個裝置`);
    }
  } else {
    console.log(`本次沒有觸發新的通知（觸發數: ${notifications.length}，訂閱裝置數: ${(subsData.subscriptions || []).length}）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
