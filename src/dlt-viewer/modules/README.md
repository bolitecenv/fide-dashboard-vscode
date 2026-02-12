# DLT Viewer Modular Architecture

The DLT Viewer webview has been refactored into a modular architecture for better maintainability and organization.

## Module Structure

```
src/dlt-viewer/
├── webview.js              # Main entry point (imports all modules)
├── webview.css             # Global styles
└── modules/
    ├── chart-view.js       # Chart visualization module
    ├── register-view.js    # Register panel module
    ├── trace-view.js       # Trace timeline & call graph module
    ├── dlt-parser.js       # DLT packet parsing & WASM integration
    └── websocket-manager.js # WebSocket connection management
```

## Module Responsibilities

### 1. **chart-view.js**
- Chart creation and configuration
- Data series management  
- Canvas rendering
- Export chart data

**Key Functions:**
- `initChartView(state)` - Initialize with shared state
- `handleChartData(name, timestamp, value)` - Process incoming data
- `addChart()` - Create new chart
- `removeChart(chartId)` - Remove chart
- `updateChartConfig(chartId, field, value)` - Update configuration
- `renderChart(chart)` - Render single chart
- `renderAllCharts()` - Render all charts
- `exportChartsData()` - Export to file

### 2. **register-view.js**
- Register display and updates
- Hex/decimal value formatting
- Register export

**Key Functions:**
- `initRegisterView(state)` - Initialize with shared state
- `updateRegister(name, value, timestamp)` - Update register value
- `renderRegisters()` - Render register list
- `exportRegisters()` - Export to .logging/reg.log
- `clearRegisters()` - Clear all registers

### 3. **trace-view.js**
- Trace timeline visualization
- Call stack timeline
- Zoom and pan interactions
- Region selection
- Track/thread selection

**Key Functions:**
- `initTraceView(state)` - Initialize with shared state
- `handleTraceEvent(id, timestamp, type, metadata)` - Process trace events
- `handleCallEvent(threadId, functionName, timestamp, type)` - Process call events
- `renderTimeline()` - Render timeline view
- `renderCallGraph()` - Render call graph panel
- `resetZoom()` - Reset zoom level
- `selectTrack(trackId, event)` - Select trace track
- `selectThread(threadId, event)` - Select thread
- `renderLogs(spans)` - Render log panel
- `clearRegionSelection()` - Clear selected region
- `exportCurrentView()` - Export timeline/callstack data

### 4. **dlt-parser.js**
- WASM module initialization
- DLT packet buffer management
- Binary packet parsing
- Statistics tracking
- Message display formatting

**Key Functions:**
- `initDltParser()` - Initialize parser state
- `initWasm()` - Load and initialize WASM module
- `handleDltBinaryMessage(data, displayCallback)` - Parse binary WebSocket data
- `displayDltMessage(msg)` - Display parsed DLT message in UI
- `getDltStats()` - Get current statistics
- `resetDltStats()` - Reset statistics and buffer

### 5. **websocket-manager.js**
- WebSocket connection lifecycle
- Message routing (text vs binary)
- Configuration management
- Connection status updates

**Key Functions:**
- `initWebSocketManager(config)` - Initialize with config
- `connectWebSocket()` - Establish connection
- `updateConnectionStatus()` - Update UI status
- `applyConfig()` - Apply new configuration
- `toggleConfig()` - Toggle config panel
- `getConnectionInfo()` - Get current connection info

## Main webview.js Structure

The main `webview.js` file now:

1. **Initializes shared state** - All global variables and state
2. **Imports modules** - Uses ES6 imports (requires module support)
3. **Sets up module communication** - Passes state references to modules
4. **Handles global events** - Window load, message handlers
5. **Exposes global functions** - Makes module functions available to HTML onclick handlers

**Current Implementation Note:**
The existing `webview.js` remains as a monolithic file. To fully modularize:

1. Add ES6 import statements at the top
2. Initialize each module with shared state
3. Replace function implementations with module calls
4. Expose module functions via `window` object for HTML event handlers

## Example Integration Pattern

```javascript
// Import modules
import * as chartView from './modules/chart-view.js';
import * as registerView from './modules/register-view.js';
import * as traceView from './modules/trace-view.js';
import * as dltParser from './modules/dlt-parser.js';
import * as wsManager from './modules/websocket-manager.js';

// Initialize shared state
const state = {
    vscode: acquireVsCodeApi(),
    traceSpans: [],
    registers: new Map(),
    // ... more state
};

// Initialize modules
chartView.initChartView(state);
registerView.initRegisterView(state);
traceView.initTraceView(state);
dltParser.initDltParser();
wsManager.initWebSocketManager({
    wsPort: 8083,
    packetType: 'dlt',
    textMessageHandler: handleMessage,
    binaryMessageHandler: dltParser.handleDltBinaryMessage
});

// Expose to global scope for HTML onclick/onchange
window.chartView = chartView;
window.registerView = registerView;
window.traceView = traceView;
// ...
```

## Benefits

✅ **Separation of Concerns** - Each module handles a specific feature
✅ **Easier Testing** - Modules can be tested independently
✅ **Better Maintainability** - Changes isolated to relevant modules
✅ **Code Organization** - Clear module boundaries
✅ **Reduced Complexity** - Smaller, focused files instead of 1800+ line monolith

## Build Process

The `package.json` compile script now copies the `modules/` directory:

```json
"compile": "tsc -p ./ && cp src/dlt-viewer/webview.js out/dlt-viewer/webview.js && cp src/dlt-viewer/webview.css out/dlt-viewer/webview.css && cp -r src/dlt-viewer/modules out/dlt-viewer/ && ..."
```

## Next Steps for Full Modularization

1. **Add type="module" to script tag** in `dltViewerProvider.ts` HTML
2. **Convert webview.js** to use ES6 imports  
3. **Remove redundant code** - Delete functions that now exist in modules
4. **Update HTML onclick handlers** - Use `window.moduleName.function()` pattern
5. **Test thoroughly** - Ensure all features work with modular structure

## Migration Status

✅ Module files created
✅ Build process updated
⏸️ Main webview.js integration pending (current file still monolithic)

The modules are ready to use - the main webview.js just needs to be updated to import and use them.
