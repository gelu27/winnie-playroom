# 自動試玩腳本

用 Playwright 模擬 iPad（Chromium、觸控事件）實際操作每一款遊戲，記錄錯誤、卡住、沒反應、
改用裝置語音的句子和反應時間。改版前跑一次，確認沒有把東西弄壞。

```bash
# 在儲存庫根目錄開一個本機伺服器
python3 -m http.server 8765
# 另開一個終端機：每款遊戲操作 60 次（ONLY 只跑某幾款，逗號分隔）
N=60 node tools/autotest/play.js
ONLY=animals,colors N=20 node tools/autotest/play.js
# 情境測試：時間到休息、休息後要家長解鎖、家長鎖、亂按選單、房子鍵、彩度、手機版面
node tools/autotest/scen.js
```

結果寫在 `tools/autotest/out/`、`tools/autotest/scen/`（已加入 .gitignore）。
限制：瀏覽器是 Chromium 不是 iPad Safari；雲端環境沒有喇叭，只能記錄播了哪個音檔，
聽不到唸得對不對。發音要另外用語音辨識檢查（見 `tools/voice-check/`）。
