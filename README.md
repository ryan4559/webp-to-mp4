# WebP to MP4 Converter

一個美觀的網站應用程式，可以將 WebP 動畫轉換為 MP4 影片格式。支援本地執行和雲端部署。

##  功能特色

### 核心功能
- 🎨 **精美介面** - 現代化深色主題設計，帶有玻璃擬態效果和平滑動畫
- 📤 **拖放上傳** - 支援點擊選擇或直接拖放 WebP 檔案
- ⚡ **快速轉換** - 使用 WebPMux 與 FFmpeg 引擎進行高效轉換
- 💾 **自動下載** - 轉換完成後自動下載 MP4 檔案
- 🔧 **手動幀合成** - 正確處理 WebP 的 blend 和 dispose 操作

### 安全與效能
- 🔒 **檔案類型驗證** - 只接受 WebP 格式檔案
- 📏 **檔案大小限制** - 預設限制 50MB（可配置）
- 🚦 **速率限制** - 防止濫用和 DoS 攻擊

## 快速開始

### 本地執行

#### 1. 安裝依賴

```bash
npm install
```

#### 2. 配置環境變數（可選）

```bash
cp .env.example .env
```

編輯 `.env` 檔案調整配置（如不設定則使用預設值）：
- `PORT` - 伺服器端口（預設：3000）
- `MAX_FILE_SIZE_MB` - 最大檔案大小（預設：50MB）
- `CONVERT_RATE_LIMIT_MAX` - 轉換請求限制（預設：10 次/15分鐘）
- `GENERAL_RATE_LIMIT_MAX` - 一般請求限制（預設：100 次/15分鐘）

#### 3. 啟動伺服器

```bash
npm start
```

#### 4. 開啟瀏覽器

訪問 http://localhost:3000

## 使用方式

1. 將 WebP 檔案拖放到上傳區域，或點擊選擇檔案
2. 點擊「開始轉換」按鈕
3. 等待轉換完成
4. MP4 檔案會自動下載

## 技術棧

- **後端**: Express.js + Multer + express-rate-limit
- **前端**: 原生 HTML/CSS/JavaScript
- **轉換**: fluent-ffmpeg + ffmpeg-static + node-webpmux + pngjs
- **配置**: dotenv

## 專案結構

```
webp_converter/
├── server.js           # Express 伺服器（含速率限制和安全功能）
├── package.json        # 專案配置
├── .env               # 環境變數配置（需自行建立）
├── .env.example       # 環境變數範本
├── .gitignore         # Git 忽略規則
├── CLAUDE.md          # Claude Code 專案文件
├── README.md          # 專案說明
├── public/            # 前端檔案
│   ├── index.html    # 主頁面
│   ├── style.css     # 樣式表
│   └── script.js     # 客戶端邏輯
├── uploads/          # 上傳檔案暫存（自動創建）
└── outputs/          # 轉換後檔案（自動創建）
```

## 環境變數說明

參考 `.env.example` 檔案，所有參數都有預設值：

| 變數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `PORT` | 3000 | 伺服器端口 |
| `MAX_FILE_SIZE_MB` | 50 | 最大檔案大小（MB）|
| `CONVERT_RATE_LIMIT_WINDOW_MIN` | 15 | 轉換速率限制時間窗口（分鐘）|
| `CONVERT_RATE_LIMIT_MAX` | 10 | 轉換速率限制最大請求數 |
| `GENERAL_RATE_LIMIT_WINDOW_MIN` | 15 | 一般速率限制時間窗口（分鐘）|
| `GENERAL_RATE_LIMIT_MAX` | 100 | 一般速率限制最大請求數 |

## 系統需求

- Node.js 14.0 或更高版本
- npm 7.0 或更高版本

## 開發工具

本專案使用以下 AI 工具協助開發：

- **[Claude Code](https://claude.ai/code)** - Anthropic 的 AI 編程助手，協助架構設計、程式碼實現和文件撰寫
- **[Google Gemini](https://gemini.google.com/)** - Google 的 AI 助手，協助需求分析和問題解決

透過 AI 輔助開發，提升了開發效率和程式碼品質。

## 授權

MIT License
