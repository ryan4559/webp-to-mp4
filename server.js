require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();

// Use resolved/canonical uploads root directory for all path checks
// (Using let to wrap in try/catch in case directory not present at startup)
let uploadRoot;
try {
    uploadRoot = fs.realpathSync(path.resolve('uploads'));
} catch (e) {
    // If the uploads directory does not exist, fall back to absolute path
    uploadRoot = path.resolve('uploads');
}
// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const CONVERT_RATE_LIMIT_WINDOW = parseInt(process.env.CONVERT_RATE_LIMIT_WINDOW_MIN || '15') * 60 * 1000;
const CONVERT_RATE_LIMIT_MAX = parseInt(process.env.CONVERT_RATE_LIMIT_MAX || '10');
const GENERAL_RATE_LIMIT_WINDOW = parseInt(process.env.GENERAL_RATE_LIMIT_WINDOW_MIN || '15') * 60 * 1000;
const GENERAL_RATE_LIMIT_MAX = parseInt(process.env.GENERAL_RATE_LIMIT_MAX || '100');

// Set ffmpeg path


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
    // Use canonical root path for safety checks (already defined above)
    let inputPathAbs;
    try {
        inputPathAbs = fs.realpathSync(path.resolve(inputPath));
    } catch (e) {
        // If the file isn't found or is invalid, reject
        return res.status(400).json({ error: 'Uploaded file not found/safe.' });
    }
    // Use improved path safety check
    if (!isPathSafe(inputPathAbs, uploadRoot)) {
        // Reject if file not strictly contained in uploads root
        return res.status(403).json({ error: 'Invalid file path.' });
    }
    // Use only the verified, absolute path hereafter
    const outputFilename = `converted-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);
    const tempDir = path.join('uploads', `temp-${Date.now()}`);

    const { fork } = require('child_process');

    try {
        // Create temp directory for frames
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        console.log('Spawning worker for conversion...');
        const worker = fork(path.join(__dirname, 'conversion-worker.js'), [inputPathAbs, tempDir, outputPath]);

        worker.on('message', (msg) => {
            if (msg.type === 'progress') {
                console.log(`[Worker] ${msg.message} (${msg.value}%)`);
            }
        });

        worker.on('exit', (code) => {
            if (code === 0) {
                console.log('Worker finished successfully.');
                console.log(`\n🎬 轉換完成!`);
                console.log(`📁 暫存檔保留位置: ${tempDir}`);
                console.log(`📁 輸入檔保留位置: ${inputPathAbs}`);
                console.log(`📹 輸出檔位置: ${outputPath}\n`);
                res.download(outputPath, outputFilename, (err) => {
                    if (err) console.error('Error sending file:', err);
                    cleanup(inputPathAbs, tempDir, outputPath);
                });
            } else {
                console.error('Worker failed with code:', code);
                console.log(`📁 錯誤時暫存檔保留位置: ${tempDir}`);
                res.status(500).send('Error during conversion (Worker failed)');
                cleanup(inputPathAbs, tempDir, outputPath);
            }
        });

        worker.on('error', (err) => {
            console.error('Failed to start worker:', err);
            res.status(500).send('Failed to start conversion worker');
            cleanup(inputPathAbs, tempDir, outputPath);
        });

    } catch (error) {
        console.error('Error initiating conversion:', error);
        console.log(`📁 錯誤時暫存檔保留位置: ${tempDir}`);
        res.status(500).send('Error initiating conversion: ' + error.message);
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
        // Use realpathSync to resolve symlinks for both paths
        const resolved = fs.realpathSync(path.resolve(filePath));
        const allowedPath = fs.realpathSync(path.resolve(allowedDir));

        // Ensure the resolved path is either the allowed directory or inside it
        return resolved === allowedPath ||
            (resolved.startsWith(allowedPath + path.sep));
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
            if (!isPathSafe(inputPath, uploadRoot)) {
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
