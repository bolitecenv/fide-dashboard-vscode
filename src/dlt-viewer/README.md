# DLT Timeline Viewer

Real-time trace visualization for embedded systems with WebSocket support.

## Features

- **📡 Real-time Timeline**: Gantt-chart style visualization of trace events
- **📟 Register Monitor**: Live register value updates
- **📞 Call Graph Viewer**: Thread-based function call stack visualization
- **📋 Detailed Logs**: Event-level inspection with timing information

## Usage

### Opening the DLT Viewer

1. **From Dashboard**: Click "DLT Timeline" in the left sidebar
2. **From Command Palette**: 
   - Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "FIDE: Open DLT Timeline Viewer"
   - Press Enter

### WebSocket Protocol

The viewer connects to `ws://localhost:8083` and expects three types of messages:

#### 1. Trace Events
Format: `<ID>:<Timestamp>:<start|end>:<metadata>`

**Example:**
```
Task_Init:0.00:start:System initialization
Task_Init:50.23:end:System initialization
```

- `ID`: Unique identifier for the task/event
- `Timestamp`: Time in milliseconds
- `start/end`: Event type
- `metadata`: Description or additional info

#### 2. Register Updates
Format: `REG:<name>:<value>`

**Example:**
```
REG:R0:0x00001234
REG:PC:0xDEADBEEF
```

- `name`: Register name (R0, R1, PC, SP, etc.)
- `value`: Hexadecimal value

#### 3. Call Graph Events
Format: `<ThreadID>:<FunctionName>:<Timestamp>:<start|end>`

**Example:**
```
Thread_0:main:100.50:start
Thread_0:process_data:120.75:start
Thread_0:process_data:150.80:end
Thread_0:main:160.00:end
```

- `ThreadID`: Thread identifier
- `FunctionName`: Function being called
- `Timestamp`: Time in milliseconds
- `start/end`: Call event type

## Testing with WebSocket Server

A test WebSocket server is included: `test-ws-server.js`

### Running the Test Server

```bash
# Install dependencies (if needed)
npm install ws

# Run the server
node test-ws-server.js
```

The server will:
- Listen on `ws://localhost:8083`
- Send simulated trace events for various tasks
- Send periodic register updates
- Send function call events for multiple threads

### Simulated Tasks

The test server simulates these embedded tasks:
- `Task_Init` - System initialization (50ms)
- `Task_Read` - Reading sensor data (20ms)
- `Task_Process` - Processing algorithms (80ms)
- `Task_Write` - Writing output (30ms)
- `Task_Network` - Network communication (120ms)
- `Task_UI` - UI rendering (40ms)

## UI Components

### Timeline Panel
- **Timeline Ruler**: Time scale with tick marks
- **Track Rows**: One row per task ID
- **Trace Spans**: Colored bars showing task duration
- **Selection**: Click tracks to view detailed logs

### Left Sidebar
- **Registers Panel**: Live register values
- **Call Graph Panel**: Expandable thread call stacks

### Log Panel
- Shows detailed information for selected track
- Displays timestamp, duration, and metadata
- Auto-scrolls to latest entries

## Color Coding

Each task ID is automatically assigned a unique color:
- Blue: `#007acc`
- Purple: `#68217a`
- Teal: `#00897b`
- Red: `#d14`
- Orange: `#f9a825`
- Deep Purple: `#6a1b9a`
- Dark Blue: `#0277bd`
- Green: `#558b2f`

Colors cycle through this palette as new task IDs are discovered.

## Tips

1. **Clear Data**: Use the "Clear" button to reset all traces and start fresh
2. **Track Selection**: Click on timeline tracks to view detailed logs in the bottom panel
3. **Thread Inspection**: Click on thread stacks to expand and view function calls
4. **Connection**: The viewer auto-connects on load, but you can manually disconnect/reconnect

## Architecture

**File**: `dltViewerProvider.ts`
- Webview-based VS Code panel
- Pure JavaScript implementation (no external dependencies in webview)
- WebSocket client running in the webview context
- Real-time rendering with efficient DOM updates
