# 多益 900 衝刺（v2）

靜態網頁 App：單字字卡／測驗／錯題本 + TOEIC Part 2–4 聽力（預錄神經語音）。

## 使用方式
- **建議**：用靜態伺服器開啟（GitHub Pages、`npx serve`、`python3 -m http.server`）。
- **file://**：多數瀏覽器可直接開啟 `index.html`，相對路徑音檔通常可播放；`fetch(manifest)` 可能被擋，但不影響，程式會改用預設路徑。

## 音檔
`audio/` 內為 edge-tts（Microsoft 神經語音）預錄 MP3，口音含美／英／加／澳，語速對齊文獻中的多益 WPM。
