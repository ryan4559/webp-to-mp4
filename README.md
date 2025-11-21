# WebP to MP4 Converter

一個美觀的本地網站應用程式，可以將 WebP 動畫轉換為 MP4 影片格式。

##  功能特色

- 🎨 **精美介面** - 現代化深色主題設計，帶有玻璃擬態效果和平滑動畫
- 📤 **拖放上傳** - 支援點擊選擇或直接拖放 WebP 檔案
- ⚡ **快速轉換** - 使用 WebPMux 與 FFmpeg 引擎進行高效轉換
- 🔒 **隱私保護** - 所有處理在本地進行，不上傳到雲端
- 💾 **自動下載** - 轉換完成後自動下載 MP4 檔案

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 啟動伺服器

```bash
npm start
```

###3. 開啟瀏覽器

訪問 http://localhost:3000

## 使用方式

1. 將 WebP 檔案拖放到上傳區域，或點擊選擇檔案
2. 點擊「開始轉換」按鈕
3. 等待轉換完成
4. MP4 檔案會自動下載

## 技術棧

- **後端**: Express.js + Multer
- **前端**: 原生 HTML/CSS/JavaScript
- **轉換**: fluent-ffmpeg + ffmpeg-static + node-webpmux + pngjs

## 專案結構

```
webp_converter/
├── server.js           # Express 伺服器
├── package.json        # 專案配置
├── public/            # 前端檔案
│   ├── index.html    # 主頁面
│   ├── style.css     # 樣式表
│   └── script.js     # 客戶端邏輯
├── uploads/          # 上傳檔案暫存（自動創建）
└── outputs/          # 轉換後檔案（自動創建）
```

## 系統需求

- Node.js 14.0 或更高版本
- npm 7.0 或更高版本

## 授權

ISC License
