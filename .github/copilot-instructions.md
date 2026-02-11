# FIDE Embedded Dashboard Extension

VS Code extension for managing embedded development projects with integrated dashboard UI for board selection, project creation, and activity logging.

## Architecture Overview

**Extension Type**: Webview-based VS Code extension with external REST API integration

**Data Flow**:
1. User opens dashboard → Extension creates webview panel
2. Webview requests boards → Extension calls backend REST API → Displays board grid
3. User creates project → Backend generates template → Extension downloads files to local filesystem → Creates `.code-workspace` file

**Key Components**:
- [src/extension.ts](src/extension.ts) - Entry point: registers `fide.openDashboard`, `fide.openDltViewer`, `fide.openAiAgent` commands
- [src/dashboardViewProvider.ts](src/dashboardViewProvider.ts) - Main logic: webview management, API communication, file operations
- [src/dlt-viewer/dltViewerProvider.ts](src/dlt-viewer/dltViewerProvider.ts) - DLT timeline viewer with trace and call stack visualization
- [src/ai-agent/aiAgentProvider.ts](src/ai-agent/aiAgentProvider.ts) - AI-powered workspace assistant with file operations and command execution

## Backend Integration Pattern

**Backend API** (Rust Axum, default: `http://localhost:3000`):
- `GET /api/boards` - Returns `BoardConfig[]` with board specs
- `POST /api/projects` - Creates project, returns `CreateProjectResponse` with file tree
- `GET /api/projects/:id/files/:path` - Fetches individual file content

**Configuration**: Backend URL is configurable via `fide.backendUrl` setting (see `package.json` contributes.configuration).

**Error Handling**: All API calls wrapped in try/catch with dual error reporting:
- `vscode.window.showErrorMessage()` for user feedback
- `addLog()` method for dashboard log viewer

## Development Workflow

**Build & Test**:
```bash
npm run watch      # Auto-compile TypeScript (runs tsc -watch)
# Press F5          # Opens Extension Development Host
```

**Available NPM Scripts** ([package.json](package.json)):
- `compile` - One-time TypeScript build
- `watch` - Continuous compilation (use during development)
- `lint` - ESLint validation

## Code Conventions

**TypeScript Strictness**: Enabled in [tsconfig.json](tsconfig.json) - all code must satisfy strict mode.

**Webview Communication Pattern** (bi-directional messaging):
```typescript
// Extension → Webview
this._panel.webview.postMessage({ command: 'boardsLoaded', boards: data });

// Webview → Extension
this._panel.webview.onDidReceiveMessage(async (message) => {
  switch (message.command) {
    case 'getBoards': await this.fetchBoards(); break;
  }
});
```

**Logging System**: In-memory log buffer (max 100 entries) with real-time webview updates:
- Call `addLog(level, message, projectId?)` throughout operations
- Logs automatically pushed to webview when panel is open

**Project Creation Flow**:
1. User selects folder via `vscode.window.showOpenDialog()`
2. Backend returns file tree structure
3. Extension recursively creates directories and downloads files
4. Generates `.code-workspace` file with FIDE-specific settings:
   ```json
   {
     "settings": {
       "fide.projectId": "...",
       "fide.containerId": "...",
       "fide.boardId": "..."
     }
   }
   ```
5. Prompts user to open workspace with `vscode.commands.executeCommand('vscode.openFolder', ...)`

## Webview Implementation

**HTML Generation**: [dashboardViewProvider.ts#L296-827](dashboardViewProvider.ts#L296-L827) contains full HTML/CSS/JS as template string.

**Styling**: Uses VS Code CSS variables (`--vscode-*`) for theme compatibility:
- `--vscode-editor-background`
- `--vscode-foreground`
- `--vscode-button-background`
- etc.

**State Management**: JavaScript maintains `selectedBoard` and `boards` array in webview context.

## Extension Manifest Key Points

**Activation**: No specific `activationEvents` - extension activates on any VS Code action.

**Command**: Single command `fide.openDashboard` opens/reveals the dashboard panel.

**Webview Options** ([dashboardViewProvider.ts#L56-60](dashboardViewProvider.ts#L56-L60)):
- `enableScripts: true` - Required for JavaScript
- `retainContextWhenHidden: true` - Preserves state when panel hidden
- `localResourceRoots` - Currently unused (no local resources loaded)

## Supported Boards

Default configuration includes:
- STM32F4 Discovery (ARM Cortex-M4, 192KB RAM, 1MB Flash)
- ESP32 DevKitC (Xtensa LX6, 520KB RAM, 4MB Flash)
- Raspberry Pi Pico (ARM Cortex-M0+, 264KB RAM, 2MB Flash)
- Nordic nRF52840 DK (ARM Cortex-M4, 256KB RAM, 1MB Flash)

Board data fetched dynamically from backend - extension doesn't hardcode board list.

## AI Agent Integration

**Claude API** (Anthropic, default: `https://api.anthropic.com/v1/messages`):
- Model: `claude-3-5-sonnet-20241022`
- Max tokens: 4096
- Tool calling enabled for workspace operations

**Available Tools**:
- `search_files` - Find files using glob patterns
- `read_file` - Read file contents
- `write_file` - Create/update files
- `execute_command` - Run shell commands (cargo, make, npm, etc.)
- `list_directory` - Browse directory contents

**Tool Execution Pattern**: AI requests tool use → Extension executes → Returns result → AI continues or responds

**Security Note**: API token currently hardcoded - should be moved to VS Code settings (`fide.aiAgent.apiToken`).
