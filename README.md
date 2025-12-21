# WaveSpeed Desktop

A cross-platform desktop application for running AI models from [WaveSpeedAI](https://wavespeed.ai).

![Playground Screenshot](https://github.com/user-attachments/assets/904a3ff8-c302-4b84-851b-34a76486c891)
![Z-Image Screenshot](https://github.com/user-attachments/assets/f2eabfb1-a613-4b01-9f84-a5ae5fd07638)

## Features

- **Model Browser**: Browse and search available AI models with fuzzy search, sortable by popularity, name, price, or type
- **Favorites**: Star your favorite models for quick access with a dedicated filter
- **Multi-Tab Playground**: Run predictions with multiple models simultaneously in separate tabs
- **Batch Processing**: Run the same prediction multiple times (2-16) with auto-randomized seeds for variations
- **Dynamic Forms**: Auto-generated forms from model schemas with validation
- **Mask Drawing**: Interactive canvas-based mask editor for models that accept mask inputs, with brush, eraser, and bucket fill tools
- **Templates**: Save and reuse playground configurations as templates for quick access
- **LoRA Support**: Full support for LoRAs including high-noise and low-noise LoRAs for Wan 2.2 models
- **Free Tools**: Free AI-powered image and video tools (no API key required)
  - **Image Enhancer**: Upscale images 2x-4x with ESRGAN models (slim, medium, thick quality options)
  - **Video Enhancer**: Frame-by-frame video upscaling with real-time progress and ETA
  - **Face Enhancer**: Enhance and restore face quality using YOLO v8 for detection and GFPGAN v1.4 for enhancement (WebGPU accelerated)
  - **Face Swapper**: Swap faces between images using InsightFace models (SCRFD detection, ArcFace embedding, Inswapper) with optional GFPGAN enhancement
  - **Background Remover**: Remove image backgrounds instantly using AI, displaying foreground, background, and mask outputs simultaneously with individual download buttons
  - **Image Eraser**: Remove unwanted objects from images using LaMa inpainting model with smart crop and blend (WebGPU accelerated)
  - **Segment Anything**: Interactive object segmentation with point prompts using SlimSAM model
  - **Video Converter**: Convert videos between formats (MP4, WebM, AVI, MOV, MKV) with codec and quality options
  - **Audio Converter**: Convert audio between formats (MP3, WAV, AAC, FLAC, OGG) with bitrate control
  - **Image Converter**: Batch convert images between formats (JPG, PNG, WebP, GIF, BMP) with quality settings
  - **Media Trimmer**: Trim video/audio files by selecting start and end times
  - **Media Merger**: Merge multiple video/audio files into one
- **Z-Image (Local)**: Run local image generation via stable-diffusion.cpp with model/aux downloads, progress, and logs
- **Multi-Phase Progress**: Compact progress bars with phase indicators, real-time status, and ETA for all Free Tools
- **History**: View your recent predictions (last 24 hours) with detailed view, download, and copy prediction ID
- **My Assets**: Save, browse, and manage generated outputs (images, videos, audio) with tags, favorites, and search
- **Auto-Save**: Automatically save generated outputs to your local assets folder (enabled by default)
- **File Upload**: Support for image, video, and audio file inputs with drag & drop
- **Media Capture**: Built-in camera capture, video recording with audio waveform, and audio recording
- **View Documentation**: Quick access to model documentation from the playground
- **Account Balance**: View your current WaveSpeed account balance in Settings with one-click refresh
- **Theme Support**: Auto (system), dark, and light theme options
- **Multi-Language**: Support for 18 languages including English, Chinese, Japanese, Korean, and more
- **Auto Updates**: Automatic update checking with stable and nightly channels
- **Cross-Platform**: Available for Windows, macOS, and Linux

## Installation

### Quick Download

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-win-x64.exe)
[![macOS Intel](https://img.shields.io/badge/macOS_Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-x64.dmg)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-mac-arm64.dmg)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/latest/download/WaveSpeed-Desktop-linux-x86_64.AppImage)

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

# Start development server
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npx vite` | Start web-only dev server (no Electron) |
| `npm run build` | Build the application |
| `npm run build:win` | Build for Windows |
| `npm run build:mac` | Build for macOS |
| `npm run build:linux` | Build for Linux |
| `npm run build:all` | Build for all platforms |

### Project Structure

```
wavespeed-desktop/
├── electron/           # Electron main process
│   ├── main.ts         # Main process entry
│   └── preload.ts      # Preload script (IPC bridge)
├── src/
│   ├── api/            # API client
│   ├── components/     # React components
│   │   ├── layout/     # Layout components
│   │   ├── playground/ # Playground components
│   │   ├── shared/     # Shared components
│   │   └── ui/         # shadcn/ui components
│   ├── hooks/          # Custom React hooks
│   ├── i18n/           # Internationalization (18 languages)
│   ├── lib/            # Utility functions
│   ├── pages/          # Page components
│   ├── stores/         # Zustand stores
│   ├── types/          # TypeScript types
│   └── workers/        # Web Workers (upscaler, background remover, image eraser, ffmpeg)
├── .github/workflows/  # GitHub Actions
└── build/              # Build resources
```

## Tech Stack

- **Framework**: Electron + electron-vite
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **HTTP Client**: Axios

## Configuration

1. Launch the application
2. Go to **Settings**
3. Enter your WaveSpeedAI API key
4. Start using the Playground!

Get your API key from [WaveSpeedAI](https://wavespeed.ai)

## API Reference

The application uses the WaveSpeedAI API v3:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v3/models` | GET | List available models |
| `/api/v3/{model}` | POST | Run a prediction |
| `/api/v3/predictions/{id}/result` | GET | Get prediction result |
| `/api/v3/predictions` | POST | Get prediction history |
| `/api/v3/media/upload/binary` | POST | Upload files |
| `/api/v3/balance` | GET | Get account balance |

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
