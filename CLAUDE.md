# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web application that converts animated WebP files to MP4 video format using manual frame coalescing and FFmpeg encoding. Uses a child process architecture for memory isolation, making it suitable for cloud deployment with minimal resource usage. Supports platforms like Render, Railway, Heroku, etc.

## Running the Application

### Local Development

```bash
npm install           # Install dependencies first
cp .env.example .env  # Copy environment variables template (optional, uses defaults if skipped)
npm start             # Starts server on http://localhost:3000
```

### Cloud Deployment

Set the following environment variables on your cloud platform:
- `PORT` - Automatically set by most platforms
- `MAX_FILE_SIZE_MB` - Maximum file size in MB (default: 50)
- `CONVERT_RATE_LIMIT_WINDOW_MIN` - Conversion rate limit window in minutes (default: 15)
- `CONVERT_RATE_LIMIT_MAX` - Max conversion requests per window (default: 10)
- `GENERAL_RATE_LIMIT_WINDOW_MIN` - General rate limit window in minutes (default: 15)
- `GENERAL_RATE_LIMIT_MAX` - Max general requests per window (default: 100)

See `.env.example` for full configuration options.

## Core Architecture

### Child Process Architecture

The application uses a **worker process isolation pattern** to prevent memory leaks and reduce cloud hosting costs:

1. **Main Server Process** (`server.js`)
   - Express HTTP server with route handling, rate limiting, and security features
   - File upload management using Multer with validation
   - Spawns child process for each conversion request via `child_process.fork()`
   - Monitors worker progress via IPC messages
   - Handles cleanup of temporary files and directories with retry logic

2. **Conversion Worker Process** (`conversion-worker.js`)
   - Runs in isolated memory space (separate Node.js process)
   - Performs WebP frame extraction and coalescing
   - Invokes FFmpeg for video encoding
   - Sends progress updates to parent via `process.send()`
   - Automatically terminates after conversion completes
   - Triggers manual garbage collection (`global.gc()`) to release memory

**Memory Benefits**: Each worker process exits after conversion, releasing ALL memory (including native library allocations). This prevents memory accumulation that could occur with in-process conversions.

### WebP Frame Coalescing Pipeline

The conversion process involves **manual frame composition** (coalescing) because `node-webpmux`'s `getFrameData()` returns unprocessed raw frame data without applying blend/dispose operations:

1. **Frame Extraction** (`conversion-worker.js:26-32`)
   - Initialize WebP library via `WebP.Image.initLib()` (required for `getFrameData()`)
   - Load WebP using `node-webpmux`
   - Extract raw RGBA data for each frame via `getFrameData(i)`
   - Each frame has metadata: `x`, `y`, `width`, `height`, `blend`, `dispose`, `delay`

2. **Frame Coalescing** (`conversion-worker.js:34-129`)
   - Maintain a persistent canvas buffer (`width × height × 4` RGBA)
   - Initialize canvas with background color from `img.anim.bgColor` (default: white)
   - For each frame:
     - **Coordinate Adjustment** (`conversion-worker.js:59-60`): Apply `x0 = (fmeta.x || 0) * 2` and `y0 = (fmeta.y || 0) * 2` to fix coordinate offset issues
     - **Blend Processing** (`conversion-worker.js:64-102`):
       - `blend=false`: Direct pixel copy (NO_BLEND mode) - overwrites canvas region without alpha compositing
       - `blend=true`: Porter-Duff "source over" alpha compositing with optimized handling:
         - `alpha=255`: Direct overwrite (fully opaque)
         - `alpha=0`: Skip (fully transparent, preserve canvas)
         - `0<alpha<255`: Full Porter-Duff compositing
     - **Canvas Update**: Apply frame to canvas at position `(x0, y0)` with size `(fw, fh)`
     - **Save Frame**: Export entire canvas as PNG (`frame_XXXXX.png`)
     - **Dispose Processing** (`conversion-worker.js:110-121`): If `dispose=true`, clear the frame region to background color
   - Progress logging every 50 frames
   - Nullify buffers and trigger GC before FFmpeg phase

3. **Video Encoding** (`conversion-worker.js:139-160`)
   - FFmpeg reads frame sequence: `frame_%05d.png`
   - Calculate FPS from WebP delay: `fps = 1000 / firstFrameDelay`
   - Encode to H.264 MP4 with:
     - `libx264` codec
     - `yuv420p` pixel format for compatibility
     - Dimensions adjusted to be divisible by 2 via scale filter
   - Worker exits with code 0 on success, code 1 on error

### Key Implementation Details

**Coordinate Scaling (RFC 9649)**: The `x0` and `y0` coordinates are multiplied by 2 (`conversion-worker.js:59-60`) as required by the WebP specification (RFC 9649). The ANMF chunk stores half-resolution coordinates to save bitstream space, so actual pixel position = stored value × 2.

**Alpha Blending**: The Porter-Duff compositing formula (`conversion-worker.js:90-97`) correctly handles pre-multiplied alpha:
- `outA = sa + da * (255 - sa) / 255`
- `canvas[di] = ((sr * sa + dr * da * (255 - sa) / 255) / outA) | 0`

**Cleanup Strategy**:
- Automatic cleanup with retry mechanism (`server.js:269-340`)
- Handles `EBUSY` errors on Windows by retrying up to 3 times with 500ms delays
- Startup cleanup removes stale temp folders and output files from previous runs (`server.js:194-231`)
- Path validation ensures all cleanup operations stay within designated directories

**Static WebP Handling**: If WebP is not animated (`!img.hasAnim`), the file is copied directly as a single frame for conversion (`conversion-worker.js:34-36`).

**Process Lifecycle**:
- Worker spawned via `child_process.fork()` with arguments: `[inputPath, tempDir, outputPath]` (`server.js:136`)
- IPC communication for progress updates (`conversion-worker.js:125`)
- Worker exits automatically after FFmpeg completes or on error
- Parent process monitors worker exit codes and handles file cleanup

## File Structure

- `server.js` - Express HTTP server with route handling, rate limiting, security features, and worker process management
- `conversion-worker.js` - Child process worker that performs WebP frame extraction, coalescing, and FFmpeg encoding
- `.env` - Environment variables configuration (not in git, create from `.env.example`)
- `.env.example` - Template for environment variables with defaults
- `public/` - Frontend files (HTML/CSS/JS)
  - `index.html` - Main UI
  - `style.css` - Glassmorphism design with dark theme
  - `script.js` - Client-side upload and progress handling
- `uploads/` - Temporary upload storage and frame extraction (`temp-*/`)
- `outputs/` - Final MP4 files (auto-cleanup on startup)

## Dependencies

- `node-webpmux` (v3.2.1) - WebP parsing and frame extraction (raw, unprocessed data)
- `pngjs` (v7.0.0) - PNG encoding for intermediate frames
- `fluent-ffmpeg` (v2.1.2) + `ffmpeg-static` (v5.2.0) - Video encoding
- `multer` (v1.4.5-lts.1) - File upload handling with size limits and validation
- `express` (v4.18.2) - Web server
- `express-rate-limit` (v7.x) - Rate limiting middleware for API protection
- `dotenv` (v16.x) - Environment variable management

## Security & Performance Features

### File Upload Security
- **File size limit**: Configurable via `MAX_FILE_SIZE_MB` (default: 50MB)
- **File type validation**: Only accepts WebP files (checks both MIME type and extension)
- **Error handling**: Graceful error messages for invalid uploads

### Rate Limiting
- **Conversion endpoint**: Configurable rate limit (default: 10 requests per 15 minutes per IP)
- **General endpoints**: Configurable rate limit (default: 100 requests per 15 minutes per IP)
- **DoS protection**: Prevents abuse and resource exhaustion

### Memory Management
- **Process isolation**: Each conversion runs in a separate worker process
- **Automatic cleanup**: Worker processes exit after completion, releasing all memory
- **Manual GC**: Worker triggers `global.gc()` before FFmpeg phase to minimize memory footprint
- **Cost optimization**: Prevents memory leaks common in long-running processes, ideal for cloud deployments

### Health Check
- **`/health` endpoint**: Returns `200 OK` for cloud platform health checks

All security parameters are configurable via environment variables (see `.env.example`).

## Known Issues & Debugging

- **Windows file locking**: Cleanup may fail on Windows due to `EBUSY` errors; retry mechanism implemented with 3 retries and 500ms delays
- **FPS calculation**: Uses only first frame's delay; may be inaccurate for variable frame rate WebP files
- **Worker process debugging**: Check console logs for worker spawn/exit events and IPC messages
- **Memory profiling**: Run worker with `--expose-gc` flag (already configured in `conversion-worker.js` usage) to enable manual garbage collection
