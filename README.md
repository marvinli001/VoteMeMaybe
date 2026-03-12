# Vote Me Maybe

Single-player desktop Werewolf (12-player) built with Tauri and React. One human player competes against AI agents with private context, phase-based rules, and structured JSON output.

## Features
- 12-player classic Werewolf rules with day/night phase loop
- Independent AI agents with private context and public discussion log
- AI provider configuration (Responses API or Chat Completions API)
- Tauri proxy for API calls to avoid browser CORS limitations
- Portable Windows build option (no installer)

## Requirements
- Node.js 18+ (recommended)
- Rust toolchain (for Tauri builds)
- WebView2 Runtime (required on Windows for the portable exe)

## Development
Install dependencies:
```bash
npm install
```

Run the Tauri app (frontend dev server + native shell):
```bash
npm run dev
```

Run frontend only:
```bash
npm run dev:fe
```

## Build
Build the Tauri app:
```bash
npm run build
```

Build a portable Windows exe (no installer):
```bash
npm run build:portable
```

The portable exe is typically at:
```
src-tauri/target/release/Vote Me Maybe.exe
```

If you want installers (MSI/NSIS), set `bundle.active` to `true` in `src-tauri/tauri.conf.json`.

## Scripts
- `dev`: Tauri dev
- `build`: Tauri build
- `dev:fe`: Vite dev server only
- `build:fe`: Typecheck + Vite build
- `build:portable`: Tauri build with bundling disabled

## Configuration
AI providers and models are managed in the AI configuration screen. Provider names, hosts, and model assignments are stored locally using the Tauri store plugin.
API keys are session-only and are not written to disk.

## Notes
The game UI only renders public speech content. All AI outputs must be JSON as defined in the in-app system prompt.
