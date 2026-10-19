# FundedFlow

FundedFlow is a Windows-first, local-first trading journal built with Tauri 2, React, TypeScript, and Vite. Local application capabilities and SQLite persistence stay behind Rust commands; the frontend does not access SQL or require a cloud service.

## Prerequisites

- Windows 10 (1803+) or Windows 11 with Microsoft Edge WebView2 Runtime
- Node.js LTS and npm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio Build Tools with the **Desktop development with C++** workload
- Git

## Start developing

```powershell
npm install
npm run tauri dev
```

## Build

```powershell
npm run build
npm run tauri build
```

Vite serves the development frontend on loopback only. The packaged desktop app does not run a local HTTP server. SQLite is bundled through `rusqlite` and will be accessed through Rust commands as the data layer is implemented.