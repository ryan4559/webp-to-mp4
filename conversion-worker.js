const fs = require('fs');
const path = require('path');
const WebP = require('node-webpmux');
const { PNG } = require('pngjs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Receive parameters from parent process
const [inputPath, tempDir, outputPath] = process.argv.slice(2);

if (!inputPath || !tempDir || !outputPath) {
    console.error('Missing required arguments: inputPath, tempDir, outputPath');
    process.exit(1);
}

async function convert() {
    try {
        // Create temp directory for frames
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        // Initialize WebP library
        await WebP.Image.initLib();

        // Load WebP
        let img = new WebP.Image();
        await img.load(inputPath);

        // Extract and Coalesce frames
        if (!img.hasAnim) {
            console.log('Static WebP detected, copying as single frame...');
            fs.copyFileSync(inputPath, path.join(tempDir, 'frame_00000.png'));
        } else {
            console.log(`Extracting and coalescing ${img.frames.length} frames...`);
            const width = img.width;
            const height = img.height;
            const bg = (img.anim && img.anim.bgColor) ? img.anim.bgColor : [255, 255, 255, 255]; // RGBA

            // Create persistent canvas (RGBA)
            let canvas = Buffer.alloc(width * height * 4);
            // Fill background
            for (let i = 0; i < width * height; i++) {
                canvas[i * 4 + 0] = bg[0];
                canvas[i * 4 + 1] = bg[1];
                canvas[i * 4 + 2] = bg[2];
                canvas[i * 4 + 3] = bg[3];
            }

            console.log('Starting frame composition...');

            for (let i = 0; i < img.frames.length; i++) {
                const fmeta = img.anim.frames[i];
                const rgba = await img.getFrameData(i);

                const x0 = (fmeta.x || 0) * 2;
                const y0 = (fmeta.y || 0) * 2;
                const fw = fmeta.width;
                const fh = fmeta.height;

                if (fmeta.blend === false) {
                    for (let y = 0; y < fh; y++) {
                        for (let x = 0; x < fw; x++) {
                            const si = (y * fw + x) * 4;
                            const di = ((y0 + y) * width + (x0 + x)) * 4;
                            canvas[di + 0] = rgba[si + 0];
                            canvas[di + 1] = rgba[si + 1];
                            canvas[di + 2] = rgba[si + 2];
                            canvas[di + 3] = rgba[si + 3];
                        }
                    }
                } else {
                    for (let y = 0; y < fh; y++) {
                        for (let x = 0; x < fw; x++) {
                            const si = (y * fw + x) * 4;
                            const di = ((y0 + y) * width + (x0 + x)) * 4;
                            const sa = rgba[si + 3];
                            if (sa === 255) {
                                canvas[di + 0] = rgba[si + 0];
                                canvas[di + 1] = rgba[si + 1];
                                canvas[di + 2] = rgba[si + 2];
                                canvas[di + 3] = 255;
                            } else if (sa === 0) {
                                // keep existing
                            } else {
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
                const png = new PNG({ width, height });
                png.data = Buffer.from(canvas);
                const outPath = path.join(tempDir, `frame_${frameIndex}.png`);
                await new Promise((resolve, reject) => png.pack().pipe(fs.createWriteStream(outPath)).on('finish', resolve).on('error', reject));

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

                if (i % 50 === 0 || i === img.frames.length - 1) {
                    const progress = ((i + 1) / img.frames.length * 100).toFixed(0);
                    if (process.send) process.send({ type: 'progress', value: progress, message: `Processing frame ${i + 1}/${img.frames.length}` });
                }
            }
            canvas = null;
        }

        let fps = 10;
        if (img.hasAnim && img.anim.frames.length > 0) {
            const avgDelay = img.anim.frames[0].delay || 100;
            fps = Math.round(1000 / avgDelay);
        }
        img = null;
        if (global.gc) global.gc();

        ffmpeg()
            .input(path.join(tempDir, 'frame_%05d.png'))
            .inputFPS(fps)
            .output(outputPath)
            .videoCodec('libx264')
            .outputOptions([
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-pix_fmt', 'yuv420p'
            ])
            .on('start', (commandLine) => {
                console.log('Spawned Ffmpeg with command: ' + commandLine);
            })
            .on('end', () => {
                console.log('Conversion finished');
                process.exit(0);
            })
            .on('error', (err, stdout, stderr) => {
                console.error('Error during conversion:', err);
                console.error('FFmpeg stderr:', stderr);
                process.exit(1);
            })
            .run();

    } catch (error) {
        console.error('Worker error:', error);
        process.exit(1);
    }
}

convert();
