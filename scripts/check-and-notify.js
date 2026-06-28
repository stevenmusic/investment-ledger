// ============================================
// GitHub Action 用腳本：
// 1. 抓 tracked-tickers.json + 所有訂閱者快照裡用到的代號 → 即時價
// 2. 寫入 ../data/prices.json（給網站 Dashboard / 個股查詢使用）
// 3. 對每個有開啟「背景通知」的裝置，各自比對門檻（方案A：鎖定快照當下的成本）
// 4. 觸發的通知只送給對應的那個裝置（用 web-push）
// 5. 失效的訂閱（推播回410 Gone）會自動從 subscriptions.json 移除
// ============================================

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const DATA_DIR = path.join(__dirname, "..", "data");
const paths = {
  trackedTickers: path.join(DATA_DIR, "tracked-tickers.json"),
  prices: path.join(DATA_DIR, "prices.json"),
  alerts: path.join(DATA_DIR, "alerts.json"),
  subscriptions: path.join(DATA_DIR, "subscriptions.json"),
};

function readJSON(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

// ---------- 股價來源 ----------

async function fetchTWQuotes(tickers) {
  const out = {};
  if (tickers.length === 0) return out;
  try {
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
      const ticker = row.c;
      const price = parseFloat(row.z) || parseFloat(row.y);
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
  const tracked = readJSON(paths.trackedTickers, { tickers: [] }).tickers || [];
  const prevPrices = readJSON(paths.prices, { quotes: {} });
  const alerts = readJSON(paths.alerts, { subscriberAlerts: [] });
  const subsData = readJSON(paths.subscriptions, { subscriptions: [] });

  // 追蹤清單 + 所有訂閱者快照用到的代號，取聯集，確保進階通知一定能拿到價格
  const extraFromAlerts = [];
  (alerts.subscriberAlerts || []).forEach((sub) => {
    (sub.holdingAlerts || []).forEach((h) => extraFromAlerts.push({ market: h.market, ticker: h.ticker }));
    (sub.watchlistAlerts || []).forEach((w) => extraFromAlerts.push({ market: w.market, ticker: w.ticker }));
  });
  const allTickers = [...tracked, ...extraFromAlerts];
  const twTickers = [...new Set(allTickers.filter((t) => t.market === "TW").map((t) => t.ticker))];
  const usTickers = [...new Set(allTickers.filter((t) => t.market === "US").map((t) => t.ticker))];

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

  // ---------- 各訂閱者各自比對門檻（方案A） ----------
  const subscriptionsByEndpoint = {};
  (subsData.subscriptions || []).forEach((s) => { subscriptionsByEndpoint[s.endpoint] = s; });

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  const canPush = VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY;
  if (canPush) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:example@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }

  const stillValidEndpoints = new Set();

  for (const subAlert of alerts.subscriberAlerts || []) {
    const notifications = [];

    (subAlert.holdingAlerts || []).forEach((h) => {
      const q = quotes[`${h.market}:${h.ticker}`];
      if (!q) return;
      h.notified = h.notified || [];
      const dropPct = ((h.lockedCost - q.price) / h.lockedCost) * 100;
      if (dropPct <= 0) {
        if (h.notified.length > 0) h.notified = [];
        return;
      }
      (h.thresholds || [5, 10, 15]).slice().sort((a, b) => a - b).forEach((threshold) => {
        if (dropPct >= threshold && !h.notified.includes(threshold)) {
          h.notified.push(threshold);
          notifications.push({
            title: `${h.name} (${h.ticker}) 跌破 -${threshold}%`,
            body: `基準價 ${h.lockedCost} → 現價 ${q.price}（${dropPct.toFixed(1)}%）`,
            tag: `holding-${h.id}-${threshold}`,
          });
        }
      });
    });

    (subAlert.watchlistAlerts || []).forEach((w) => {
      const q = quotes[`${w.market}:${w.ticker}`];
      if (!q) return;
      w.notifiedPrices = w.notifiedPrices || [];
      (w.targetPrices || []).forEach((target) => {
        const already = w.notifiedPrices.includes(target);
        if (q.price <= target && !already) {
          w.notifiedPrices.push(target);
          notifications.push({
            title: `${w.name} (${w.ticker}) 到價`,
            body: `目標價 ${target} → 現價 ${q.price}`,
            tag: `watch-${w.id}-${target}`,
          });
        } else if (q.price > target && already) {
          w.notifiedPrices = w.notifiedPrices.filter((p) => p !== target);
        }
      });
    });

    const sub = subscriptionsByEndpoint[subAlert.endpoint];
    if (!sub) continue; // 訂閱已經被取消，略過

    if (notifications.length > 0 && canPush) {
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
      if (alive) stillValidEndpoints.add(subAlert.endpoint);
    } else {
      stillValidEndpoints.add(subAlert.endpoint);
    }
  }

  // 清掉失效的訂閱（推播回404/410的）
  if (canPush) {
    const before = subsData.subscriptions.length;
    subsData.subscriptions = subsData.subscriptions.filter((s) => stillValidEndpoints.has(s.endpoint));
    if (subsData.subscriptions.length !== before) writeJSON(paths.subscriptions, subsData);
  }

  writeJSON(paths.alerts, alerts);
  console.log(`完成。追蹤 ${twTickers.length} 檔台股、${usTickers.length} 檔美股，${(alerts.subscriberAlerts || []).length} 個裝置的背景通知已檢查。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
