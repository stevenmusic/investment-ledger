# 投資帳本（Investment Ledger）

個人持倉管理 + 跌幅通知工具。台股 / 美股皆可，零後端、零資料庫，
全部靠 **GitHub Pages（前端）+ GitHub Actions（排程抓股價、檢查 Alert、推播通知）**。

---

## 0. 只有手機/平板、沒有電腦？

全程可以只靠瀏覽器完成，用 **GitHub Codespaces**（雲端 VS Code + 終端機，平板手機都能開）：

1. 到 github.com/new 建空的 public repo
2. 進到該 repo 頁面 → 綠色 **Code** 按鈕 → **Codespaces** 分頁 → **Create codespace on main**
3. 把這次拿到的 zip 拖進左側檔案總管上傳
4. 開下方終端機跑：

```bash
unzip investment-ledger.zip
mv investment-tracker/* investment-tracker/.[!.]* . 2>/dev/null
rm -rf investment-tracker investment-ledger.zip
git add .
git commit -m "init: investment ledger MVP"
git push
```

5. 同一個終端機直接跑 `npx web-push generate-vapid-keys` 產生金鑰（雲端環境，平板上也能跑），
   打開 `index.html`，找到 `VAPID_PUBLIC_KEY` 那一行，把 Public Key 貼進去取代 placeholder，存檔後再 commit/push 一次。
6. 接下來的步驟（開 Pages、加 Secrets、手動跑 Action）都是純網頁操作，跳到下面第 2-4 節照做即可。

之後要新增/刪除持股，不需要再開 Codespace，直接在網站上的表單填一填就好（見第4節）。

---

## 1. 建立 repo 並推上 GitHub（有電腦的話）

照下面步驟做（用 GitHub 網站操作最簡單）：

1. 到 https://github.com/new 建一個新 repo，例如取名 `investment-ledger`，設為 **Public**
   （要用免費的 GitHub Pages + 無限制 Actions 分鐘數，Public 最簡單；Private 也可以但 Pages 需要付費方案）。
   建立時不要勾選「Add a README」，保持空 repo。
2. 把這份專案資料夾推上去：

```bash
cd investment-ledger   # 把這次拿到的檔案放進這個資料夾
git init
git add .
git commit -m "init: investment ledger MVP"
git branch -M main
git remote add origin https://github.com/{你的帳號}/investment-ledger.git
git push -u origin main
```

3. 到 repo 的 **Settings → Pages**，Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`，存檔。
   等 1-2 分鐘，網址會是 `https://{你的帳號}.github.io/investment-ledger/`。

---

## 2. 設定推播通知（Web Push）

Web Push 需要一組 VAPID 金鑰（公開金鑰可以放在前端程式碼裡，私密金鑰絕對不要放進 repo，要放在 GitHub Secrets）。

1. 在你電腦上（有裝 Node.js 的話）跑：

```bash
npx web-push generate-vapid-keys
```

會印出一組 `Public Key` 和 `Private Key`。

2. 打開 `index.html`，找到這一行（用編輯器的搜尋找 `VAPID_PUBLIC_KEY` 最快）：

```js
const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";
```

換成你的 Public Key，commit 推上去。

3. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，新增三個：
   - `VAPID_PUBLIC_KEY`：同一組 Public Key
   - `VAPID_PRIVATE_KEY`：剛產生的 Private Key
   - `VAPID_SUBJECT`：填 `mailto:你的email@example.com`（隨便填一個能聯絡到你的就好）

4. 打開網站 → 設定分頁 → 按「開啟跌幅通知」→ 允許瀏覽器通知權限 → 接著會跳出一個按鈕，
   點下去會開一個**已經幫你填好內容的 GitHub Issue**，你只要按「Submit new issue」就好，
   幾秒後 Action 會自動把訂閱資料寫進 `data/subscriptions.json` 並關閉 Issue。

   **iPhone 注意**：iOS 必須先把網站「加入主畫面」變成 PWA 之後才能收到推播，
   直接在 Safari 開網頁是收不到通知的。Android 用 Chrome 不裝也可以收到。

---

## 3. 手動觸發第一次股價更新

不用等排程，到 repo 的 **Actions** 分頁 → 左邊選「Update prices and check alerts」→
右上「Run workflow」手動跑一次，確認股價有抓到、`data/prices.json` 有被更新。
之後排程會每 30 分鐘自動跑一次。

---

## 4. 新增/刪除你的持股

不用編輯任何檔案，直接在網站的「持倉」分頁填表單、按新增即可。Watchlist 同理，在「Watchlist」分頁填表單。

按下「新增」後會出現一個按鈕，點一下、在跳出的頁面按綠色的「Submit new issue」，幾秒後資料就會更新，重新整理網頁就會看到新的一筆。刪除也是一樣的流程，在每一筆資料下面有「刪除」可以按。

第一次被系統看到的「平均成本」會自動鎖定成這筆持股的跌幅通知基準價，之後你加碼讓持股的平均成本改變，通知基準價不會跟著變動——這就是一開始討論的「方案A」。如果想重新鎖定基準價（例如停損後重新買進），把這筆刪除再重新新增一次即可。

---

## 5. 想分享給朋友用？

每個人各自到自己的 GitHub 帳號，把這個 repo **Fork** 一份（repo 頁面右上角「Fork」按鈕），
照第 1-3 節幫自己的那一份重新設定一次（建立 Pages、設定通知金鑰）。

這樣每個人都有自己獨立的一份網站和資料，互相看不到對方的東西，也不需要動到你原本的 repo。

---

## 架構總覽

```
GitHub Pages（純靜態，只讀 repo 內的 json，沒有 CORS 問題）
  index.html（畫面、樣式、邏輯都包在這一個檔案裡）
    ──讀取──>  data/holdings.json, watchlist.json, prices.json, alerts.json

GitHub Actions
  ① update-prices.yml       每30分鐘：抓台股/美股/匯率 → 寫 prices.json
                             → 比對 alerts.json 門檻 → 觸發就用 web-push 發通知
  ② handle-app-update.yml   監聽 Issue 標題開頭是 "app-update" 的新 Issue
                             （由網頁上的表單自動產生）→ 解析內容 → 新增/刪除
                             持股、觀察清單、通知訂閱 → 自動關閉該 Issue
```

股價來源（都是免金鑰但非官方 API，未來可能失效，壞掉的話要換來源）：
- 台股：證交所 MIS 即時報價 `mis.twse.com.tw`
- 美股：Yahoo Finance chart API
- 匯率：`api.frankfurter.app`

---

## 目前 MVP 範圍

✅ 持倉管理（台股/美股、股數、均成本、損益%，網頁表單新增/刪除）
✅ Dashboard（總投入/總市值/總損益/單股損益排行）
✅ 跌幅 Alert（5% / 10% / 15%，鎖定建立時成本，方案A）
✅ Watchlist（自訂目標價到價通知，網頁表單新增/刪除）
✅ 個股查詢（查任何台股/美股即時價＋技術分析線，TradingView）
✅ PWA + 手機 Web Push 通知
✅ 每人各自 Fork 一份，資料互相獨立

## 之後可以加（先不做）

- 股息追蹤
- 技術線 Alert（支撐位 / MA，方案B）
- AI 分析（可以用 Claude API 加在前端，分析持倉走勢）
