# accounting_final — 會計學期末互動模擬考

這是一個以 GitHub Pages 發布的繁體中文互動練習系統，支援手機及電腦操作。

> **目前狀態：** GitHub 已寫入網站及 10 題原創示範題。使用者目前只提供作業說明截圖，**尚未提供老師提到的 PDF 與 MD 正式題庫**。示範題不代表真正考題，也不保證題目內容、難度、圖片或篩選條件與教師題庫一致。

## 功能

- 模擬考：滿分 **1000** 分、**700** 分及格。依答對題數等比例換算；每題須全部正確才得分，未作答視為錯誤。
- 自由練習：逐題「觀看答案」，提供中文解析、原文顯示。
- 原生互動：單選、複選、資料列篩選、拖曳排序（手機有 ↑／↓）、配對、圖片點選。
- 交卷後逐題結果：繁體中文題目、作答、正確答案、解析；答錯題有「顯示原文」按鈕（需題庫提供原文）。
- 題庫去重：依正規化題幹排除重複。
- 會員：Email、姓名與密碼申請（表單預設 a123456，建議使用者改成強密碼），由管理員審核。
- 管理員：審核與停用帳號、查看登入次數、每次模擬考分數、改自己密碼、匯出及本機匯入題庫。
- 成績紀錄與詳解，包含完成的自由練習與模擬考。

## 啟用 GitHub Pages

1. 進入 [accounting_final 專案](https://github.com/mti0224/accounting_final)。
2. **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
3. 進入 **Actions**，執行 **Deploy accounting practice to GitHub Pages** 工作流程（或推送 main 觸發部署）。
4. 在 Pages 設定頁確認工作流程成功及實際網址能開啟。

**預期網址（尚需部署後驗證）：** https://mti0224.github.io/accounting_final/

目前 Repository 是 Private。GitHub Pages 對私人儲存庫的支援受 GitHub 帳號方案或組織政策限制；如 Pages 無法啟用，需改為符合方案的方式發布。公開 Pages 的靜態程式及題庫通常可被瀏覽，勿存放機密。

## 資料儲存：示範與正式模式

未設定外部後端時，網站會在該瀏覽器 localStorage 保存示範帳號、審核狀態與成績；**這不具備真正的安全性、不跨裝置、不適合真實個資**。

示範登入（僅供功能測試）：

- 管理員：admin@demo.local / demo1234
- 學生：student@demo.local / demo1234

可以測試：申請帳號 → 管理員登入並核准 → 新帳號登入 → 練習／考試 → 成績記錄。

正式版支援 Supabase Auth + PostgreSQL + Row Level Security，設定程序：

1. 建立 Supabase 專案。
2. 使用 SQL Editor 執行 [supabase/schema.sql](supabase/schema.sql)。
3. Authentication → Providers → Email：啟用 Email/密碼登入，決定是否要求使用者確認 Email。
4. Authentication → URL Configuration：設定網站網址。
5. 在 Authentication 建立並驗證真正管理員帳號，例如 admin@powerbi.com.tw，**請設定新的強密碼，不要使用作業截圖中公開的預設密碼**。
6. 於 SQL Editor 執行以下指令，將已存在的帳號設成管理員：

    update public.profiles set role = 'admin', status = 'approved' where email = 'admin@powerbi.com.tw';

7. 編輯 [config.js](config.js)，填入專案 URL 及 publishable/anon key 後提交至 GitHub。**不要**填 service_role 或 secret key。
8. 重新部署並測試管理員核准、登入、不同裝置查看成績。

此網站是**學習用模擬考，非防作弊評量系統**：題庫與答案位於靜態前端，具技術能力的使用者可查看並自行偽造分數。正式評量應改用可信任伺服器端計分。

## 題庫內容與 JSON 匯入

由於未提供正式 PDF / MD，**網站不會自動從 PDF 或 MD 產生真題**。要把真題實作成線上操作題，需取得原圖、原文、選項、對應的互動區域，再逐題校驗。勿把原本的圖片、篩選或拖曳題改成單選題。

題庫檔案為 [questions.json](questions.json)，最外層格式：

- version：數字 1
- kind：可標示 demonstration 或 official
- questions：題目陣列

每一題至少有 id、type、title、answer、explanation，建議提供 originalEnglish。不同題型欄位如下：

| type | 額外欄位 | answer |
| --- | --- | --- |
| single | choices（id、text） | 選項 ID |
| multiple | choices（id、text） | 選項 ID 陣列 |
| filter | columns（key、label）、rows（id、其他欄位） | 被選資料列 ID 陣列 |
| order | items（id、text） | 正確順序 ID 陣列 |
| match | left、right（均含 id、text） | 左側 ID 對應右側 ID 的物件 |
| image | image 圖片路徑、hotspots（id、label、x1、y1、x2、y2） | 熱區 ID |

圖片熱區使用百分比：左上 (0,0)，右下 (100,100)。圖片可放入 assets/，題目 image 設成 ./assets/圖片名稱.png。

管理頁可以匯入 JSON 並自動排除重複，但**此匯入只存在當前瀏覽器**，且一旦匯入會取代示範題。若希望所有學生共享同一份題庫，請把整理好的 questions.json 提交至 GitHub。

## 作業繳交

作業要求將網站連結存入文字檔，檔名格式為 **學號_姓名_作業1.txt**。

專案提供 [作業1_繳交網址範本.txt](作業1_繳交網址範本.txt)。請在 Pages 已實際部署、手機操作測試完成，且正式題庫匯入後，再確認網址有效並更名為自己的學號與姓名。
