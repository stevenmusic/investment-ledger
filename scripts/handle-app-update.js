// ============================================
// 處理所有「網頁表單提交」的 Issue
// 由 .github/workflows/handle-app-update.yml 在 Issue 開立時呼叫
//
// 支援的 action：
//   subscribe / unsubscribe        通知開關（見 push-subscribe.js）
//   add-holding / delete-holding   新增/刪除持股
//   add-watchlist / delete-watchlist  新增/刪除觀察清單
// ============================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const paths = {
  holdings: path.join(DATA_DIR, "holdings.json"),
  watchlist: path.join(DATA_DIR, "watchlist.json"),
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

function extractJSON(body) {
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error("Issue 內容裡找不到 ```json``` 區塊");
  return JSON.parse(match[1]);
}

function shortId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function main() {
  const body = process.env.ISSUE_BODY || "";
  const payload = extractJSON(body);

  switch (payload.action) {
    case "subscribe": {
      const data = readJSON(paths.subscriptions, { subscriptions: [] });
      data.subscriptions = data.subscriptions || [];
      const sub = payload.subscription;
      if (!sub || !sub.endpoint) throw new Error("subscription 缺少 endpoint");
      if (!data.subscriptions.some((s) => s.endpoint === sub.endpoint)) {
        data.subscriptions.push(sub);
      }
      writeJSON(paths.subscriptions, data);
      break;
    }
    case "unsubscribe": {
      const data = readJSON(paths.subscriptions, { subscriptions: [] });
      data.subscriptions = (data.subscriptions || []).filter((s) => s.endpoint !== payload.endpoint);
      writeJSON(paths.subscriptions, data);
      break;
    }
    case "add-holding": {
      const data = readJSON(paths.holdings, { holdings: [] });
      data.holdings = data.holdings || [];
      const id = shortId("h");
      data.holdings.push({
        id,
        market: payload.market === "US" ? "US" : "TW",
        ticker: String(payload.ticker || "").trim(),
        name: String(payload.name || "").trim(),
        shares: Number(payload.shares) || 0,
        avgCost: Number(payload.avgCost) || 0,
      });
      writeJSON(paths.holdings, data);
      break;
    }
    case "delete-holding": {
      const data = readJSON(paths.holdings, { holdings: [] });
      data.holdings = (data.holdings || []).filter((h) => h.id !== payload.id);
      writeJSON(paths.holdings, data);

      const alerts = readJSON(paths.alerts, { holdingAlerts: [], watchlistAlerts: [] });
      alerts.holdingAlerts = (alerts.holdingAlerts || []).filter((a) => a.holdingId !== payload.id);
      writeJSON(paths.alerts, alerts);
      break;
    }
    case "add-watchlist": {
      const data = readJSON(paths.watchlist, { watchlist: [] });
      data.watchlist = data.watchlist || [];
      const id = shortId("w");
      data.watchlist.push({
        id,
        market: payload.market === "US" ? "US" : "TW",
        ticker: String(payload.ticker || "").trim(),
        name: String(payload.name || "").trim(),
        targetPrices: Array.isArray(payload.targetPrices) ? payload.targetPrices.map(Number) : [],
      });
      writeJSON(paths.watchlist, data);
      break;
    }
    case "delete-watchlist": {
      const data = readJSON(paths.watchlist, { watchlist: [] });
      data.watchlist = (data.watchlist || []).filter((w) => w.id !== payload.id);
      writeJSON(paths.watchlist, data);

      const alerts = readJSON(paths.alerts, { holdingAlerts: [], watchlistAlerts: [] });
      alerts.watchlistAlerts = (alerts.watchlistAlerts || []).filter((a) => a.watchlistId !== payload.id);
      writeJSON(paths.alerts, alerts);
      break;
    }
    default:
      throw new Error(`不認得的 action: ${payload.action}`);
  }

  console.log(`已處理 action=${payload.action}`);
}

main();
