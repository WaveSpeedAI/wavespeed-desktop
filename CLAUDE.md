# CLAUDE.md

This file provides guidance for Claude Code when working with this repository.

## Project Overview

WaveSpeed Desktop is an Electron-based cross-platform desktop application that provides a playground interface for [WaveSpeedAI](https://wavespeed.ai) models. It allows users to browse models, run predictions, and view their history.

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
│   │   ├── playground/   # DynamicForm, FileUpload, OutputDisplay, etc.
│   │   ├── shared/       # ApiKeyRequired and other shared components
│   │   └── ui/           # shadcn/ui components (Button, Card, etc.)
│   ├── hooks/            # Custom React hooks (useToast)
│   ├── lib/              # Utilities (cn, fuzzySearch, schemaUtils)
│   ├── pages/            # Page components (ModelsPage, PlaygroundPage, etc.)
│   ├── stores/           # Zustand stores (apiKeyStore, modelsStore)
│   └── types/            # TypeScript type definitions
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
- **`src/components/playground/DynamicForm.tsx`**: Generates forms from model schemas
- **`src/components/playground/ModelSelector.tsx`**: Searchable model dropdown with fuzzy search
- **`src/components/playground/OutputDisplay.tsx`**: Displays prediction results (images, videos, text)
- **`src/pages/HistoryPage.tsx`**: Prediction history with detail dialog
- **`src/lib/schemaToForm.ts`**: Converts API schema to form field configurations

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
npm run dev          # Start dev server with hot reload
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

## Important Notes

- The app stores the API key securely using electron-store (with localStorage fallback for browser dev mode)
- History is limited to last 24 hours with 20 items per page
- File uploads return a URL that's used as the input parameter
- Model schemas use OpenAPI format with `x-order-properties` for field ordering
- macOS builds are unsigned; users must run `xattr -cr "/Applications/WaveSpeed Desktop.app"` before first launch
- LoRA fields are detected by `x-ui-component: "loras"` or field name matching `loras`
- Models are sorted by `sort_order` (popularity) by default, with higher values appearing first
- Documentation URLs follow the pattern: `https://wavespeed.ai/docs/docs-api/{owner}/{model-name}` where slashes after the owner become dashes
- The playground supports multiple tabs, each with its own model and form state
- IPC handlers in `electron/main.ts` include: `get-api-key`, `set-api-key`, `download-file`, `open-external`
