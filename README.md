# 投資帳本

個人持倉管理 + 跌幅提醒工具。台股 / 美股皆可。

持倉、觀察清單存在你自己的瀏覽器裡，不需要登入，新增刪除立即生效。
只有「就算沒開App也要跳通知」這個**選用的進階功能**，才需要登入一次GitHub。

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

5. 到 repo 的 **Settings → Pages**，Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`，存檔，等 1-2 分鐘。
6. 打開網站，就可以直接在「持倉」分頁新增第一筆——不需要再做任何事。

「進階：背景通知」是選用的，想用才需要做第 2 節。

---

## 1. 建立 repo 並推上 GitHub（有電腦的話）

1. 到 https://github.com/new 建一個新 repo，例如取名 `investment-ledger`，設為 **Public**
   （要用免費的 GitHub Pages + 無限制 Actions 分鐘數，Public 最簡單）。
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
4. 打開網站，直接用：持倉、觀察清單都是即時生效的本機資料，不需要登入。

---

## 2.（選用）就算沒開App也要跳通知

平常打開App，就會自動檢查持股有沒有跌破門檻並顯示提醒。如果想要「手機鎖著、App沒開也跳通知」，才需要做這一節（只有這個功能需要登入GitHub）。

Web Push 需要一組 VAPID 金鑰：

1. 在你電腦上（有裝 Node.js 的話）跑：

```bash
npx web-push generate-vapid-keys
```

會印出一組 `Public Key` 和 `Private Key`。

2. 打開 `index.html`，找到這一行（用編輯器搜尋 `VAPID_PUBLIC_KEY` 最快）：

```js
const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";
```

換成你的 Public Key，commit 推上去。

3. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，新增三個：
   - `VAPID_PUBLIC_KEY`：同一組 Public Key
   - `VAPID_PRIVATE_KEY`：剛產生的 Private Key
   - `VAPID_SUBJECT`：填 `mailto:你的email@example.com`（隨便填一個能聯絡到你的就好）

4. 打開網站 → 設定分頁 → 按「開啟背景通知」→ 允許瀏覽器通知權限 → 會跳出一個按鈕，
   點下去會帶你到 GitHub、內容已經幫你填好了，按綠色的「Submit new issue」就好，
   幾秒後背景會自動處理完成。

   **iPhone 注意**：iOS 必須先把網站「加入主畫面」變成 PWA 之後才能收到推播，
   直接在 Safari 開網頁是收不到通知的。Android 用 Chrome 不裝也可以收到。

5. 之後如果新增了更多持股，也想讓它們被背景通知監控，要回到設定分頁**重新按一次「開啟背景通知」**，
   把最新的持倉快照重新送一次（會自動覆蓋舊的）。

---

## 3. 手動觸發第一次股價更新

不用等排程，到 repo 的 **Actions** 分頁 → 左邊選「Update prices and check alerts」→
右上「Run workflow」手動跑一次，確認股價有抓到、`data/prices.json` 有被更新。
之後排程會每 30 分鐘自動跑一次，全程不需要任何人登入或操作。

---

## 4. 新增/刪除持股、觀察清單

直接在網站的「持倉」「觀察清單」分頁填表單、按新增，**馬上生效**，不用整理、不用等、不需要登入。
刪除也一樣，每一筆資料下面有「刪除」可以按。

資料存在這台裝置的瀏覽器裡，換裝置或清掉瀏覽器資料會讓資料消失，請自行留意。

新增的當下，「平均成本」會自動鎖定成這筆持股之後判斷跌幅的基準價，之後你改動股數/成本不會影響這個基準——這就是一開始討論的「方案A」。

---

## 5. 想分享給朋友用？

每個人各自到自己的 GitHub 帳號，把這個 repo **Fork** 一份（repo 頁面右上角「Fork」按鈕），
照第 1 節幫自己的那一份開啟 Pages 即可使用，完全不用碰你原本的 repo。
每個人的持倉資料都存在自己的裝置裡，互相看不到對方的東西。

---

## 想追蹤的股票看不到現價？

Dashboard 的即時價是從 `data/tracked-tickers.json` 這份共用清單抓的，已經預先放了常見的台股/美股大型股。如果你新增的持股剛好不在清單裡，那一筆暫時會看不到現價（但「個股查詢」分頁一律能看到任何股票的即時圖表，不受這份清單限制）。

想讓某檔被排程持續追蹤，可以打開 `data/tracked-tickers.json` 自己加一筆，例如：

```json
{ "market": "TW", "ticker": "2454" }
```

這是一次性的管理員設定，跟「新增持股」這個日常操作完全分開，不影響其他人。

---

## 架構總覽

```
GitHub Pages（純靜態）
  index.html（畫面、樣式、邏輯都包在這一個檔案裡）
    持倉／觀察清單 ←存在→ 這台裝置的 localStorage（不經過 GitHub）
    即時價 ←讀取← data/prices.json

GitHub Actions
  ① update-prices.yml       每30分鐘：抓 tracked-tickers.json 裡的股票即時價/匯率
                             → 寫 prices.json → 比對每個訂閱裝置的門檻 → 用 web-push 發通知
  ② handle-app-update.yml   監聽標題開頭是 "app-update" 的新 Issue（只有「開啟/關閉背景
                             通知」這個選用功能會用到）→ 寫入/移除 subscriptions.json、
                             alerts.json → 自動關閉該 Issue
```

股價來源（都是免金鑰但非官方 API，未來可能失效，壞掉的話要換來源）：
- 台股：證交所 MIS 即時報價 `mis.twse.com.tw`
- 美股：Yahoo Finance chart API
- 匯率：`api.frankfurter.app`

---

## 目前 MVP 範圍

✅ 持倉管理（台股/美股、股數、均成本、損益%，網頁表單新增/刪除，本機儲存、不需登入）
✅ Dashboard（總投入/總市值/總損益/單股損益排行）
✅ 跌幅提醒（5% / 10% / 15%，鎖定建立時成本，方案A；打開App自動檢查）
✅ 觀察清單（自訂目標價到價提醒）
✅ 個股查詢（查任何台股/美股即時價＋技術分析線，TradingView）
✅ 選用：背景推播通知（即使沒開App也跳通知，需要一次性GitHub登入）
✅ 每人各自 Fork 一份，資料互相獨立

## 之後可以加（先不做）

- 全英文介面切換按鈕
- 股息追蹤
- 技術線 Alert（支撐位 / MA，方案B）
- AI 分析（可以用 Claude API 加在前端，分析持倉走勢）
