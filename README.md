# WaveSpeed

Open-source, cross-platform application for running 600+ AI models — image generation, video generation, face swap, digital human, motion control, and more. Features a visual workflow editor for building AI pipelines, Featured Models with smart variant switching, and 12 free creative tools. Available for **Windows**, **macOS**, **Linux**, and **Android**.

[![GitHub Release](https://img.shields.io/github/v/release/WaveSpeedAI/wavespeed-desktop?style=flat-square&label=Latest)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest)
[![License](https://img.shields.io/github/license/WaveSpeedAI/wavespeed-desktop?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WaveSpeedAI/wavespeed-desktop?style=flat-square)](https://github.com/WaveSpeedAI/wavespeed-desktop/stargazers)

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0wIDMuNWw5LjktMS40djkuNUgwem0xMS4xLTEuNUwyNCAwdjExLjVIMTEuMXpNMCAxMi42aDkuOXY5LjVMMCAyMC43em0xMS4xLS4xSDI0VjI0bC0xMi45LTEuOHoiLz48L3N2Zz4=&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-win-x64.exe)
[![macOS Intel](https://img.shields.io/badge/macOS_Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-x64.dmg)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-arm64.dmg)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-linux-x86_64.AppImage)
[![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Mobile.apk)

![Playground Screenshot](https://github.com/user-attachments/assets/054a45d8-9bbc-4f1b-8cc1-b6fa4b3b2aac)

## Android App

The Android app shares the same React codebase as the desktop version, giving you access to the AI Playground, Featured Models, Creative Studio, and all 600+ models from your phone.

- Full AI Playground with multi-tab support and all input types including camera capture
- Featured Models with smart variant switching
- Model browser with search, filter, and sort
- Creative Studio tools (face enhancement, background removal, image eraser, segment anything, media conversion)
- History, My Assets, templates, and auto-save
- 18 languages, dark/light theme, Android 5.0+

<p>
  <img src="https://github.com/user-attachments/assets/dafa6699-35ed-4da2-b6eb-4da818e2c846" alt="WaveSpeed Android - Free Tools" width="300" />
  <img src="https://github.com/user-attachments/assets/d392a9d0-2a44-480b-9195-d23a850a1946" alt="WaveSpeed Android - Playground" width="300" />
</p>

## [Creative Studio](https://wavespeed.ai/studio)

12 free AI-powered creative tools that run entirely in your browser. No API key required, no usage limits, completely free. Also available as a standalone web app at [wavespeed.ai/studio](https://wavespeed.ai/studio) — fully responsive, works on desktop, tablet, and mobile browsers.

| Tool                   | Description                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| **Image Enhancer**     | Upscale images 2x–4x using ESRGAN with slim, medium, and thick quality options                    |
| **Video Enhancer**     | Frame-by-frame video upscaling with real-time progress and ETA                                    |
| **Face Enhancer**      | Detect faces with YOLO v8 and enhance with GFPGAN v1.4 (WebGPU accelerated)                       |
| **Face Swapper**       | Swap faces using InsightFace (SCRFD + ArcFace + Inswapper) with optional GFPGAN post-processing   |
| **Background Remover** | Remove backgrounds instantly — outputs foreground, background, and mask with individual downloads |
| **Image Eraser**       | Remove unwanted objects with LaMa inpainting, smart crop and blend (WebGPU accelerated)           |
| **Segment Anything**   | Interactive object segmentation with point prompts using SlimSAM                                  |
| **Video Converter**    | Convert between MP4, WebM, AVI, MOV, MKV with codec and quality options                           |
| **Audio Converter**    | Convert between MP3, WAV, AAC, FLAC, OGG with bitrate control                                     |
| **Image Converter**    | Batch convert between JPG, PNG, WebP, GIF, BMP with quality settings                              |
| **Media Trimmer**      | Trim video and audio by selecting start and end times                                             |
| **Media Merger**       | Merge multiple video or audio files into one                                                      |

![WaveSpeed Creative Studio](https://github.com/user-attachments/assets/2265a42b-4686-4eb4-87b5-5f70e8a99852)

## Visual Workflow Editor

Node-based pipeline builder for designing and executing complex AI workflows. Chain any combination of AI models, free tools, and media processing steps into automated pipelines.

![WaveSpeed Visual Workflow Editor](https://github.com/user-attachments/assets/31f6889a-aeff-41a9-ab15-c16f7c828712)

## Features

- **AI Playground**: Multi-tab playground with dynamic forms, batch processing (2-16x), mask drawing, LoRA support, abort control, and auto-randomized seeds
- **Featured Models**: Curated model families with smart variant switching — auto-selects the best variant based on inputs and toggles (Seedream 4.5, Seedance 1.5 Pro, Wan Spicy, InfiniteTalk, Kling 2.6, Nano Banana Pro, etc.)
- **Model Browser**: Fuzzy search, sort by popularity/name/price/type, favorites filter
- **Visual Workflow Editor**: Node-based pipeline builder with 20+ node types
  - Triggers (directory scan, HTTP API), AI tasks, 12 free tool nodes, processing (concat, select), group/subgraph, I/O nodes
  - Run all / run node / continue / retry / cancel / batch runs (1-99x), real-time execution monitor with cost tracking
  - Group/subgraph containers with exposed I/O, breadcrumb navigation, and workflow import
  - HTTP API mode: expose workflows as REST endpoints via built-in HTTP server — works as a skill server for [OpenClaw](https://github.com/anthropics/openclaw) and other AI agents
  - Directory batch processing: auto-execute per media file in a folder
  - Prompt optimizer, guided tour, result caching, circuit breaker, cycle detection
  - Cost estimation & daily budget, import/export (JSON + SQLite), multi-tab, undo/redo, customizable output naming
- **Free Tools**: 12 AI-powered creative tools (no API key) — see [Creative Studio](#creative-studio) above
- **Z-Image**: Local image generation via stable-diffusion.cpp with model downloads, progress, and logs
- **Templates**: Playground + workflow templates with presets, i18n search, import/export, and usage tracking
- **History & Assets**: Recent predictions (24h), saved outputs with tags/favorites/search, auto-save to local folder
- **Media Input**: File upload (drag & drop), camera capture, video/audio recording
- **18 languages**, dark/light/auto theme, auto updates (stable + nightly), cross-platform (Windows, macOS, Linux, Android)
- **Cross-Platform**: Available for Windows, macOS, Linux, and Android

## Installation

### Quick Download

#### Desktop

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0wIDMuNWw5LjktMS40djkuNUgwem0xMS4xLTEuNUwyNCAwdjExLjVIMTEuMXpNMCAxMi42aDkuOXY5LjVMMCAyMC43em0xMS4xLS4xSDI0VjI0bC0xMi45LTEuOHoiLz48L3N2Zz4=&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-win-x64.exe)
[![macOS Intel](https://img.shields.io/badge/macOS_Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-x64.dmg)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-arm64.dmg)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-linux-x86_64.AppImage)

#### Mobile

[![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Mobile.apk)

Or browse all releases on the [Releases](https://github.com/WaveSpeedAI/wavespeed-desktop/releases) page.

### Platform Instructions

<details>
<summary><b>Windows</b></summary>

1. Download `.exe` (installer) or `.zip` (portable)
2. Run the installer and follow the prompts, or extract the zip file
3. Launch "WaveSpeed Desktop" from Start Menu or the extracted folder
</details>

<details>
<summary><b>macOS</b></summary>

1. Download `.dmg` for your chip (Apple Silicon or Intel)
2. Open the `.dmg` file and drag the app to Applications
3. Launch the app from Applications
</details>

<details>
<summary><b>Linux</b></summary>

1. Download `.AppImage` or `.deb`
2. For AppImage: Make it executable (`chmod +x *.AppImage`) and run it
3. For .deb: Install with `sudo dpkg -i *.deb`
</details>

<details>
<summary><b>Android</b></summary>

1. Download the `.apk` file
2. Open the file on your Android device
3. If prompted about "Unknown sources", allow installation from this source
4. Install and launch the app
5. Requires Android 5.0 (API 21) or higher
</details>

### Nightly Builds

[![Nightly](https://img.shields.io/badge/Nightly-FF6B6B?style=for-the-badge&logo=github&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/tag/nightly)

> **Note:** Nightly builds may be unstable. Use the stable releases for production use.

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/WaveSpeedAI/wavespeed-desktop.git
cd wavespeed-desktop

# Install dependencies
npm install

# Install pre-commit hooks (requires pre-commit: pip install pre-commit)
pre-commit install

# Start development server
npm run dev
```

### Scripts

| Script                 | Description                                |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start development server with hot reload   |
| `npm run dev:web`      | Start web-only dev server (no Electron)    |
| `npm run build`        | Build the application                      |
| `npm run build:web`    | Build web-only version (no Electron)       |
| `npm run build:win`    | Build for Windows                          |
| `npm run build:mac`    | Build for macOS                            |
| `npm run build:linux`  | Build for Linux                            |
| `npm run build:all`    | Build for all platforms                    |
| `npm run dist`         | Build and package for distribution         |
| `npm run format`       | Format code with Prettier                  |
| `npm run format:check` | Check code formatting                      |

### Mobile Development

The mobile app is located in the `mobile/` directory and shares code with the desktop app.

```bash
# Navigate to mobile directory
cd mobile

# Install dependencies
npm install

# Start development server
npm run dev

# Build and sync to Android
npm run build && npx cap sync android

# Open in Android Studio
npx cap open android
```

See [mobile/README.md](mobile/README.md) for detailed mobile development guide.

### Project Structure

```
wavespeed-desktop/
├── data/templates/         # Preset workflow templates (AI generation, image/video/audio processing)
├── electron/               # Electron main process
│   ├── main.ts             # Main process entry
│   ├── preload.ts          # Preload script (IPC bridge)
│   ├── lib/                # Local generation (sdGenerator for stable-diffusion.cpp)
│   └── workflow/           # Workflow backend
│       ├── db/             # SQLite database (workflow, node, edge, execution, budget, template repos)
│       ├── engine/         # Execution engine (DAG runner, scheduler, cache, circuit breaker)
│       ├── ipc/            # IPC handlers (workflow, execution, history, cost, storage, http-server)
│       ├── nodes/          # Node handlers (AI task, free tools, I/O, triggers, processing, control)
│       ├── services/       # HTTP server, model list, retry, service locator, template loader
│       └── utils/          # File storage, hashing, save-to-assets
├── src/
│   ├── api/                # API client
│   ├── components/         # React components
│   │   ├── ffmpeg/         # FFmpeg components
│   │   ├── layout/         # Layout components
│   │   ├── playground/     # Playground components
│   │   ├── shared/         # Shared components
│   │   ├── templates/      # Template components
│   │   └── ui/             # shadcn/ui components
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Internationalization (18 languages)
│   ├── lib/                # Utilities (fuzzy search, schema-to-form, smart form config, etc.)
│   ├── pages/              # Page components
│   ├── stores/             # Zustand stores
│   ├── types/              # TypeScript types
│   ├── workers/            # Web Workers (upscaler, face enhancer/swapper, background remover, image eraser, segmentation, ffmpeg)
│   └── workflow/           # Workflow frontend
│       ├── browser/        # Browser-only workflow API (web mode without Electron)
│       ├── components/     # Canvas, node palette, config panel, results panel, run monitor, prompt optimizer
│       ├── hooks/          # Workflow-specific hooks (undo/redo, group adoption, free tool listener)
│       ├── ipc/            # Type-safe IPC client
│       ├── lib/            # Cycle detection, free tool runner, model converter, topological sort
│       ├── stores/         # Workflow, execution, UI stores (Zustand)
│       └── types/          # Workflow type definitions
├── mobile/                 # Mobile app (Android)
│   ├── src/                # Mobile-specific overrides
│   ├── android/            # Android native project
│   └── capacitor.config.ts
├── .github/workflows/      # GitHub Actions (desktop + mobile)
└── build/                  # Build resources
```

## Tech Stack

### Desktop

- **Framework**: Electron + electron-vite
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Workflow Canvas**: React Flow
- **Workflow Database**: sql.js (SQLite in-process)
- **AI/ML (Free Tools)**: @huggingface/transformers, onnxruntime-web, @tensorflow/tfjs, upscaler (ESRGAN)
- **Media Processing**: @ffmpeg/core, mp4-muxer, webm-muxer
- **3D Preview**: @google/model-viewer
- **Local Generation**: stable-diffusion.cpp (via sdGenerator)

### Mobile

- **Framework**: Capacitor 6
- **Frontend**: React 18 + TypeScript (shared with desktop)
- **Styling**: Tailwind CSS + shadcn/ui (shared)
- **Platform**: Android 5.0+

## Configuration

1. Launch the application
2. Go to **Settings**
3. Enter your WaveSpeedAI API key
4. Start using the Playground!

Get your API key from [WaveSpeedAI](https://wavespeed.ai)

## API Reference

The application uses the WaveSpeedAI API v3:

| Endpoint                          | Method | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `/api/v3/models`                  | GET    | List available models                |
| `/api/v3/{model}`                 | POST   | Run a prediction                     |
| `/api/v3/predictions/{id}/result` | GET    | Get prediction result                |
| `/api/v3/predictions`             | POST   | Get prediction history               |
| `/api/v3/media/upload/binary`     | POST   | Upload files                         |
| `/api/v3/balance`                 | GET    | Get account balance                  |

The built-in workflow HTTP server also exposes:

| Endpoint                          | Method | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `/api/health`                     | GET    | Health check                         |
| `/api/workflows/{id}/run`         | POST   | Trigger a workflow execution via API |
| `/api/workflows/{id}/schema`      | GET    | Get workflow input/output schema     |
| `/schema`                         | GET    | Get active workflow schema           |
| `POST /` (any path)              | POST   | Run the active workflow              |

Add an HTTP Trigger node to your workflow to define the API input schema (each field becomes an output port), and optionally add an HTTP Response node to customize the response. Start the server from the workflow canvas — it listens on a configurable port (default `3100`) with CORS enabled.

This turns any workflow into a callable REST endpoint, making it easy to integrate with [OpenClaw](https://github.com/anthropics/openclaw) or other AI agent frameworks as a skill server. For example, an OpenClaw agent can call `GET /api/workflows/{id}/schema` to discover the workflow's input/output contract, then `POST /api/workflows/{id}/run` with the required fields to execute the pipeline and receive results.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [WaveSpeed Website](https://wavespeed.ai)
- [API Documentation](https://wavespeed.ai/docs)
- [GitHub Repository](https://github.com/WaveSpeedAI/wavespeed-desktop)
