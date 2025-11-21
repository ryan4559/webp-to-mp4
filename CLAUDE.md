# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A local web application that converts animated WebP files to MP4 video format using manual frame coalescing and FFmpeg encoding.

## Running the Application

```bash
npm install  # Install dependencies first
npm start    # Starts server on http://localhost:3000
```

## Core Architecture

### WebP Frame Coalescing Pipeline

The conversion process involves **manual frame composition** (coalescing) because `node-webpmux`'s `getFrameData()` returns unprocessed raw frame data without applying blend/dispose operations:

1. **Frame Extraction** (`server.js:58-90`)
   - Initialize WebP library via `WebP.Image.initLib()` (required for `getFrameData()`)
   - Load WebP using `node-webpmux`
   - Extract raw RGBA data for each frame via `getFrameData(i)`
   - Each frame has metadata: `x`, `y`, `width`, `height`, `blend`, `dispose`, `delay`

2. **Frame Coalescing** (`server.js:88-178`)
   - Maintain a persistent canvas buffer (`width × height × 4` RGBA)
   - Initialize canvas with background color from `img.anim.bgColor` (default: white)
   - For each frame:
     - **Coordinate Adjustment** (`server.js:92-93`): Apply `x0 = (fmeta.x || 0) * 2` and `y0 = (fmeta.y || 0) * 2` to fix coordinate offset issues
     - **Blend Processing** (`server.js:98-144`):
       - `blend=false`: Direct pixel copy (NO_BLEND mode) - overwrites canvas region without alpha compositing
       - `blend=true`: Porter-Duff "source over" alpha compositing with optimized handling:
         - `alpha=255`: Direct overwrite (fully opaque)
         - `alpha=0`: Skip (fully transparent, preserve canvas)
         - `0<alpha<255`: Full Porter-Duff compositing
     - **Canvas Update**: Apply frame to canvas at position `(x0, y0)` with size `(fw, fh)`
     - **Save Frame**: Export entire canvas as PNG (`frame_XXXXX.png`)
     - **Dispose Processing** (`server.js:160-171`): If `dispose=true`, clear the frame region to background color
   - Progress logging every 50 frames

3. **Video Encoding** (`server.js:191-225`)
   - FFmpeg reads frame sequence: `frame_%05d.png`
   - Calculate FPS from WebP delay: `fps = 1000 / firstFrameDelay`
   - Encode to H.264 MP4 with:
     - `libx264` codec
     - `yuv420p` pixel format for compatibility
     - Dimensions adjusted to be divisible by 2 via scale filter

### Key Implementation Details

**Coordinate Scaling (RFC 9649)**: The `x0` and `y0` coordinates are multiplied by 2 (`server.js:92-93`) as required by the WebP specification (RFC 9649). The ANMF chunk stores half-resolution coordinates to save bitstream space, so actual pixel position = stored value × 2.

**Alpha Blending**: The Porter-Duff compositing formula (`server.js:130-140`) correctly handles pre-multiplied alpha:
- `outA = sa + da * (255 - sa) / 255`
- `canvas[di] = ((sr * sa + dr * da * (255 - sa) / 255) / outA) | 0`

**Cleanup Strategy**:
- Automatic cleanup with retry mechanism (`server.js:268-322`)
- Handles `EBUSY` errors on Windows by retrying up to 3 times with 500ms delays
- Startup cleanup removes stale temp folders and output files from previous runs
- Raw frame debugging code is commented out (`server.js:148-151`) to reduce disk usage

**Static WebP Handling**: If WebP is not animated (`!img.hasAnim`), the file is copied directly as a single frame for conversion.

## File Structure

- `server.js` - Express server with WebP→MP4 conversion pipeline
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
- `multer` (v1.4.5-lts.1) - File upload handling
- `express` (v4.18.2) - Web server

## Known Issues & Debugging

- **Windows file locking**: Cleanup may fail on Windows due to `EBUSY` errors; retry mechanism implemented
- **FPS calculation**: Uses only first frame's delay; may be inaccurate for variable frame rate WebP files
