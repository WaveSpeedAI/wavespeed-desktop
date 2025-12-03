# WaveSpeed Desktop

A cross-platform desktop application for running AI models from [WaveSpeedAI](https://wavespeed.ai).

## Features

- **Model Browser**: Browse and search available AI models with fuzzy search, sortable by popularity, name, price, or type
- **Multi-Tab Playground**: Run predictions with multiple models simultaneously in separate tabs
- **Dynamic Forms**: Auto-generated forms from model schemas with validation
- **Templates**: Save and reuse playground configurations as templates for quick access
- **LoRA Support**: Full support for LoRAs including high-noise and low-noise LoRAs for Wan 2.2 models
- **History**: View your recent predictions (last 24 hours) with detailed view, download, and copy prediction ID
- **File Upload**: Support for image, video, and audio file inputs with drag & drop
- **View Documentation**: Quick access to model documentation from the playground
- **Theme Support**: Auto (system), dark, and light theme options
- **Cross-Platform**: Available for Windows, macOS, and Linux

## Installation

### Download

Download the latest release for your platform from the [Releases](https://github.com/WaveSpeedAI/wavespeed-desktop/releases) page.

#### Windows
1. Download `WaveSpeed Desktop-*-win-x64.exe` (installer) or `.zip` (portable)
2. Run the installer and follow the prompts, or extract the zip file
3. Launch "WaveSpeed Desktop" from Start Menu or the extracted folder

#### macOS
1. Download `WaveSpeed Desktop-*-mac-arm64.dmg` (Apple Silicon) or `WaveSpeed Desktop-*-mac-x64.dmg` (Intel)
2. Open the `.dmg` file and drag the app to Applications
3. Since the app is not signed, run this command to bypass Gatekeeper:
   ```bash
   xattr -cr "/Applications/WaveSpeed Desktop.app"
   ```
4. Launch the app from Applications

#### Linux
1. Download `WaveSpeed Desktop-*-linux-x64.AppImage` or `.deb`
2. For AppImage: Make it executable (`chmod +x *.AppImage`) and run it
3. For .deb: Install with `sudo dpkg -i *.deb`

### Nightly Builds

Automated nightly builds are available for testing the latest features:
[Nightly Release](https://github.com/WaveSpeedAI/wavespeed-desktop/releases/tag/nightly)

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
│   ├── lib/            # Utility functions
│   ├── pages/          # Page components
│   ├── stores/         # Zustand stores
│   └── types/          # TypeScript types
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
