// ============================================
// 處理「開啟／關閉背景通知」的 Issue
// 由 .github/workflows/handle-app-update.yml 在 Issue 開立時呼叫
//
// 支援的 action：
//   subscribe    寫入/更新這個裝置的推播訂閱＋持倉快照
//   unsubscribe  移除這個裝置的訂閱與快照
// ============================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const paths = {
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

function main() {
  const body = process.env.ISSUE_BODY || "";
  const payload = extractJSON(body);

  if (payload.action === "subscribe") {
    const subsData = readJSON(paths.subscriptions, { subscriptions: [] });
    subsData.subscriptions = subsData.subscriptions || [];
    const sub = payload.subscription;
    if (!sub || !sub.endpoint) throw new Error("subscription 缺少 endpoint");
    if (!subsData.subscriptions.some((s) => s.endpoint === sub.endpoint)) {
      subsData.subscriptions.push(sub);
    }
    writeJSON(paths.subscriptions, subsData);

    const alerts = readJSON(paths.alerts, { subscriberAlerts: [] });
    alerts.subscriberAlerts = (alerts.subscriberAlerts || []).filter((a) => a.endpoint !== sub.endpoint);
    alerts.subscriberAlerts.push({
      endpoint: sub.endpoint,
      holdingAlerts: payload.holdingAlerts || [],
      watchlistAlerts: payload.watchlistAlerts || [],
    });
    writeJSON(paths.alerts, alerts);
  } else if (payload.action === "unsubscribe") {
    const subsData = readJSON(paths.subscriptions, { subscriptions: [] });
    subsData.subscriptions = (subsData.subscriptions || []).filter((s) => s.endpoint !== payload.endpoint);
    writeJSON(paths.subscriptions, subsData);

    const alerts = readJSON(paths.alerts, { subscriberAlerts: [] });
    alerts.subscriberAlerts = (alerts.subscriberAlerts || []).filter((a) => a.endpoint !== payload.endpoint);
    writeJSON(paths.alerts, alerts);
  } else {
    throw new Error(`不認得的 action: ${payload.action}`);
  }

  console.log(`已處理 action=${payload.action}`);
}

main();
