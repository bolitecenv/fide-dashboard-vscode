# FIDE Embedded Dashboard Extension

A Visual Studio Code extension for managing embedded development projects with an intuitive dashboard interface.

## Features

- **Dashboard Interface**: Beautiful webview-based dashboard for project management
- **New Project Creation**: Select from multiple development boards and create projects
- **Board Support**: 
  - STM32F4 Discovery (ARM Cortex-M4)
  - ESP32 DevKitC (Xtensa LX6)
  - Raspberry Pi Pico (ARM Cortex-M0+)
  - Nordic nRF52840 DK (ARM Cortex-M4)
- **Log Viewer**: Real-time activity logs with filtering
- **Workspace Management**: Automatic workspace creation with project files
- **Backend Integration**: Connects to FIDE backend API for project management

## Requirements

- Visual Studio Code 1.85.0 or higher
- FIDE backend server running (default: http://localhost:3000)
- Node.js 18.x or higher

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Press F5 to run the extension in development mode

## Usage

### Opening the Dashboard

1. Open Command Palette (Cmd+Shift+P on macOS, Ctrl+Shift+P on Windows/Linux)
2. Type "FIDE: Open Dashboard"
3. Press Enter

### Creating a New Project

1. Open the dashboard
2. Enter a project name
3. Select a development board from the grid
4. Click "Create Project"
5. Choose a folder location for your project
6. The extension will download template files and create a workspace

### Viewing Logs

1. Open the dashboard
2. Click on the "Log Viewer" tab
3. View real-time activity logs
4. Use "Refresh" to update logs or "Clear Logs" to reset

## Configuration

Configure the backend URL in VS Code settings:

```json
{
  "fide.backendUrl": "http://localhost:3000"
}
```

## Development

### Building

```bash
npm run compile
```

### Watching for changes

```bash
npm run watch
```

### Running the extension

Press F5 in VS Code to open a new Extension Development Host window.

## Backend API

This extension connects to the FIDE backend API with the following endpoints:

- `GET /api/boards` - List available boards
- `POST /api/projects` - Create new project
- `GET /api/projects/:id/files/:path` - Get file content

## Project Structure

```
.
├── src/
│   ├── extension.ts              # Extension entry point
│   └── dashboardViewProvider.ts  # Dashboard webview provider
├── package.json                   # Extension manifest
├── tsconfig.json                  # TypeScript configuration
└── README.md                      # This file
```

## License

MIT

## Author

FIDE Team
