require('dotenv').config();

const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const WebP = require('node-webpmux');
const { PNG } = require('pngjs');
const rateLimit = require('express-rate-limit');

const app = express();

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const CONVERT_RATE_LIMIT_WINDOW = parseInt(process.env.CONVERT_RATE_LIMIT_WINDOW_MIN || '15') * 60 * 1000;
const CONVERT_RATE_LIMIT_MAX = parseInt(process.env.CONVERT_RATE_LIMIT_MAX || '10');
const GENERAL_RATE_LIMIT_WINDOW = parseInt(process.env.GENERAL_RATE_LIMIT_WINDOW_MIN || '15') * 60 * 1000;
const GENERAL_RATE_LIMIT_MAX = parseInt(process.env.GENERAL_RATE_LIMIT_MAX || '100');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

// File filter to accept only WebP files
const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/webp'];
    const allowedExts = ['.webp'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('只接受 WebP 格式的檔案！Only WebP files are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: fileFilter
});

// Rate limiting for conversion endpoint
const convertLimiter = rateLimit({
    windowMs: CONVERT_RATE_LIMIT_WINDOW,
    max: CONVERT_RATE_LIMIT_MAX,
    message: '請求次數過多，請稍後再試。Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// General rate limiting for all requests
const generalLimiter = rateLimit({
    windowMs: GENERAL_RATE_LIMIT_WINDOW,
    max: GENERAL_RATE_LIMIT_MAX,
    message: '請求次數過多，請稍後再試。Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general rate limiting to all requests
app.use(generalLimiter);

// Serve static files
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Ensure outputs directory exists
const outputDir = 'outputs';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Conversion endpoint with rate limiting
app.post('/convert', convertLimiter, upload.single('webpFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const inputPath = req.file.path;
    // SECURITY: Verify inputPath is under uploads directory
    const uploadRoot = path.resolve('uploads');
    let inputPathAbs;
    try {
        inputPathAbs = fs.realpathSync(path.resolve(inputPath));
    } catch (e) {
        // If the file isn't found or is invalid, reject
        return res.status(400).json({ error: 'Uploaded file not found/safe.' });
    }
    if (!inputPathAbs.startsWith(uploadRoot + path.sep)) {
        return res.status(403).json({ error: 'Invalid file path.' });
    }
    // Use only the verified, absolute path hereafter
    const outputFilename = `converted-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);
    const tempDir = path.join('uploads', `temp-${Date.now()}`);

    try {
        // Create temp directory for frames
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        // Initialize WebP library (required for getFrameData)
        await WebP.Image.initLib();

        // Load WebP
        let img = new WebP.Image();
        await img.load(inputPathAbs);

        // Extract and Coalesce frames
        if (!img.hasAnim) {
            console.log('Static WebP detected, copying as single frame...');
            fs.copyFileSync(inputPathAbs, path.join(tempDir, 'frame_00000.png'));
        } else {
            console.log(`Extracting and coalescing ${img.frames.length} frames...`);
            const width = img.width;
            const height = img.height;
            const bg = (img.anim && img.anim.bgColor) ? img.anim.bgColor : [255, 255, 255, 255]; // RGBA
            // console.log(`Canvas size: ${width}x${height}, BG Color:`, bg);

            // 建立持久畫布（RGBA）
            let canvas = Buffer.alloc(width * height * 4);
            // 填入背景色
            for (let i = 0; i < width * height; i++) {
                canvas[i * 4 + 0] = bg[0];
                canvas[i * 4 + 1] = bg[1];
                canvas[i * 4 + 2] = bg[2];
                canvas[i * 4 + 3] = bg[3];
            }

            console.log('Starting frame composition...');

            for (let i = 0; i < img.frames.length; i++) {
                const fmeta = img.anim.frames[i]; // 含 x,y,width,height,blend,dispose,delay 等
                const rgba = await img.getFrameData(i); // 幀本身的 RGBA，尺寸為 fmeta.width x fmeta.height

                const x0 = (fmeta.x || 0) * 2;  // RFC 9649 規範要求座標 ×2
                const y0 = (fmeta.y || 0) * 2;  // RFC 9649 規範要求座標 ×2
                const fw = fmeta.width;
                const fh = fmeta.height;

                // 根據 blend 模式處理幀數據
                if (fmeta.blend === false) {
                    // NO_BLEND: 直接覆蓋，不進行 alpha 混合
                    for (let y = 0; y < fh; y++) {
                        for (let x = 0; x < fw; x++) {
                            const si = (y * fw + x) * 4;
                            const di = ((y0 + y) * width + (x0 + x)) * 4;

                            // 直接複製 RGBA，不管 alpha 值
                            canvas[di + 0] = rgba[si + 0];
                            canvas[di + 1] = rgba[si + 1];
                            canvas[di + 2] = rgba[si + 2];
                            canvas[di + 3] = rgba[si + 3];
                        }
                    }
                } else {
                    // BLEND: 進行 alpha 混合
                    for (let y = 0; y < fh; y++) {
                        for (let x = 0; x < fw; x++) {
                            const si = (y * fw + x) * 4;
                            const di = ((y0 + y) * width + (x0 + x)) * 4;

                            const sa = rgba[si + 3];
                            if (sa === 255) {
                                // 完全不透明：直接覆蓋
                                canvas[di + 0] = rgba[si + 0];
                                canvas[di + 1] = rgba[si + 1];
                                canvas[di + 2] = rgba[si + 2];
                                canvas[di + 3] = 255;
                            } else if (sa === 0) {
                                // 完全透明：保留畫布原內容
                            } else {
                                // 半透明：Porter-Duff "source over" alpha 合成
                                const da = canvas[di + 3];
                                const outA = sa + da * (255 - sa) / 255;
                                const sr = rgba[si + 0], sg = rgba[si + 1], sb = rgba[si + 2];
                                const dr = canvas[di + 0], dg = canvas[di + 1], db = canvas[di + 2];

                                if (outA > 0) {
                                    canvas[di + 0] = ((sr * sa + dr * da * (255 - sa) / 255) / outA) | 0;
                                    canvas[di + 1] = ((sg * sa + dg * da * (255 - sa) / 255) / outA) | 0;
                                    canvas[di + 2] = ((sb * sa + db * da * (255 - sa) / 255) / outA) | 0;
                                    canvas[di + 3] = outA | 0;
                                }
                            }
                        }
                    }
                }

                const frameIndex = i.toString().padStart(5, '0');
                // 先保存原始幀數據（用於調試）
                // const rawPng = new PNG({ width: fw, height: fh });
                // rawPng.data = Buffer.from(rgba);
                // const rawPath = path.join(tempDir, `raw_${frameIndex}.png`);
                // await new Promise((resolve, reject) => rawPng.pack().pipe(fs.createWriteStream(rawPath)).on('finish', resolve).on('error', reject));

                // 將「已攤平」的整張畫布存成 PNG
                const png = new PNG({ width, height });
                png.data = Buffer.from(canvas); // 複製畫布快照
                const outPath = path.join(tempDir, `frame_${frameIndex}.png`);
                await new Promise((resolve, reject) => png.pack().pipe(fs.createWriteStream(outPath)).on('finish', resolve).on('error', reject));

                // dispose=true：輸出後把該矩形恢復成背景（WebP 的 background）
                if (fmeta.dispose === true) {
                    for (let y = 0; y < fh; y++) {
                        const rowOff = (y0 + y) * width * 4 + x0 * 4;
                        for (let x = 0; x < fw; x++) {
                            const p = rowOff + x * 4;
                            canvas[p + 0] = bg[0];
                            canvas[p + 1] = bg[1];
                            canvas[p + 2] = bg[2];
                            canvas[p + 3] = bg[3];
                        }
                    }
                }

                // Progress indicator every 50 frames
                if (i % 50 === 0 || i === img.frames.length - 1) {
                    console.log(`進度: ${i + 1}/${img.frames.length} (${((i + 1) / img.frames.length * 100).toFixed(0)}%)`);
                }
            }
            // Explicitly release canvas memory
            canvas = null;
        }

        console.log('Frames extracted and coalesced, starting conversion...');

        // 計算 FPS
        let fps = 10;
        if (img.hasAnim && img.anim.frames.length > 0) {
            const avgDelay = img.anim.frames[0].delay || 100;
            fps = Math.round(1000 / avgDelay);
            console.log(`Detected FPS: ${fps} (from delay: ${avgDelay}ms)`);
        }

        // Explicitly release image memory
        img = null;
        if (global.gc) {
            global.gc();
        }

        // Convert frames to MP4 using FFmpeg
        ffmpeg()
            .input(path.join(tempDir, 'frame_%05d.png'))
            .inputFPS(fps)
            .output(outputPath)
            .videoCodec('libx264')
            .outputOptions([
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure dimensions are divisible by 2
                '-pix_fmt', 'yuv420p' // Ensure compatibility
            ])
            .on('start', (commandLine) => {
                console.log('Spawned Ffmpeg with command: ' + commandLine);
            })
            // .on('stderr', (stderrLine) => {
            //     console.log('Stderr output: ' + stderrLine);
            // })
            .on('end', () => {
                console.log('Conversion finished');
                console.log(`\n🎬 轉換完成!`);
                console.log(`📁 暫存檔保留位置: ${tempDir}`);
                console.log(`📁 輸入檔保留位置: ${inputPathAbs}`);
                console.log(`📹 輸出檔位置: ${outputPath}\n`);
                res.download(outputPath, outputFilename, (err) => {
                    if (err) console.error('Error sending file:', err);

                    cleanup(inputPathAbs, tempDir, outputPath);
                });
            })
            .on('error', (err, stdout, stderr) => {
                console.error('Error during conversion:', err);
                console.error('FFmpeg stderr:', stderr);
                console.log(`📁 錯誤時暫存檔保留位置: ${tempDir}`);
                // SECURITY: Sanitize error message to prevent XSS
                res.status(500).json({ error: 'Error during conversion', details: sanitizeErrorMessage(err.message) });
                cleanup(inputPathAbs, tempDir, outputPath);
            })
            .run();

    } catch (error) {
        console.error('Error processing WebP:', error);
        console.log(`📁 錯誤時暫存檔保留位置: ${tempDir}`);
        // SECURITY: Sanitize error message to prevent XSS
        res.status(500).json({ error: 'Error processing WebP', details: sanitizeErrorMessage(error.message) });
        cleanup(inputPathAbs, tempDir, outputPath);
    }
});

// Error handling middleware for multer and other errors
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024);
            // SECURITY: Use JSON response to prevent XSS
            return res.status(400).json({ error: `檔案太大！最大允許 ${maxSizeMB}MB。File too large! Maximum size is ${maxSizeMB}MB.` });
        }
        // SECURITY: Sanitize error message to prevent XSS
        return res.status(400).json({ error: '檔案上傳錯誤', details: sanitizeErrorMessage(err.message) });
    } else if (err) {
        // SECURITY: Sanitize error message to prevent XSS
        return res.status(400).json({ error: sanitizeErrorMessage(err.message) });
    }
    next();
});

// Cleanup old temp folders on startup
const uploadDir = 'uploads';
if (fs.existsSync(uploadDir)) {
    fs.readdirSync(uploadDir).forEach(file => {
        if (file.startsWith('temp-')) {
            const tempPath = path.join(uploadDir, file);
            // SECURITY: Validate path before deletion
            if (!isPathSafe(tempPath, uploadDir)) {
                console.warn('Security: Rejected cleanup of temp folder outside uploads directory:', tempPath);
                return;
            }
            try {
                fs.rmSync(tempPath, { recursive: true, force: true });
                console.log('Cleaned up stale temp folder:', tempPath);
            } catch (e) {
                console.error('Failed to clean up stale temp folder:', tempPath, e);
            }
        }
    });
}

// Cleanup old output files on startup
if (fs.existsSync(outputDir)) {
    fs.readdirSync(outputDir).forEach(file => {
        const filePath = path.join(outputDir, file);
        // SECURITY: Validate path before deletion
        if (!isPathSafe(filePath, outputDir)) {
            console.warn('Security: Rejected cleanup of output file outside outputs directory:', filePath);
            return;
        }
        try {
            fs.unlinkSync(filePath);
            console.log('Cleaned up stale output file:', filePath);
        } catch (e) {
            console.error('Failed to clean up stale output file:', filePath, e);
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Security helper: Sanitize error messages to prevent XSS
function sanitizeErrorMessage(message) {
    if (!message) return 'An error occurred';

    // Convert to string and escape HTML special characters
    return String(message)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Security helper: Validate path is within allowed directory
function isPathSafe(filePath, allowedDir) {
    if (!filePath) return false;

    try {
        const normalized = path.normalize(filePath);
        const resolved = path.resolve(normalized);
        const allowedPath = path.resolve(allowedDir);

        // Ensure the resolved path starts with the allowed directory
        return resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath;
    } catch (e) {
        console.error('Path validation error:', e);
        return false;
    }
}

function cleanup(inputPath, tempDir, outputPath) {
    // Schedule cleanup with delay to allow file handles to be released
    setTimeout(() => {
        cleanupWithRetry(inputPath, tempDir, outputPath, 3);
    }, 100);
}

function cleanupWithRetry(inputPath, tempDir, outputPath, retries) {
    try {
        // SECURITY: Validate and clean up input file
        if (inputPath) {
            if (!isPathSafe(inputPath, 'uploads')) {
                console.warn('Security: Rejected cleanup of input file outside uploads directory:', inputPath);
            } else if (fs.existsSync(inputPath)) {
                try {
                    fs.unlinkSync(inputPath);
                    console.log('Cleaned up input file:', inputPath);
                } catch (e) {
                    if (e.code === 'EBUSY' && retries > 0) {
                        console.log(`File busy, retrying... (${retries} attempts left)`);
                        setTimeout(() => cleanupWithRetry(inputPath, tempDir, outputPath, retries - 1), 500);
                        return;
                    } else {
                        console.warn('Could not delete input file (will be cleaned on next startup):', inputPath);
                    }
                }
            }
        }

        // SECURITY: Validate and clean up temp directory
        if (tempDir) {
            if (!isPathSafe(tempDir, 'uploads')) {
                console.warn('Security: Rejected cleanup of temp directory outside uploads directory:', tempDir);
            } else if (fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log('Cleaned up temp directory:', tempDir);
                } catch (e) {
                    if (e.code === 'EBUSY' && retries > 0) {
                        console.log(`Directory busy, retrying... (${retries} attempts left)`);
                        setTimeout(() => cleanupWithRetry(inputPath, tempDir, outputPath, retries - 1), 500);
                        return;
                    } else {
                        console.warn('Could not delete temp directory (will be cleaned on next startup):', tempDir);
                    }
                }
            }
        }

        // SECURITY: Validate and clean up output file
        if (outputPath) {
            if (!isPathSafe(outputPath, 'outputs')) {
                console.warn('Security: Rejected cleanup of output file outside outputs directory:', outputPath);
            } else if (fs.existsSync(outputPath)) {
                try {
                    fs.unlinkSync(outputPath);
                    console.log('Cleaned up output file:', outputPath);
                } catch (e) {
                    if (e.code === 'EBUSY' && retries > 0) {
                        console.log(`Output file busy, retrying... (${retries} attempts left)`);
                        setTimeout(() => cleanupWithRetry(inputPath, tempDir, outputPath, retries - 1), 500);
                        return;
                    } else {
                        console.warn('Could not delete output file (will be cleaned on next startup):', outputPath);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error during cleanup:', e.message);
    }
}
