// ============================================
// 處理「訂閱/取消訂閱」Issue 的腳本
// 由 .github/workflows/capture-subscription.yml 在 Issue 開立時呼叫
// 從 ISSUE_BODY 環境變數裡的 ```json ... ``` 區塊解析出訂閱資料，
// 寫入 ../data/subscriptions.json
// ============================================

const fs = require("fs");
const path = require("path");

const subsPath = path.join(__dirname, "..", "data", "subscriptions.json");

function readJSON(p) {
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
  const subsData = fs.existsSync(subsPath) ? readJSON(subsPath) : { subscriptions: [] };
  subsData.subscriptions = subsData.subscriptions || [];

  if (payload.action === "subscribe") {
    const sub = payload.subscription;
    if (!sub || !sub.endpoint) throw new Error("subscription 缺少 endpoint");
    const exists = subsData.subscriptions.some((s) => s.endpoint === sub.endpoint);
    if (!exists) {
      subsData.subscriptions.push(sub);
      console.log("新增訂閱：", sub.endpoint);
    } else {
      console.log("這個訂閱已經存在，略過");
    }
  } else if (payload.action === "unsubscribe") {
    const before = subsData.subscriptions.length;
    subsData.subscriptions = subsData.subscriptions.filter((s) => s.endpoint !== payload.endpoint);
    console.log(`移除訂閱，數量 ${before} → ${subsData.subscriptions.length}`);
  } else {
    throw new Error(`不認得的 action: ${payload.action}`);
  }

  writeJSON(subsPath, subsData);
}

main();
