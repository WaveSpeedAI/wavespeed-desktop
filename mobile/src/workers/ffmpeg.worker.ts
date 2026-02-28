import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let loadingPromise: Promise<void> | null = null;
let currentOperationId: number | null = null;

// Cache configuration
const CACHE_NAME = "ffmpeg-wasm-cache";

// Use the older, more stable 0.12.4 version with UMD build (not ESM)
// This version is smaller and initializes faster
function getFFmpegURLs() {
  // Try unpkg first, fallback to jsdelivr
  const base = "https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd";
  return {
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
  };
}

/**
 * Check if FFmpeg files are cached
 */
async function isFFmpegCached(): Promise<boolean> {
  try {
    const urls = getFFmpegURLs();
    const cache = await caches.open(CACHE_NAME);
    const coreResponse = await cache.match(urls.coreURL);
    const wasmResponse = await cache.match(urls.wasmURL);
    return coreResponse !== undefined && wasmResponse !== undefined;
  } catch {
    return false;
  }
}

/**
 * Download file with progress and cache it
 */
async function downloadAndCache(
  url: string,
  mimeType: string,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const cache = await caches.open(CACHE_NAME);

  // Check cache first
  const cachedResponse = await cache.match(url);
  if (cachedResponse) {
    const blob = await cachedResponse.blob();
    onProgress?.(blob.size, blob.size);
    return URL.createObjectURL(blob);
  }

  // Download with progress
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const reader = response.body?.getReader();

  if (!reader) throw new Error("Failed to get response reader");

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }

  // Combine chunks
  const buffer = new Uint8Array(received);
  let position = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, position);
    position += chunk.length;
  }

  // Cache the file
  try {
    const cacheResponse = new Response(buffer.buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.byteLength.toString(),
      },
    });
    await cache.put(url, cacheResponse);
  } catch (e) {
    console.warn("[FFmpeg] Failed to cache:", e);
  }

  // Return blob URL
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

interface ConvertOptions {
  videoCodec?: string;
  videoBitrate?: string;
  resolution?: string;
  fps?: number;
  audioCodec?: string;
  audioBitrate?: string;
  sampleRate?: number;
  quality?: number;
}

interface ConvertPayload {
  file: ArrayBuffer;
  fileName: string;
  outputFormat: string;
  outputExt: string;
  options?: ConvertOptions;
  id: number;
}

interface MergePayload {
  files: ArrayBuffer[];
  fileNames: string[];
  outputFormat: string;
  outputExt: string;
  id: number;
}

interface TrimPayload {
  file: ArrayBuffer;
  fileName: string;
  startTime: number;
  endTime: number;
  outputFormat: string;
  outputExt: string;
  id: number;
}

interface InfoPayload {
  file: ArrayBuffer;
  fileName: string;
  id: number;
}

/**
 * Load FFmpeg with caching support
 * @param onProgress Progress callback (0-100)
 * @param skipIfCached If true and files are cached, skip download progress reporting
 */
async function ensureLoaded(
  onProgress?: (progress: number) => void,
  skipIfCached?: boolean,
): Promise<{ ffmpeg: FFmpeg; wasCached: boolean }> {
  if (isLoaded && ffmpeg) return { ffmpeg, wasCached: true };

  if (loadingPromise) {
    await loadingPromise;
    return { ffmpeg: ffmpeg!, wasCached: true };
  }

  let wasCached = false;

  loadingPromise = (async () => {
    ffmpeg = new FFmpeg();

    // Get FFmpeg URLs (single-threaded version for better compatibility)
    const urls = getFFmpegURLs();
    console.log(
      "[FFmpeg] Using single-threaded version for browser compatibility",
    );

    // Check if files are already cached
    const cached = await isFFmpegCached();
    wasCached = cached;
    console.log(`[FFmpeg] Files cached: ${cached}`);

    // Always use toBlobURL for loading - it handles caching internally via browser HTTP cache
    // This is the recommended approach by ffmpeg.wasm
    console.log(
      "[FFmpeg] Loading FFmpeg using toBlobURL (uses browser HTTP cache)...",
    );
    const startTime = Date.now();

    try {
      onProgress?.(10);
      console.log("[FFmpeg] Fetching ffmpeg-core.js...");
      const coreURL = await toBlobURL(urls.coreURL, "text/javascript");
      console.log("[FFmpeg] ffmpeg-core.js ready");

      onProgress?.(40);
      console.log(
        "[FFmpeg] Fetching ffmpeg-core.wasm (~24MB, uses HTTP cache if available)...",
      );
      const wasmURL = await toBlobURL(urls.wasmURL, "application/wasm");
      console.log("[FFmpeg] ffmpeg-core.wasm ready");

      onProgress?.(70);
      console.log("[FFmpeg] Calling ffmpeg.load()...");

      // Progress simulation during load
      let loadProgress = 70;
      const progressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`[FFmpeg] Still in ffmpeg.load()... (${elapsed}s elapsed)`);
        if (loadProgress < 95) {
          loadProgress += 2;
          onProgress?.(loadProgress);
        }
      }, 2000);

      try {
        // 60 second timeout for ffmpeg.load()
        const loadPromise = ffmpeg.load({ coreURL, wasmURL });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  "FFmpeg initialization timed out (60s). Try refreshing the page.",
                ),
              ),
            60000,
          );
        });

        await Promise.race([loadPromise, timeoutPromise]);

        const totalTime = Math.floor((Date.now() - startTime) / 1000);
        console.log(`[FFmpeg] Ready! (took ${totalTime}s)`);

        isLoaded = true;
        onProgress?.(100);
        return;
      } finally {
        clearInterval(progressInterval);
      }
    } catch (err) {
      console.error("[FFmpeg] Load failed:", err);
      // Reset state so user can retry
      ffmpeg = null;
      isLoaded = false;
      loadingPromise = null;
      throw err;
    }
  })();

  await loadingPromise;
  return { ffmpeg: ffmpeg!, wasCached };
}

function buildConvertArgs(
  inputFile: string,
  outputFile: string,
  outputFormat: string,
  options?: ConvertOptions,
): string[] {
  console.log(
    `[FFmpeg] Building args for format: ${outputFormat}, options:`,
    options,
  );
  const args: string[] = ["-i", inputFile];

  // Image conversion
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(outputFormat)) {
    if (options?.quality && ["jpg", "jpeg", "webp"].includes(outputFormat)) {
      if (outputFormat === "webp") {
        args.push("-quality", String(options.quality));
      } else {
        const qscale = Math.round(31 - (options.quality / 100) * 29);
        args.push("-qscale:v", String(qscale));
      }
    }
    args.push("-frames:v", "1", "-update", "1", outputFile);
    return args;
  }

  // Lossless/uncompressed audio formats (no bitrate)
  const losslessAudioFormats = ["wav", "flac"];
  const isLossless = losslessAudioFormats.includes(outputFormat);

  // Video/Audio options
  if (options?.videoCodec) args.push("-c:v", options.videoCodec);
  if (options?.videoBitrate) args.push("-b:v", options.videoBitrate);
  if (options?.resolution && options.resolution !== "original") {
    args.push("-vf", `scale=${options.resolution.replace("x", ":")}`);
  }
  if (options?.fps) args.push("-r", String(options.fps));

  // Audio codec handling
  if (options?.audioCodec) {
    // For WAV, use pcm_s16le which is widely supported
    if (outputFormat === "wav") {
      args.push("-c:a", "pcm_s16le");
    } else {
      args.push("-c:a", options.audioCodec);
    }
  }

  // Only add bitrate for lossy formats
  if (options?.audioBitrate && !isLossless) {
    args.push("-b:a", options.audioBitrate);
  }

  if (options?.sampleRate) args.push("-ar", String(options.sampleRate));

  args.push(outputFile);
  return args;
}

function parseDuration(log: string): number | null {
  const match = log.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (match) {
    return (
      parseInt(match[1]) * 3600 +
      parseInt(match[2]) * 60 +
      parseInt(match[3]) +
      parseInt(match[4]) / 100
    );
  }
  return null;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case "checkCache": {
        const cached = await isFFmpegCached();
        self.postMessage({ type: "cacheStatus", payload: { cached } });
        break;
      }

      case "load": {
        self.postMessage({ type: "phase", payload: { phase: "download" } });
        await ensureLoaded((progress) => {
          self.postMessage({
            type: "progress",
            payload: { phase: "download", progress },
          });
        }, false); // Don't skip - show full progress for preload
        self.postMessage({ type: "loaded" });
        break;
      }

      case "convert": {
        const { file, fileName, outputFormat, outputExt, options, id } =
          payload as ConvertPayload;
        currentOperationId = id;

        // Check if cached first
        const cached = await isFFmpegCached();

        if (!cached) {
          // Not cached - show download phase
          self.postMessage({
            type: "phase",
            payload: { phase: "download", id },
          });
        }

        const { ffmpeg: ff, wasCached } = await ensureLoaded((progress) => {
          if (!cached) {
            self.postMessage({
              type: "progress",
              payload: { phase: "download", progress, id },
            });
          }
        }, cached); // Skip download progress display if cached

        // Notify that we're skipping download phase if cached
        if (wasCached) {
          self.postMessage({ type: "cached", payload: { id } });
        }

        self.postMessage({ type: "phase", payload: { phase: "process", id } });

        await ff.writeFile(fileName, new Uint8Array(file));

        let totalDuration: number | null = null;
        let lastProgress = 0;

        // Set up logging to capture duration and debug info
        const logHandler = ({ message }: { message: string }) => {
          if (!totalDuration) totalDuration = parseDuration(message);
          // Log errors for debugging
          if (message.includes("Error") || message.includes("error")) {
            console.warn("[FFmpeg]", message);
          }
        };
        ff.on("log", logHandler);

        // Progress handler
        const progressHandler = ({
          progress,
          time,
        }: {
          progress: number;
          time: number;
        }) => {
          if (currentOperationId !== id) return;
          const progressPercent = Math.max(progress * 100, lastProgress);
          lastProgress = progressPercent;
          self.postMessage({
            type: "progress",
            payload: {
              phase: "process",
              progress: progressPercent,
              detail: totalDuration
                ? {
                    current: Math.floor(time / 1000000),
                    total: Math.floor(totalDuration),
                    unit: "seconds",
                  }
                : undefined,
              id,
            },
          });
        };
        ff.on("progress", progressHandler);

        const outputFile = `output.${outputExt}`;
        const args = buildConvertArgs(
          fileName,
          outputFile,
          outputFormat,
          options,
        );
        console.log("[FFmpeg] Running:", args.join(" "));

        try {
          const exitCode = await ff.exec(args);
          console.log("[FFmpeg] Exit code:", exitCode);

          if (exitCode !== 0) {
            throw new Error(`FFmpeg exited with code ${exitCode}`);
          }

          const data = await ff.readFile(outputFile);
          await ff.deleteFile(fileName);
          await ff.deleteFile(outputFile);

          const buffer = (data as Uint8Array).buffer;
          self.postMessage(
            {
              type: "result",
              payload: { data: buffer, filename: outputFile, id },
            },
            { transfer: [buffer] },
          );
        } finally {
          // Clean up event listeners
          ff.off("log", logHandler);
          ff.off("progress", progressHandler);
          currentOperationId = null;
        }
        break;
      }

      case "merge": {
        const { files, fileNames, outputFormat, outputExt, id } =
          payload as MergePayload;
        currentOperationId = id;

        // Check if cached first
        const cached = await isFFmpegCached();

        if (!cached) {
          self.postMessage({
            type: "phase",
            payload: { phase: "download", id },
          });
        }

        const { ffmpeg: ff, wasCached } = await ensureLoaded((progress) => {
          if (!cached) {
            self.postMessage({
              type: "progress",
              payload: { phase: "download", progress, id },
            });
          }
        }, cached);

        if (wasCached) {
          self.postMessage({ type: "cached", payload: { id } });
        }

        self.postMessage({ type: "phase", payload: { phase: "process", id } });

        for (let i = 0; i < files.length; i++) {
          await ff.writeFile(fileNames[i], new Uint8Array(files[i]));
        }

        const concatList = fileNames.map((name) => `file '${name}'`).join("\n");
        await ff.writeFile("concat.txt", concatList);

        ff.on("progress", ({ progress }) => {
          if (currentOperationId !== id) return;
          self.postMessage({
            type: "progress",
            payload: { phase: "process", progress: progress * 100, id },
          });
        });

        const outputFile = `output.${outputExt}`;
        await ff.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "concat.txt",
          "-c",
          "copy",
          outputFile,
        ]);

        const data = await ff.readFile(outputFile);
        for (const name of fileNames) await ff.deleteFile(name);
        await ff.deleteFile("concat.txt");
        await ff.deleteFile(outputFile);

        const buffer = (data as Uint8Array).buffer;
        self.postMessage(
          {
            type: "result",
            payload: { data: buffer, filename: outputFile, id },
          },
          { transfer: [buffer] },
        );
        currentOperationId = null;
        break;
      }

      case "trim": {
        const {
          file,
          fileName,
          startTime,
          endTime,
          outputFormat,
          outputExt,
          id,
        } = payload as TrimPayload;
        currentOperationId = id;

        // Check if cached first
        const cached = await isFFmpegCached();

        if (!cached) {
          self.postMessage({
            type: "phase",
            payload: { phase: "download", id },
          });
        }

        const { ffmpeg: ff, wasCached } = await ensureLoaded((progress) => {
          if (!cached) {
            self.postMessage({
              type: "progress",
              payload: { phase: "download", progress, id },
            });
          }
        }, cached);

        if (wasCached) {
          self.postMessage({ type: "cached", payload: { id } });
        }

        self.postMessage({ type: "phase", payload: { phase: "process", id } });

        await ff.writeFile(fileName, new Uint8Array(file));
        const duration = endTime - startTime;

        ff.on("progress", ({ progress }) => {
          if (currentOperationId !== id) return;
          self.postMessage({
            type: "progress",
            payload: {
              phase: "process",
              progress: progress * 100,
              detail: {
                current: Math.floor(progress * duration),
                total: Math.floor(duration),
                unit: "seconds",
              },
              id,
            },
          });
        });

        const outputFile = `output.${outputExt}`;
        await ff.exec([
          "-ss",
          String(startTime),
          "-i",
          fileName,
          "-t",
          String(duration),
          "-c",
          "copy",
          outputFile,
        ]);

        const data = await ff.readFile(outputFile);
        await ff.deleteFile(fileName);
        await ff.deleteFile(outputFile);

        const buffer = (data as Uint8Array).buffer;
        self.postMessage(
          {
            type: "result",
            payload: { data: buffer, filename: outputFile, id },
          },
          { transfer: [buffer] },
        );
        currentOperationId = null;
        break;
      }

      case "getInfo": {
        const { file, fileName, id } = payload as InfoPayload;
        const { ffmpeg: ff } = await ensureLoaded(undefined, true);

        await ff.writeFile(fileName, new Uint8Array(file));

        let logOutput = "";
        ff.on("log", ({ message }) => {
          logOutput += message + "\n";
        });

        try {
          await ff.exec(["-i", fileName, "-f", "null", "-"]);
        } catch {
          // Expected to fail, but logs contain info
        }

        const duration = parseDuration(logOutput);
        const resMatch = logOutput.match(/(\d{2,4})x(\d{2,4})/);
        const videoCodecMatch = logOutput.match(/Video: (\w+)/);
        const audioCodecMatch = logOutput.match(/Audio: (\w+)/);

        await ff.deleteFile(fileName);

        self.postMessage({
          type: "info",
          payload: {
            duration,
            resolution: resMatch
              ? { width: parseInt(resMatch[1]), height: parseInt(resMatch[2]) }
              : null,
            videoCodec: videoCodecMatch?.[1] || null,
            audioCodec: audioCodecMatch?.[1] || null,
            id,
          },
        });
        break;
      }

      case "cancel": {
        currentOperationId = null;
        break;
      }

      case "dispose": {
        ffmpeg = null;
        isLoaded = false;
        loadingPromise = null;
        self.postMessage({ type: "disposed" });
        break;
      }
    }
  } catch (error) {
    self.postMessage({ type: "error", payload: (error as Error).message });
  }
};
