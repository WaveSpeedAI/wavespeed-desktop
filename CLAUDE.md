# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

WaveSpeed Desktop is an Electron-based cross-platform desktop application that provides a playground interface for [WaveSpeedAI](https://wavespeed.ai) models. It allows users to browse models, run predictions, view their history, and manage saved assets.

Z-Image is the local image generation flow backed by stable-diffusion.cpp with model and auxiliary downloads, progress reporting, and log streaming.

## Tech Stack

- **Electron** with **electron-vite** for the desktop framework
- **React 18** + **TypeScript** for the UI
- **Tailwind CSS** + **shadcn/ui** for styling
- **Zustand** for state management
- **Axios** for HTTP requests

## Project Structure

```
wavespeed-desktop/
├── electron/              # Electron main process files
│   ├── main.ts           # Main process entry point
│   └── preload.ts        # Preload script for IPC bridge
├── src/
│   ├── api/
│   │   └── client.ts     # WaveSpeedAI API client (base URL, auth, methods)
│   ├── components/
│   │   ├── layout/       # Sidebar, Layout components
│   │   ├── playground/   # DynamicForm, FileUpload, OutputDisplay, MaskEditor, etc.
│   │   ├── shared/       # ApiKeyRequired and other shared components
│   │   └── ui/           # shadcn/ui components (Button, Card, etc.)
│   ├── hooks/            # Custom React hooks (useToast, useUpscalerWorker, useMultiPhaseProgress)
│   ├── i18n/             # Internationalization with react-i18next
│   │   └── locales/      # 18 language locale files
│   ├── lib/              # Utilities (cn, fuzzySearch, schemaUtils, maskUtils)
│   ├── pages/            # Page components (ModelsPage, PlaygroundPage, FreeToolsPage, etc.)
│   ├── stores/           # Zustand stores (apiKeyStore, modelsStore)
│   ├── types/            # TypeScript type definitions
│   └── workers/          # Web Workers (upscaler, backgroundRemover, imageEraser, faceEnhancer, segmentAnything, ffmpeg)
├── .github/workflows/    # GitHub Actions for CI/CD
│   ├── build.yml         # Build on push/tag/PR
│   └── nightly.yml       # Nightly builds
└── build/                # Build resources (icons, etc.)
```

## Key Files

- **`src/api/client.ts`**: API client with all WaveSpeedAI endpoints
- **`src/stores/apiKeyStore.ts`**: API key persistence and validation (electron-store + localStorage fallback)
- **`src/stores/modelsStore.ts`**: Model list caching, filtering, and sorting (supports sort_order/popularity)
- **`src/stores/playgroundStore.ts`**: Multi-tab playground state management
- **`src/stores/templateStore.ts`**: Template CRUD operations with localStorage persistence
- **`src/stores/themeStore.ts`**: Theme management (auto/dark/light) with system preference detection
- **`src/stores/assetsStore.ts`**: Asset management (save, delete, tags, favorites, filtering)
- **`src/components/playground/DynamicForm.tsx`**: Generates forms from model schemas
- **`src/components/playground/ModelSelector.tsx`**: Searchable model dropdown with fuzzy search
- **`src/components/playground/OutputDisplay.tsx`**: Displays prediction results (images, videos, text)
- **`src/components/playground/FileUpload.tsx`**: File upload with drag & drop, URL input, and media capture
- **`src/components/playground/MaskEditor.tsx`**: Canvas-based mask drawing with brush, eraser, and bucket fill tools
- **`src/components/playground/CameraCapture.tsx`**: Camera capture component for taking photos
- **`src/components/playground/VideoRecorder.tsx`**: Video recording with audio waveform visualization
- **`src/components/playground/AudioRecorder.tsx`**: Audio recording with waveform display and playback
- **`src/components/playground/BatchControls.tsx`**: Batch mode dropdown UI with slider for repeat count (2-16)
- **`src/components/playground/BatchOutputGrid.tsx`**: Grid display for batch prediction results with bulk actions
- **`src/pages/TemplatesPage.tsx`**: Template management (browse, search, use, rename, delete)
- **`src/pages/HistoryPage.tsx`**: Prediction history with detail dialog
- **`src/pages/AssetsPage.tsx`**: Asset management with grid view, filters, tags, favorites, bulk operations
- **`src/pages/FreeToolsPage.tsx`**: Hub page for free AI tools (no API key required)
- **`src/pages/ZImagePage.tsx`**: Local Z-Image generation UI (download steps, progress, logs, output)
- **`src/hooks/useZImage.ts`**: Z-Image download + generation hook (binary/model selection and download URLs)
- **`electron/lib/sdGenerator.ts`**: Stable-diffusion.cpp wrapper (spawn, progress parsing, cancellation)
- **`electron/main.ts`**: SD IPC handlers (binary path, download, extraction, system info, generation)
- **`src/pages/ImageEnhancerPage.tsx`**: Image upscaling with ESRGAN models (2x-4x)
- **`src/pages/VideoEnhancerPage.tsx`**: Video upscaling frame-by-frame with progress and ETA
- **`src/pages/BackgroundRemoverPage.tsx`**: Background removal displaying all 3 outputs (foreground, background, mask) simultaneously
- **`src/pages/FaceEnhancerPage.tsx`**: Face enhancement using YOLO v8 for detection and GFPGAN v1.4 for restoration
- **`src/pages/ImageEraserPage.tsx`**: Object removal using LaMa inpainting model with inline mask drawing and smart crop
- **`src/pages/SegmentAnythingPage.tsx`**: Interactive object segmentation using SlimSAM model with point prompts
- **`src/pages/FaceSwapperPage.tsx`**: Face swapping with source/target selection, multi-face support, and revert functionality
- **`src/pages/VideoConverterPage.tsx`**: Video format conversion with codec and quality options using FFmpeg WASM
- **`src/pages/AudioConverterPage.tsx`**: Audio format conversion with bitrate control using FFmpeg WASM
- **`src/pages/ImageConverterPage.tsx`**: Batch image format conversion with quality settings using FFmpeg WASM
- **`src/pages/MediaTrimmerPage.tsx`**: Video/audio trimming with start/end time selection using FFmpeg WASM
- **`src/pages/MediaMergerPage.tsx`**: Merge multiple video/audio files using FFmpeg WASM
- **`src/lib/schemaToForm.ts`**: Converts API schema to form field configurations
- **`src/lib/lamaUtils.ts`**: Image/tensor conversion utilities for inpainting models (canvasToFloat32Array, maskCanvasToFloat32Array, tensorToCanvas)
- **`src/lib/maskUtils.ts`**: Mask utility functions (flood fill, invert, video frame extraction)
- **`src/types/progress.ts`**: Multi-phase progress types (PhaseStatus, ProcessingPhase, MultiPhaseProgress) and utility functions (formatBytes, formatTime)
- **`src/types/batch.ts`**: Batch processing types (BatchConfig, BatchQueueItem, BatchState, BatchResult) and DEFAULT_BATCH_CONFIG
- **`src/hooks/useUpscalerWorker.ts`**: Hook for managing upscaler Web Worker with phase/progress callbacks
- **`src/hooks/useBackgroundRemoverWorker.ts`**: Hook for managing background remover Web Worker with removeBackgroundAll for batch processing
- **`src/hooks/useImageEraserWorker.ts`**: Hook for managing image eraser Web Worker with LaMa model initialization and object removal
- **`src/hooks/useFaceEnhancerWorker.ts`**: Hook for managing face enhancer Web Worker with YOLO detection and GFPGAN enhancement
- **`src/hooks/useSegmentAnythingWorker.ts`**: Hook for managing SAM Web Worker with segmentImage and decodeMask methods
- **`src/hooks/useFFmpegWorker.ts`**: Hook for managing FFmpeg Web Worker with convert, merge, trim, and getInfo methods
- **`src/hooks/useMultiPhaseProgress.ts`**: Hook for multi-phase progress state management with weighted phases, ETA calculation
- **`src/components/shared/ProcessingProgress.tsx`**: Compact single-row progress component with phase indicators, status, and ETA
- **`src/workers/upscaler.worker.ts`**: Web Worker for GPU-free image/video upscaling with UpscalerJS
- **`src/workers/backgroundRemover.worker.ts`**: Web Worker for background removal with @imgly/background-removal, supports processAll for batch output
- **`src/workers/imageEraser.worker.ts`**: Web Worker for LaMa inpainting model (512x512, quantized) with onnxruntime-web, WebGPU with WASM fallback, smart crop around mask for better quality
- **`src/workers/faceEnhancer.worker.ts`**: Web Worker for face enhancement using YOLO v8 (detection) + GFPGAN v1.4 (restoration) with onnxruntime-web, WebGPU with WASM fallback
- **`src/workers/segmentAnything.worker.ts`**: Web Worker for Segment Anything (SlimSAM) model using @huggingface/transformers with WebGPU acceleration for interactive object segmentation
- **`src/workers/faceSwapper.worker.ts`**: Web Worker for face swapping using InsightFace models (SCRFD det_10g, ArcFace w600k, Inswapper 128, EMAP) with optional GFPGAN enhancement
- **`src/hooks/useFaceSwapperWorker.ts`**: Hook for managing face swapper Web Worker with detectFaces, swapFaces, and dispose methods
- **`src/workers/ffmpeg.worker.ts`**: Web Worker for FFmpeg WASM operations (convert, merge, trim, getInfo) with progress reporting
- **`src/lib/ffmpegFormats.ts`**: Format definitions for video, audio, and image conversion (codecs, extensions, quality presets)

## WaveSpeedAI API

Base URL: `https://api.wavespeed.ai`
Authentication: `Authorization: Bearer {API_KEY}`

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v3/models` | GET | List available models with schemas |
| `/api/v3/{model}` | POST | Run a prediction |
| `/api/v3/predictions/{id}/result` | GET | Poll for prediction result |
| `/api/v3/predictions` | POST | Get prediction history (with date filters) |
| `/api/v3/media/upload/binary` | POST | Upload files (multipart/form-data) |
| `/api/v3/balance` | GET | Get account balance (returns `{ data: { balance: number } }`) |

### History API

The predictions history endpoint requires a POST request with JSON body:
```json
{
  "page": 1,
  "page_size": 20,
  "created_after": "2025-12-01T00:00:00Z",
  "created_before": "2025-12-02T23:59:59Z"
}
```

## Development Commands

```bash
npm run dev          # Start dev server with hot reload (Electron + Vite)
npx vite             # Start web-only dev server (no Electron, browser only)
npm run build        # Build the app
npm run build:win    # Build for Windows
npm run build:mac    # Build for macOS
npm run build:linux  # Build for Linux
npm run build:all    # Build for all platforms
```

## Common Tasks

### Adding a new page
1. Create component in `src/pages/`
2. Add route in `src/App.tsx`
3. Add navigation item in `src/components/layout/Sidebar.tsx`

### Adding a new API method
1. Add method to `WaveSpeedClient` class in `src/api/client.ts`
2. Add types in `src/types/` if needed

### Modifying the build
1. Build config is in `package.json` under `"build"` key
2. GitHub Actions in `.github/workflows/`

### Adding a new UI component (shadcn/ui pattern)
1. Create component in `src/components/ui/` following the existing pattern
2. Use `@radix-ui/*` primitives (already installed: dialog, select, dropdown-menu, etc.)
3. Use `cn()` for className merging
4. Export all sub-components

## Code Style

- Use TypeScript strict mode
- Use shadcn/ui components from `@/components/ui/`
- Use `cn()` utility for conditional classNames
- Store state in Zustand stores, not in components
- API client timeout is 60 seconds

## Testing API Key

For development, a test API key is available in the plan file.

## Schema to Form Mapping

The app converts API schema properties to form fields using `src/lib/schemaToForm.ts`:

- `x-ui-component: "loras"` → LoRA selector (supports `loras`, `high_noise_loras`, `low_noise_loras`)
- `x-ui-component: "slider"` → Slider with number input
- `x-ui-component: "uploader"` → File upload
- `x-ui-component: "select"` → Dropdown select
- `type: "string"` with `enum` → Dropdown select
- `type: "boolean"` → Toggle switch
- Field names like `image`, `video`, `audio` → File upload (detected by pattern)
- Field names `mask_image`, `mask_image_url`, `mask_images`, `mask_image_urls` → File upload with mask editor button

## Important Notes

- The app stores the API key securely using electron-store (with localStorage fallback for browser dev mode)
- History is limited to last 24 hours with 20 items per page
- File uploads return a URL that's used as the input parameter
- Model schemas use OpenAPI format with `x-order-properties` for field ordering
- macOS builds are signed with Developer ID certificate for Gatekeeper compatibility
- LoRA fields are detected by `x-ui-component: "loras"` or field name matching `loras`
- Models are sorted by `sort_order` (popularity) by default, with higher values appearing first
- Documentation URLs follow the pattern: `https://wavespeed.ai/docs/docs-api/{owner}/{model-name}` where slashes after the owner become dashes
- The playground supports multiple tabs, each with its own model and form state
- IPC handlers in `electron/main.ts` include: `get-api-key`, `set-api-key`, `download-file`, `open-external`, plus asset-related handlers (`save-asset`, `delete-asset`, `get-assets-metadata`, `save-assets-metadata`, `open-file-location`, `select-directory`)
- Templates are stored in localStorage with key `wavespeed_templates`, grouped by model
- Theme preference is stored in localStorage with key `wavespeed_theme` (auto/dark/light)
- Theme "auto" follows system preference and listens for system theme changes
- Templates can be loaded in playground via URL query param: `/playground/{modelId}?template={templateId}`
- Auto-update uses electron-updater with support for stable and nightly channels
- Update settings stored in electron-store: `updateChannel` (stable/nightly) and `autoCheckUpdate` (boolean)
- IPC handlers for updates: `check-for-updates`, `download-update`, `install-update`, `set-update-channel`
- Media capture components (CameraCapture, VideoRecorder, AudioRecorder) use MediaDevices API with proper cleanup
- Media streams must be stopped on component unmount using mounted flag pattern to handle async getUserMedia
- VideoRecorder shows real-time audio waveform visualization using Web Audio API AnalyserNode
- Clicking on uploaded media thumbnails opens a preview dialog (image/video/audio)
- i18n uses react-i18next with 18 language locales stored in `src/i18n/locales/`
- Supported languages: en, zh-CN, zh-TW, ja, ko, es, fr, de, ru, it, pt, tr, hi, id, ms, ar, vi, th
- Language preference is stored in localStorage with key `i18next` and auto-detected from browser
- Assets are auto-saved by default to `Documents/WaveSpeed/` with subdirectories for images, videos, audio, and text
- Asset metadata is stored in `{userData}/assets-metadata.json` with tags, favorites, and file references
- Asset file naming format: `{model-slug}_{predictionId}_{resultindex}.{ext}` (e.g., `flux-schnell_pred-abc123_0.png`)
- Layout.tsx handles unified API key login screen - pages don't need individual ApiKeyRequired checks
- Settings page (`/settings`) is a public path accessible without API key
- Free Tools pages are public paths accessible without API key: `/free-tools`, `/free-tools/image-enhancer`, `/free-tools/video-enhancer`, `/free-tools/background-remover`, `/free-tools/face-enhancer`, `/free-tools/face-swapper`, `/free-tools/image-eraser`, `/free-tools/segment-anything`, `/free-tools/video-converter`, `/free-tools/audio-converter`, `/free-tools/image-converter`, `/free-tools/media-trimmer`, `/free-tools/media-merger`
- Free Tools feature uses UpscalerJS with ESRGAN models for image/video upscaling (slim/medium/thick quality options)
- Video Enhancer processes frames at 30 FPS using WebM muxer with VP9 codec
- Upscaler uses Web Worker to keep UI responsive during heavy processing
- Background Remover uses @imgly/background-removal library with Web Worker for AI-based background removal
- Background Remover displays all 3 outputs simultaneously: foreground (transparent background), background (subject removed), and mask (grayscale segmentation)
- Background Remover processes all outputs in a single batch via `removeBackgroundAll` (model cached after first call)
- Background Remover auto-detects GPU (WebGPU) support and falls back to CPU
- Image Eraser uses LaMa inpainting model (512x512 input, quantized) via onnxruntime-web with WebGPU acceleration (falls back to WASM) for object removal
- Image Eraser model is cached in browser Cache API after first download from Hugging Face (opencv/inpainting_lama repo)
- Image Eraser uses smart crop (3x mask size, min 512x512) around masked area for better quality on large images
- Image Eraser uses inline mask drawing (brush/eraser tools) with undo/redo support and feathered edge blending
- Face Enhancer uses YOLO v8 nano-face (~12MB) for face detection and GFPGAN v1.4 (~340MB) for face restoration
- Face Enhancer uses onnxruntime-web with WebGPU acceleration (falls back to WASM)
- Face Enhancer crops faces with 1.3x padding, enhances at 512x512, then blends back with Gaussian feathered edges
- Face Enhancer models are cached in browser Cache API after first download from Hugging Face
- Free Tools pages support click-to-preview for both original and processed images via fullscreen dialog
- Multi-phase progress system uses weighted phases to calculate overall progress (e.g., download: 30%, process: 70%)
- ProcessingProgress component displays compact single-row UI: [phase dots] [spinner + label] [progress bar] [ETA] [%]
- Progress phases are configured per-tool: BackgroundRemover (2 phases), ImageEnhancer (3 phases), VideoEnhancer (4 phases), FaceEnhancer (3 phases: download, detect, enhance)
- Worker messages use standardized format: `{ type: 'phase' | 'progress', payload: { phase, progress, detail? } }`
- MaskEditor component provides brush (draw), eraser, and bucket fill (flood fill) tools
- Mask fields are detected by checking if field name is one of: "mask_image", "mask_image_url", "mask_images", "mask_image_urls"
- MaskEditor uses two-canvas architecture: background canvas for reference image, mask canvas for drawing at 70% opacity
- MaskEditor supports undo/redo (Ctrl+Z, Ctrl+Shift+Z) with up to 50 history states
- MaskEditor auto-detects reference images/videos from form values (fields ending with `_image`, `image_url`, `_video`, `video_url`)
- Free Tools pages use persistent rendering (lazy-mounted after first visit) to preserve state during navigation
- Segment Anything uses SlimSAM model (Xenova/slimsam-77-uniform) via @huggingface/transformers with WebGPU acceleration (falls back to WASM)
- Segment Anything uses two-step process: (1) segmentImage extracts embeddings once, (2) decodeMask generates masks from point prompts instantly
- Segment Anything supports positive (include) and negative (exclude) point prompts, right-click for negative points
- Segment Anything model is downloaded and cached by @huggingface/transformers on first use
- Settings page displays account balance when authenticated, fetched via `apiClient.getBalance()` with refresh button
- Balance is displayed in USD format ($X.XX) and auto-fetches when API key is validated
- Batch processing allows running the same prediction 2-16 times with auto-randomized seeds for variations
- Batch config is stored per-tab in playgroundStore: `batchConfig`, `batchState`, `batchResults`
- Batch mode uses a slider UI in a dropdown menu attached to the Run button
- When batch is enabled, Run button shows count (e.g., "Run (4)") and price is multiplied by repeat count
- Batch results are displayed in a grid with thumbnails, click to expand full output
- Batch outputs can be bulk downloaded or saved to assets via "Download All" / "Save All" buttons
- Seed randomization generates unique seeds per batch item using base seed + index to ensure reproducibility
- Segment Anything worker forces onnxruntime-web 1.21.0 WASM from CDN to avoid version mismatch with @huggingface/transformers bundled WASM
- FFmpeg WASM tools use @ffmpeg/ffmpeg 0.12.x with ESM build loaded from jsdelivr CDN
- FFmpeg worker supports convert, merge, trim, and getInfo operations with progress reporting
- FFmpeg tools pages: VideoConverterPage, AudioConverterPage, ImageConverterPage, MediaTrimmerPage, MediaMergerPage
- FFmpeg tools are public paths accessible without API key: `/free-tools/video-converter`, `/free-tools/audio-converter`, `/free-tools/image-converter`, `/free-tools/media-trimmer`, `/free-tools/media-merger`
- FFmpeg format definitions in `src/lib/ffmpegFormats.ts` include VIDEO_FORMATS, AUDIO_FORMATS, IMAGE_FORMATS with codec mappings
- @ffmpeg/ffmpeg and @ffmpeg/util are excluded from Vite's optimizeDeps to avoid bundling issues
- Face Swapper uses InsightFace models: SCRFD det_10g (~17MB) for detection, ArcFace w600k (~174MB) for embedding, Inswapper 128 (~554MB full precision) for swapping
- Face Swapper uses corner-aligned anchors (not center-aligned) for SCRFD detection to ensure accurate bounding boxes
- Face Swapper supports multi-face swapping: select target face, upload source, swap, repeat for other faces
- Face Swapper tracks swap history per face allowing individual revert to original
- Face Swapper uses Umeyama similarity transform with SVD for robust face alignment
- Face Swapper applies EMAP matrix transformation to ArcFace embeddings before Inswapper
- Face Swapper optional GFPGAN enhancement runs after swap for improved face quality
- Face Swapper uses 10% padding for face cropping (configurable in worker)
- Face Swapper models are cached in browser Cache API after first download from Hugging Face
- OutputDisplay limits image/video upscaling to 2x natural size to prevent pixelation on small outputs
