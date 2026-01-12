# WaveSpeed Mobile

WaveSpeed Mobile is the official Android client for [WaveSpeed AI](https://wavespeed.ai), built with React + Capacitor. It shares ~70% of code with the desktop app while being deeply optimized for mobile experience.

[![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/WaveSpeedAI/wavespeed-desktop/releases?q=mobile&expanded=true)

## Version Info

- **Current Version**: 0.8.2
- **Package Name**: `ai.wavespeed.mobile`
- **Minimum Support**: Android 5.0 (API 21)

## Responsive & Adaptive Design

WaveSpeed Mobile is designed with a **mobile-first, responsive approach**:

- **Adaptive Layouts**: UI automatically adjusts for different screen sizes (phones to tablets)
- **Touch-Optimized**: Large touch targets, swipe gestures, and haptic feedback
- **Flexible Grids**: History and model browser use responsive grid layouts (2-5 columns based on screen width)
- **Dynamic Typography**: Font sizes scale appropriately for readability
- **Orientation Support**: Works seamlessly in portrait and landscape modes
- **Safe Area Handling**: Proper insets for notches, rounded corners, and navigation bars

## Features

### Core Features

#### 1. Model Browser (Models)
- Browse all available WaveSpeed AI models
- Search and filter support
- Tap a model to use it in Playground

#### 2. AI Workshop (Playground)
- **Input/Output Dual View**: Mobile-specific tab switching design for better screen utilization
- **Dynamic Forms**: Auto-generated parameter forms based on model schema
- **Supported Input Types**:
  - Text input (with AI prompt optimization)
  - Slider adjustment
  - Dropdown selection
  - Toggle switches
  - File upload (image/video/audio)
  - LoRA selector
  - Size selector
  - Mask editor
- **Real-time Pricing**: Display estimated cost
- **Auto Switch**: Automatically switch to output view when generation completes

#### 3. Template Management (Templates)
- Save frequently used parameter configurations as templates
- Support template renaming
- Batch export/import templates (JSON format)
- Browse by model groups
- One-tap apply template to Playground

#### 4. History
- Grid view for historical generation records
- Status filter: All, Completed, Failed, Archived
- Long-press to enter batch selection mode
- Batch delete and batch download
- Thumbnail preview (image/video/audio/JSON/text)
- View detailed information
- Save as template feature
- Local input parameter cache (records with bookmark icon can be saved as templates)

#### 5. Settings
- API key management
- Account balance inquiry
- Theme switching (Auto/Dark/Light)
- Language selection (18 languages supported)
- Auto-save settings

### Free Tools

Local AI tools that work without API key:

#### 1. Video Enhancer
- Frame-by-frame AI super-resolution upscaling
- Support 2x-4x upscaling
- Three quality options (Fast/Balanced/High Quality)
- Real-time progress and ETA
- Output WebM format (30 FPS)

#### 2. Image Enhancer
- AI image super-resolution
- Support 2x-4x upscaling
- ESRGAN models (slim/medium/thick)
- Download PNG/WebP format

#### 3. Background Remover
- AI automatic background removal
- Three simultaneous outputs:
  - Foreground (transparent background)
  - Background (subject removed)
  - Mask (grayscale segmentation)
- Auto GPU acceleration detection

#### 4. Image Eraser
- Paint to remove objects from images
- LaMa inpainting model
- Brush/Eraser/Fill tools
- Undo/Redo support
- Smart crop for large image optimization

#### 5. Segment Anything
- Tap to select objects to segment
- Long-press to mark exclusion areas
- Real-time segmentation preview
- Feathered edge processing
- Multiple download formats

#### 6. Video Converter
- Video format conversion
- Support WebM (VP8/VP9/AV1) and MP4 (H.264)
- Auto codec detection
- Progress display

## Usage Guide

### Installation

1. Download the APK file
2. Open the file on your phone
3. If prompted about "Unknown sources", allow installation
4. Install and launch the app

### First Time Use

1. **Get API Key**
   - Visit [WaveSpeed AI](https://wavespeed.ai) to register
   - Get your API key from the user center

2. **Login**
   - Open the app and enter your API key on the login page
   - Tap "Verify" button
   - After verification, you'll enter the main interface

3. **Using Playground**
   - Select a model on the Models page
   - Configure parameters in the input view
   - Tap "Run" to start generation
   - Automatically switches to output view when complete

### Using Templates

1. **Save Template**
   - Configure parameters in Playground
   - Tap "Save as Template" button
   - Enter template name and save

2. **Use Template**
   - Go to Templates page
   - Tap the template you want to use
   - Automatically jumps to Playground with parameters loaded

3. **Export/Import**
   - Tap the export button at the top of the page
   - Choose to export single or all templates
   - When importing, choose merge or replace

### Using Free Tools

1. Tap the tools icon at the top right of the main screen
2. Select the tool you need
3. Upload or select a file
4. Wait for processing to complete
5. Download or save the result

## Notes

### Performance

1. **First-time AI Tool Use is Slower**
   - Free tools need to download models on first use
   - Models are cached locally for faster subsequent use
   - Recommend using Wi-Fi for first-time use

2. **Memory Usage**
   - AI tools have high memory usage when running
   - Recommend closing other apps for smooth operation
   - Processing large files may take more time

3. **GPU Acceleration**
   - Some tools support WebGPU acceleration
   - Automatically falls back to CPU when not supported
   - CPU mode processing is slower

### Network

1. **API Calls Require Network**
   - Playground generation requires stable network connection
   - Recommend using Wi-Fi
   - Large file uploads may take longer

2. **Free Tools Work Offline**
   - Can be used offline after model download
   - No API key or network required

### Data Storage

1. **Local Storage**
   - Templates are saved locally
   - History input parameters are cached locally
   - Clearing app data will lose this information

2. **Auto Archive**
   - Local records older than 7 days are auto-archived
   - Archived records can be filtered in History page
   - Maximum 10,000 records retained

### Known Limitations

1. **Video Processing**
   - Video enhancement takes longer
   - Recommend processing short videos (< 30 seconds)
   - Output fixed at 30 FPS

2. **Image Size**
   - Some tools have image size limitations
   - Oversized images are automatically scaled
   - Recommend using resolutions below 4K

## Differences from Desktop

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Runtime Framework | Electron | Capacitor (Android) |
| Navigation | Sidebar | Bottom Navigation |
| Playground | Multi-tab | Single page + Input/Output switch |
| Free Tools | Route switching | Persistent rendering |
| File Storage | electron-store | Capacitor Preferences |
| Drag & Drop | Full support | File picker |
| Video Converter | No | Yes (new feature) |
| Asset Management | Full page | Simplified |
| History Inputs | API only | API + Local cache |

### Mobile-Specific Features

1. **Input/Output View Switch** - Better phone screen utilization
2. **Long-press Selection Mode** - Long-press in History for batch selection
3. **Local Input Cache** - History can trace input parameters
4. **Video Converter Tool** - Format conversion support
5. **Persistent Free Tools** - Page switching doesn't lose state
6. **Batch Download** - Select multiple history records to download at once

### Desktop-Specific Features

1. **Multi-tab Playground** - Handle multiple tasks simultaneously
2. **Full Asset Management** - Manage saved generation results
3. **Drag & Drop Upload** - More convenient file operations
4. **Auto Updates** - Built-in update checking

## Development

### Tech Stack

- **Frontend Framework**: React 18 + TypeScript
- **Mobile Framework**: Capacitor 6.2
- **UI Components**: shadcn/ui + Tailwind CSS
- **State Management**: Zustand
- **Build Tool**: Vite
- **AI Inference**: ONNX Runtime, TensorFlow.js

### Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build production version
npm run build

# Sync to Android
npx cap sync android

# Open Android Studio
npx cap open android

# Build Debug APK
npm run android:build:debug

# Build Release APK
npm run android:build:release
```

### Project Structure

```
mobile/
├── src/
│   ├── components/      # Mobile-specific components
│   ├── pages/           # Mobile pages
│   ├── stores/          # Mobile state management
│   ├── platform/        # Capacitor platform service
│   └── App.tsx          # Route configuration
├── android/             # Android native project
├── capacitor.config.ts  # Capacitor config
├── vite.config.ts       # Vite config
└── package.json         # Dependencies
```

### Code Sharing

Mobile shares code with desktop via Vite path aliases:
- `@/` - Shared code (parent src/)
- `@mobile/` - Mobile-specific code

## Support & Feedback

- **Website**: [wavespeed.ai](https://wavespeed.ai)
- **Issue Tracker**: [GitHub Issues](https://github.com/WaveSpeedAI/wavespeed-desktop/issues)
- **API Docs**: [wavespeed.ai/docs](https://wavespeed.ai/docs)

## Changelog

### v0.8.2
- Add video preview thumbnails in History and Playground pages
- Improve download functionality with proper file naming
- Fix FlappyBird game text for mobile (remove Space key reference)
- Add missing translations for saveTemplate, game prompts, settings
- Fix responsive layout issues for larger screens
- Add MobileImageEraserPage component
- Switch to Output view automatically when clicking Run

### v0.8.1
- Add history delete feature (single/batch)
- Add long-press selection mode
- Add batch download feature
- Fix Slider touch interaction issue
- Optimize Batch Mode reset logic
- Remove unused history status filters

### v0.8.0
- Add video converter tool
- Add history archive feature
- Optimize Segment Anything interaction (long-press to exclude)
- Local input parameter cache
- Multiple performance optimizations and bug fixes
