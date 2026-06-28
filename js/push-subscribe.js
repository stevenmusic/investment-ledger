// ============================================
// Web Push 訂閱流程
// 不需要任何後端：訂閱資料透過「開一個 GitHub Issue」送出，
// repo 裡的 GitHub Action 會監聽 Issue 建立事件，自動寫入
// data/subscriptions.json 並關閉該 Issue。
//
// 設定方式：把下面 VAPID_PUBLIC_KEY 換成你自己產生的公開金鑰
// (產生方式見 README)。這是公開金鑰，寫在前端程式碼裡是安全的。
// ============================================

const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function detectRepoOwnerAndName() {
  // 適用於 GitHub Pages 預設網址：https://{owner}.github.io/{repo}/
  const host = location.hostname; // e.g. stevenmusic.github.io
  const owner = host.split(".")[0];
  const seg = location.pathname.split("/").filter(Boolean);
  const repo = seg.length > 0 ? seg[0] : host.replace(".github.io", "") + ".github.io";
  return { owner, repo };
}

function buildIssueURL(payload) {
  const { owner, repo } = detectRepoOwnerAndName();
  const title = encodeURIComponent(`push-notify: ${payload.action}`);
  const body = encodeURIComponent(
    "這個 Issue 是自動產生的訂閱請求，送出後幾秒內會被 Action 自動處理並關閉，不需要手動做任何事。\n\n```json\n" +
      JSON.stringify(payload, null, 2) +
      "\n```"
  );
  const labels = encodeURIComponent("push-notify");
  return `https://github.com/${owner}/${repo}/issues/new?title=${title}&body=${body}&labels=${labels}`;
}

const btnSub = document.getElementById("btnSubscribe");
const btnUnsub = document.getElementById("btnUnsubscribe");
const statusEl = document.getElementById("subStatus");
const instructionsEl = document.getElementById("subscribeInstructions");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status-line ${kind || ""}`;
}

function showIssueStep(url, message) {
  instructionsEl.hidden = false;
  instructionsEl.innerHTML = `
    ${message}<br><br>
    <a class="btn" href="${url}" target="_blank" rel="noopener">在 GitHub 開 Issue 完成設定 →</a>
    <br><br>
    開了之後在 GitHub 那邊直接按「Submit new issue」就好（內容已經幫你填好了），幾秒後 Action 會自動處理掉。
  `;
}

async function getSWRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("service-worker.js");
}

async function refreshButtonState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    setStatus("這個瀏覽器不支援 Web Push 通知（iPhone 請先把網站加到主畫面再打開）", "warn");
    btnSub.disabled = true;
    return;
  }
  const reg = await getSWRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    btnSub.hidden = true;
    btnUnsub.hidden = false;
    setStatus("這台裝置已訂閱通知", "ok");
  } else {
    btnSub.hidden = false;
    btnUnsub.hidden = true;
    setStatus("尚未開啟通知");
  }
}

btnSub.addEventListener("click", async () => {
  try {
    if (VAPID_PUBLIC_KEY === "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE") {
      setStatus("還沒設定 VAPID_PUBLIC_KEY，請看 README 設定步驟", "warn");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("通知權限被拒絕，無法開啟", "warn");
      return;
    }
    const reg = await getSWRegistration();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const payload = { action: "subscribe", subscription: sub.toJSON() };
    const url = buildIssueURL(payload);
    showIssueStep(url, "裝置端已經準備好了，最後一步：把訂閱資料送到 repo（透過開一個 GitHub Issue，全自動處理）。");
    setStatus("裝置已產生訂閱，請完成下面這一步", "warn");
    btnSub.hidden = true;
    btnUnsub.hidden = false;
  } catch (err) {
    console.error(err);
    setStatus("訂閱失敗：" + err.message, "warn");
  }
});

btnUnsub.addEventListener("click", async () => {
  try {
    const reg = await getSWRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { setStatus("這台裝置本來就沒有訂閱"); return; }
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const payload = { action: "unsubscribe", endpoint };
    const url = buildIssueURL(payload);
    showIssueStep(url, "這台裝置本機已經取消訂閱，最後一步：通知 repo 把這筆資料移除。");
    btnSub.hidden = false;
    btnUnsub.hidden = true;
    setStatus("本機已取消，請完成下面這一步", "warn");
  } catch (err) {
    console.error(err);
    setStatus("取消訂閱失敗：" + err.message, "warn");
  }
});

if ("serviceWorker" in navigator) {
  refreshButtonState();
}
