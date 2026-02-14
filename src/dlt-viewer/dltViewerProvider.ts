import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

interface TraceSpan {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
    metadata: string;
    color: string;
}

interface Register {
    name: string;
    value: string;
}

interface CallEvent {
    functionName: string;
    timestamp: number;
    type: 'start' | 'end';
    depth?: number;
}

interface CallStack {
    threadId: string;
    calls: CallEvent[];
}

interface DebugConfig {
    buildCmd: string;
    runCmd: string;
    gdbCmd: string;
    gdbTarget: string;
    elfPath: string;
    gdbInitCmds: string;
}

interface AiConfig {
    apiUrl: string;
    apiKey: string;
    model: string;
    authType?: 'anthropic' | 'bearer';
}

export class DltViewerProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _buildProcess: ChildProcess | undefined;
    private _runProcess: ChildProcess | undefined;
    private _gdbProcess: ChildProcess | undefined;
    private _workspaceRoot: string | undefined;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    public show() {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this._panel) {
            this._panel.reveal(column);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'fideDltViewer',
            'DLT Timeline Viewer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'out', 'dlt-viewer'),
                    vscode.Uri.joinPath(this._extensionUri, 'src', 'components', 'dlt-core')
                ]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'exportRegisters':
                        await this._exportRegistersToFile(message.content);
                        break;
                    case 'exportView':
                        await this._exportViewToFile(message.viewName, message.content);
                        break;
                    case 'debugAction':
                        await this._handleDebugAction(message);
                        break;
                    case 'saveDebugConfig':
                        await this._saveDebugConfig(message.config);
                        break;
                    case 'loadDebugConfig':
                        await this._loadDebugConfig();
                        break;
                    case 'aiDebugAnalyze':
                        await this._handleAiDebugAnalyze(message.prompt, message.context);
                        break;
                    case 'showMessage':
                        if (message.type === 'warning') {
                            vscode.window.showWarningMessage(message.message);
                        } else if (message.type === 'error') {
                            vscode.window.showErrorMessage(message.message);
                        } else {
                            vscode.window.showInformationMessage(message.message);
                        }
                        break;
                }
            },
            null,
            []
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'dlt-viewer', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'dlt-viewer', 'webview.css')
        );

        const wasmUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'components', 'dlt-core', 'wasm_demo.wasm')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DLT Timeline Viewer</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body data-wasm-uri="${wasmUri}">
    <div class="view-container">
        <div class="dlt-toolbar">
            <div class="toolbar-left">
                <div class="timeline-status">
                    <div id="statusIndicator" class="status-indicator disconnected">
                        <span class="status-dot"></span>
                        <span id="statusText">Disconnected - ws://localhost:8083</span>
                    </div>
                </div>
                
                <div class="timeline-view-toggle">
                    <button class="timeline-view-btn active" id="traceViewBtn" onclick="setTimelineView('trace')">
                        📊 Trace Timeline
                    </button>
                    <button class="timeline-view-btn" id="callViewBtn" onclick="setTimelineView('calls')">
                        📞 Call Stack
                    </button>
                    <button class="timeline-view-btn" id="chartViewBtn" onclick="setTimelineView('charts')">
                        📈 Charts
                    </button>
                    <button class="timeline-view-btn" id="logsViewBtn" onclick="setTimelineView('logs')">
                        📋 DLT Logs
                    </button>
                    <button class="timeline-view-btn" id="debugViewBtn" onclick="setTimelineView('debug')">
                        🔨 Build+Debug
                    </button>
                    <button class="timeline-view-btn" id="servicesViewBtn" onclick="setTimelineView('services')">
                        🔧 Services
                    </button>
                </div>
            </div>

            <div class="timeline-controls">
                <button onclick="connectWebSocket()" id="connectBtn">
                    🔌 Connect
                </button>
                <button onclick="toggleConfig()" id="configBtn">
                    ⚙️ Config
                </button>
                <button onclick="resetZoom()" title="Double-click timeline to reset zoom">
                    🔍 Reset Zoom
                </button>
                <button onclick="exportCurrentView()" id="exportBtn" title="Click and drag on ruler to select region">
                    💾 Export
                </button>
                <button onclick="clearRegionSelection()" id="clearRegionBtn" style="display: none;" title="Clear region selection">
                    ✖️ Clear Region
                </button>
                <button onclick="clearData()" class="secondary">
                    🗑️ Clear
                </button>
            </div>

            <!-- Configuration Panel -->
            <div class="config-panel" id="configPanel">
                <h3>⚙️ WebSocket Configuration</h3>
                <div class="config-section">
                    <label for="wsPort">WebSocket Port</label>
                    <input type="number" id="wsPort" value="8083" min="1" max="65535">
                </div>
                <div class="config-section">
                    <label for="packetType">Packet Format</label>
                    <select id="packetType">
                        <option value="text">Text (colon-separated)</option>
                        <option value="dlt">DLT Binary Format</option>
                    </select>
                </div>
                <div class="config-actions">
                    <button onclick="toggleConfig()" class="secondary">Cancel</button>
                    <button onclick="applyConfig()">Apply & Reconnect</button>
                </div>
            </div>
        </div>

        <div class="dlt-main-layout">
            <!-- Left Panel: Registers and Call Graph -->
            <div class="dlt-left-panel">
                <!-- Register View -->
                <div class="register-panel">
                    <div class="panel-header">
                        <h3>📟 Registers</h3>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button onclick="exportRegisters()" style="font-size: 11px; padding: 4px 8px;" title="Export to .logging/reg.log">💾 Export</button>
                            <span class="badge" id="registerCount">0</span>
                        </div>
                    </div>
                    <div class="register-list" id="registerList">
                        <div class="empty-message">
                            <p>No registers received</p>
                            <p class="hint">Format: REG:&lt;name&gt;:&lt;value&gt;</p>
                        </div>
                    </div>
                </div>

                <!-- Call Graph View -->
                <div class="callgraph-panel">
                    <div class="panel-header">
                        <h3>📞 Call Graph</h3>
                        <span class="badge" id="threadCount">0 threads</span>
                    </div>
                    <div class="callgraph-list" id="callGraphList">
                        <div class="empty-message">
                            <p>No call events received</p>
                            <p class="hint">Format: &lt;ThreadID&gt;:&lt;Function&gt;:&lt;Time&gt;:&lt;start|end&gt;</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Panel: Timeline and Logs -->
            <div class="dlt-right-panel">
                <div class="timeline-gantt-container" id="timelineContainer">
                    <div class="empty-state">
                        <div class="empty-icon">📡</div>
                        <h3>Waiting for trace data...</h3>
                        <p>Connect to WebSocket at port 8083</p>
                        <p class="hint">Format: &lt;ID&gt;:&lt;Timestamp&gt;:&lt;Start|End&gt;:&lt;metadata&gt;</p>
                    </div>
                </div>

                <!-- Chart View Container -->
                <div class="chart-view-container" id="chartContainer" style="display: none;">
                    <div class="chart-controls">
                        <button onclick="addChart()">+ Add Chart</button>
                        <span style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-left: 10px;">
                            Format: &lt;Name&gt;:&lt;Timestamp&gt;:&lt;Value&gt;
                        </span>
                    </div>
                    <div class="chart-list" id="chartList">
                        <div class="empty-state">
                            <div class="empty-icon">📊</div>
                            <h3>No charts configured</h3>
                            <p>Click "Add Chart" to create a new chart</p>
                            <p class="hint">Charts display data in format: NAME:timestamp:value</p>
                        </div>
                    </div>
                </div>

                <!-- Log Panel -->
                <div class="dlt-logs-container" id="logsContainer" style="display: none;">
                    <div class="log-header">
                        <h3>📋 DLT Logs</h3>
                        <div class="log-stats">
                            <span class="stats-label">Received:</span>
                            <span class="stats-value" id="dltReceivedCount2">0</span>
                            <span class="stats-label" style="margin-left: 12px;">Errors:</span>
                            <span class="stats-value error" id="dltIncorrectCount2">0</span>
                        </div>
                    </div>
                    <div class="log-filter-bar">
                        <label class="filter-label">Filter:</label>
                        <select id="filterEcu" onchange="onFilterChange()">
                            <option value="">All ECUs</option>
                        </select>
                        <select id="filterApp" onchange="onFilterChange()">
                            <option value="">All Apps</option>
                        </select>
                        <select id="filterCtx" onchange="onFilterChange()">
                            <option value="">All Contexts</option>
                        </select>
                        <button class="filter-clear-btn" onclick="clearFilter()" title="Clear filter">✖</button>
                        <span class="filter-count" id="filterCount"></span>
                    </div>
                    <div class="log-list" id="logList">
                        <div class="log-empty">
                            <div class="empty-icon">📡</div>
                            <p>No DLT messages received</p>
                            <p class="hint">Set Packet Format to "DLT Binary Format" and connect to WebSocket</p>
                        </div>
                    </div>
                </div>

                <!-- Debug View Container -->
                <div class="debug-view-container" id="debugContainer" style="display: none;">
                    <div class="debug-tabs">
                        <button class="debug-tab active" id="debugTab-config" onclick="switchDebugTab('config')">⚙️ Config</button>
                        <button class="debug-tab" id="debugTab-build" onclick="switchDebugTab('build')">🔨 Build</button>
                        <button class="debug-tab" id="debugTab-run" onclick="switchDebugTab('run')">▶️ Run</button>
                        <button class="debug-tab" id="debugTab-gdb" onclick="switchDebugTab('gdb')">🐛 GDB</button>
                        <button class="debug-tab" id="debugTab-ai" onclick="switchDebugTab('ai')">🤖 AI Debug</button>
                        <div class="debug-tab-actions">
                            <button class="debug-action-btn build" onclick="startBuild()" title="Build">🔨 Build</button>
                            <button class="debug-action-btn run" onclick="buildAndRun()" title="Build & Run">▶️ Run</button>
                            <button class="debug-action-btn debug" onclick="buildAndDebug()" title="Build & Debug">🐛 Debug</button>
                            <button class="debug-action-btn stop" onclick="stopAll()" title="Stop All">⏹️ Stop</button>
                        </div>
                    </div>

                    <!-- Config Panel -->
                    <div class="debug-panel" id="debugPanel-config" style="display: flex;">
                        <div class="debug-config-grid">
                            <div class="debug-config-field">
                                <label>Build Command</label>
                                <input type="text" id="debugBuildCmd" value="cargo build" placeholder="cargo build">
                            </div>
                            <div class="debug-config-field">
                                <label>Run Command</label>
                                <input type="text" id="debugRunCmd" value="cargo run" placeholder="cargo run">
                            </div>
                            <div class="debug-config-field">
                                <label>GDB Executable</label>
                                <input type="text" id="debugGdbCmd" value="arm-none-eabi-gdb" placeholder="arm-none-eabi-gdb">
                            </div>
                            <div class="debug-config-field">
                                <label>GDB Target</label>
                                <input type="text" id="debugGdbTarget" value="localhost:3333" placeholder="localhost:3333">
                            </div>
                            <div class="debug-config-field">
                                <label>ELF Path</label>
                                <input type="text" id="debugElfPath" value="target/thumbv7em-none-eabihf/debug/firmware" placeholder="path/to/firmware.elf">
                            </div>
                            <div class="debug-config-field full-width">
                                <label>GDB Init Commands (one per line)</label>
                                <textarea id="debugGdbInitCmds" rows="4" placeholder="target remote localhost:3333&#10;monitor reset halt&#10;load&#10;continue">target remote localhost:3333\nmonitor reset halt\nload\ncontinue</textarea>
                            </div>
                            <div class="debug-config-actions">
                                <button onclick="saveDebugConfig()">💾 Save Config</button>
                            </div>
                        </div>
                    </div>

                    <!-- Build Panel -->
                    <div class="debug-panel" id="debugPanel-build" style="display: none;">
                        <div class="debug-panel-header">
                            <div class="debug-status">
                                <span class="status-dot idle" id="buildStatusDot"></span>
                                <span id="buildStatusLabel">Idle</span>
                            </div>
                            <button onclick="startBuild()" class="debug-action-btn build">🔨 Build</button>
                        </div>
                        <div class="debug-output" id="buildOutput">
                            <div class="debug-output-empty">No build output yet. Click Build to start.</div>
                        </div>
                    </div>

                    <!-- Run Panel -->
                    <div class="debug-panel" id="debugPanel-run" style="display: none;">
                        <div class="debug-panel-header">
                            <div class="debug-status">
                                <span class="status-dot idle" id="runStatusDot"></span>
                                <span id="runStatusLabel">Idle</span>
                            </div>
                            <div style="display: flex; gap: 5px;">
                                <button onclick="startRun()" class="debug-action-btn run">▶️ Run</button>
                                <button onclick="stopRun()" class="debug-action-btn stop">⏹️ Stop</button>
                            </div>
                        </div>
                        <div class="debug-output" id="runOutput">
                            <div class="debug-output-empty">No run output yet. Click Run to start.</div>
                        </div>
                    </div>

                    <!-- GDB Panel -->
                    <div class="debug-panel" id="debugPanel-gdb" style="display: none;">
                        <div class="debug-panel-header">
                            <div class="debug-status">
                                <span class="status-dot idle" id="gdbStatusDot"></span>
                                <span id="gdbStatusLabel">Idle</span>
                            </div>
                            <div style="display: flex; gap: 5px;">
                                <button onclick="startGdb()" class="debug-action-btn debug">🐛 Start GDB</button>
                                <button onclick="stopGdb()" class="debug-action-btn stop">⏹️ Stop</button>
                            </div>
                        </div>
                        <div class="debug-output" id="gdbOutput">
                            <div class="debug-output-empty">No GDB session. Click Start GDB to connect.</div>
                        </div>
                        <div class="gdb-input-bar">
                            <span class="gdb-prompt">(gdb)</span>
                            <input type="text" id="gdbInput" placeholder="Enter GDB command..." onkeydown="if(event.key==='Enter')sendGdbCommand()">
                            <button onclick="sendGdbCommand()">Send</button>
                        </div>
                    </div>

                    <!-- AI Debug Panel -->
                    <div class="debug-panel" id="debugPanel-ai" style="display: none;">
                        <div class="debug-panel-header">
                            <span>🤖 AI Debug Assistant</span>
                            <span class="debug-dlt-badge">DLT Logs: <strong id="debugDltCount">0</strong></span>
                        </div>
                        <div class="ai-debug-prompt-bar">
                            <input type="text" id="aiDebugPrompt" placeholder="Ask AI about build errors, crashes, DLT logs..." onkeydown="if(event.key==='Enter')askAiDebug()">
                            <button onclick="askAiDebug()">🤖 Analyze</button>
                            <button onclick="askAiDebug('Analyze the build errors and suggest fixes')" class="secondary" title="Quick: Analyze build">🔨</button>
                            <button onclick="askAiDebug('Analyze the DLT logs for issues or anomalies')" class="secondary" title="Quick: Analyze DLT">📋</button>
                            <button onclick="askAiDebug('Analyze the GDB output and explain the crash')" class="secondary" title="Quick: Analyze crash">🐛</button>
                        </div>
                        <div class="ai-debug-output" id="aiDebugOutput">
                            <div class="debug-output-empty">Ask AI to analyze build errors, runtime issues, or DLT logs.<br>AI has access to build output, run output, GDB output, and DLT log buffer.</div>
                        </div>
                    </div>
                </div>

                <!-- Services Container -->
                <div class="services-container" id="servicesContainer" style="display: none;">
                    <div class="svc-panel">
                        <div class="svc-header">
                            <h3>🔧 DLT Service Generator</h3>
                            <span class="svc-ws-status" id="svcWsStatus">⚪ Not connected</span>
                        </div>
                        <div class="svc-form">
                            <div class="svc-row">
                                <div class="svc-field">
                                    <label>Service Type</label>
                                    <select id="svcType" onchange="onServiceTypeChange()">
                                        <option value="set_log_level">SetLogLevel</option>
                                        <option value="get_log_info">GetLogInfo</option>
                                        <option value="get_default_log_level">GetDefaultLogLevel</option>
                                        <option value="get_sw_version">GetSoftwareVersion</option>
                                        <option value="injection">Injection Message</option>
                                        <option value="log_message">Log Message</option>
                                    </select>
                                </div>
                            </div>
                            <div class="svc-row">
                                <div class="svc-field svc-sm">
                                    <label>ECU ID</label>
                                    <input type="text" id="svcEcu" value="ECU1" maxlength="4" placeholder="ECU1">
                                </div>
                                <div class="svc-field svc-sm">
                                    <label>APP ID</label>
                                    <input type="text" id="svcApp" value="DA1" maxlength="4" placeholder="DA1">
                                </div>
                                <div class="svc-field svc-sm">
                                    <label>CTX ID</label>
                                    <input type="text" id="svcCtx" value="DC1" maxlength="4" placeholder="DC1">
                                </div>
                            </div>
                            <!-- SetLogLevel / GetLogInfo specific fields -->
                            <div class="svc-row svc-conditional" id="svcTargetFields">
                                <div class="svc-field svc-sm">
                                    <label>Target APP</label>
                                    <input type="text" id="svcTargetApp" value="LOG" maxlength="4" placeholder="LOG">
                                </div>
                                <div class="svc-field svc-sm">
                                    <label>Target CTX</label>
                                    <input type="text" id="svcTargetCtx" value="TEST" maxlength="4" placeholder="TEST">
                                </div>
                                <div class="svc-field svc-sm" id="svcLogLevelField">
                                    <label>Log Level</label>
                                    <select id="svcLogLevel">
                                        <option value="1">1 - Fatal</option>
                                        <option value="2">2 - Error</option>
                                        <option value="3">3 - Warn</option>
                                        <option value="4" selected>4 - Info</option>
                                        <option value="5">5 - Debug</option>
                                        <option value="6">6 - Verbose</option>
                                    </select>
                                </div>
                            </div>
                            <!-- Injection specific fields -->
                            <div class="svc-row svc-conditional" id="svcInjectionFields" style="display: none;">
                                <div class="svc-field svc-sm">
                                    <label>Service ID (hex)</label>
                                    <input type="text" id="svcInjectionId" value="0xFFF" placeholder="0xFFF">
                                </div>
                                <div class="svc-field">
                                    <label>Payload</label>
                                    <input type="text" id="svcInjectionPayload" placeholder="injection payload">
                                </div>
                            </div>
                            <!-- Log Message specific fields -->
                            <div class="svc-row svc-conditional" id="svcLogMsgFields" style="display: none;">
                                <div class="svc-field svc-sm">
                                    <label>Log Level</label>
                                    <select id="svcLogMsgLevel">
                                        <option value="1">Fatal</option>
                                        <option value="2">Error</option>
                                        <option value="3">Warn</option>
                                        <option value="4" selected>Info</option>
                                        <option value="5">Debug</option>
                                        <option value="6">Verbose</option>
                                    </select>
                                </div>
                                <div class="svc-field svc-xs">
                                    <label>Verbose</label>
                                    <input type="checkbox" id="svcVerbose" checked>
                                </div>
                                <div class="svc-field">
                                    <label>Payload</label>
                                    <input type="text" id="svcLogPayload" value="test" placeholder="log message text">
                                </div>
                            </div>
                            <div class="svc-actions">
                                <button onclick="handleSendService()" class="svc-send-btn">📤 Send</button>
                            </div>
                        </div>
                    </div>
                    <div class="svc-history-panel">
                        <div class="svc-history-header">
                            <span>📜 Service History</span>
                            <span class="badge" id="svcHistoryCount">0</span>
                        </div>
                        <div class="svc-history-list" id="svcHistory">
                            <div class="svc-history-empty">No messages sent yet</div>
                        </div>
                    </div>
                </div>

                <!-- DLT Statistics Panel (Bottom Right) -->
                <div class="dlt-stats-panel" id="dltStatsPanel">
                    <div class="stats-item">
                        <span class="stats-label">DLT Received:</span>
                        <span class="stats-value" id="dltReceivedCount">0</span>
                    </div>
                    <div class="stats-item">
                        <span class="stats-label">Incorrect:</span>
                        <span class="stats-value error" id="dltIncorrectCount">0</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async _exportRegistersToFile(content: string): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri;
            const loggingDir = vscode.Uri.joinPath(workspaceRoot, '.logging');
            const logFile = vscode.Uri.joinPath(loggingDir, 'reg.log');

            // Create .logging directory if it doesn't exist
            try {
                await vscode.workspace.fs.stat(loggingDir);
            } catch {
                await vscode.workspace.fs.createDirectory(loggingDir);
            }

            // Write the log file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(logFile, encoder.encode(content));

            vscode.window.showInformationMessage(`Register log exported to ${logFile.fsPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export register log: ${error}`);
        }
    }

    private async _exportViewToFile(viewName: string, content: string): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri;
            const loggingDir = vscode.Uri.joinPath(workspaceRoot, '.logging');
            const logFile = vscode.Uri.joinPath(loggingDir, `${viewName}.log`);

            // Create .logging directory if it doesn't exist
            try {
                await vscode.workspace.fs.stat(loggingDir);
            } catch {
                await vscode.workspace.fs.createDirectory(loggingDir);
            }

            // Write the log file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(logFile, encoder.encode(content));

            vscode.window.showInformationMessage(`${viewName} log exported to ${logFile.fsPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export ${viewName} log: ${error}`);
        }
    }

    // ========================================================================
    // DEBUG: Build / Run / GDB handlers
    // ========================================================================

    private _postMessage(message: any) {
        this._panel?.webview.postMessage(message);
    }

    private async _handleDebugAction(message: any): Promise<void> {
        const config: DebugConfig = message.config;
        const cwd = this._workspaceRoot || process.cwd();

        switch (message.action) {
            case 'build':
                this._runProcess?.kill();
                this._killProcess(this._buildProcess);
                this._buildProcess = this._spawnProcess(config.buildCmd, cwd, 'build');
                break;

            case 'run':
                this._killProcess(this._runProcess);
                this._runProcess = this._spawnProcess(config.runCmd, cwd, 'run');
                break;

            case 'stopRun':
                this._killProcess(this._runProcess);
                this._runProcess = undefined;
                this._postMessage({ command: 'debugOutput', action: 'run', status: 'exit', exitCode: -1 });
                break;

            case 'gdb':
                this._killProcess(this._gdbProcess);
                this._startGdb(config, cwd);
                break;

            case 'stopGdb':
                if (this._gdbProcess) {
                    this._gdbProcess.stdin?.write('quit\n');
                    setTimeout(() => {
                        this._killProcess(this._gdbProcess);
                        this._gdbProcess = undefined;
                    }, 500);
                }
                break;

            case 'gdbCommand':
                if (this._gdbProcess && this._gdbProcess.stdin) {
                    this._gdbProcess.stdin.write(message.gdbCmd + '\n');
                }
                break;
        }
    }

    private _spawnProcess(cmd: string, cwd: string, action: string): ChildProcess {
        const parts = cmd.split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        const proc = spawn(command, args, {
            cwd,
            shell: true,
            env: { ...process.env }
        });

        proc.stdout?.on('data', (data: Buffer) => {
            this._postMessage({
                command: 'debugOutput',
                action,
                stream: 'stdout',
                text: data.toString()
            });
        });

        proc.stderr?.on('data', (data: Buffer) => {
            this._postMessage({
                command: 'debugOutput',
                action,
                stream: 'stderr',
                text: data.toString()
            });
        });

        proc.on('close', (code: number | null) => {
            this._postMessage({
                command: 'debugOutput',
                action,
                status: 'exit',
                exitCode: code ?? -1
            });
        });

        proc.on('error', (err: Error) => {
            this._postMessage({
                command: 'debugOutput',
                action,
                stream: 'stderr',
                text: `Error: ${err.message}`
            });
            this._postMessage({
                command: 'debugOutput',
                action,
                status: 'exit',
                exitCode: -1
            });
        });

        return proc;
    }

    private _startGdb(config: DebugConfig, cwd: string): void {
        const gdbArgs = [config.elfPath];
        
        this._gdbProcess = spawn(config.gdbCmd, gdbArgs, {
            cwd,
            shell: true,
            env: { ...process.env }
        });

        this._gdbProcess.stdout?.on('data', (data: Buffer) => {
            this._postMessage({
                command: 'debugOutput',
                action: 'gdb',
                stream: 'stdout',
                text: data.toString()
            });
        });

        this._gdbProcess.stderr?.on('data', (data: Buffer) => {
            this._postMessage({
                command: 'debugOutput',
                action: 'gdb',
                stream: 'stderr',
                text: data.toString()
            });
        });

        this._gdbProcess.on('close', (code: number | null) => {
            this._postMessage({
                command: 'debugOutput',
                action: 'gdb',
                status: 'exit',
                exitCode: code ?? -1
            });
            this._gdbProcess = undefined;
        });

        this._gdbProcess.on('error', (err: Error) => {
            this._postMessage({
                command: 'debugOutput',
                action: 'gdb',
                stream: 'stderr',
                text: `GDB Error: ${err.message}`
            });
        });

        // Send init commands after brief delay
        setTimeout(() => {
            if (this._gdbProcess && this._gdbProcess.stdin) {
                const initCmds = config.gdbInitCmds.split('\\n');
                initCmds.forEach((cmd, i) => {
                    setTimeout(() => {
                        this._gdbProcess?.stdin?.write(cmd.trim() + '\n');
                    }, i * 300);
                });
                
                this._postMessage({
                    command: 'debugOutput',
                    action: 'gdb',
                    status: 'connected'
                });
            }
        }, 500);
    }

    private _killProcess(proc: ChildProcess | undefined): void {
        if (proc && !proc.killed) {
            try {
                proc.kill('SIGTERM');
                setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill('SIGKILL');
                    }
                }, 1000);
            } catch (e) {
                // Process may already be dead
            }
        }
    }

    // ========================================================================
    // DEBUG CONFIG PERSISTENCE
    // ========================================================================

    private async _saveDebugConfig(config: DebugConfig): Promise<void> {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'debug-config.json');
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            this._postMessage({ command: 'debugConfigSaved' });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save debug config: ${error}`);
        }
    }

    private async _loadDebugConfig(): Promise<void> {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'debug-config.json');
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(data);
                this._postMessage({ command: 'debugConfigLoaded', config });
            }
        } catch (error) {
            console.error('Failed to load debug config:', error);
        }
    }

    // ========================================================================
    // AI DEBUG ANALYSIS
    // ========================================================================

    private _loadAiConfig(): AiConfig | undefined {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'ai-config.json');
            const data = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(data);
        } catch {
            return undefined;
        }
    }

    private async _handleAiDebugAnalyze(prompt: string, context: any): Promise<void> {
        const aiConfig = this._loadAiConfig();
        if (!aiConfig || !aiConfig.apiKey) {
            this._postMessage({
                command: 'aiDebugResponse',
                response: '**Error:** AI config not found. Please configure ai-config.json with your API key.'
            });
            return;
        }

        const systemPrompt = `You are an embedded systems debug assistant. You help analyze build errors, runtime crashes, GDB output, and DLT trace logs for embedded firmware projects.

Be concise and actionable. Point to specific lines, suggest fixes, and explain root causes.`;

        let userMessage = prompt || 'Analyze the current debug state and suggest fixes.';
        userMessage += '\n\n--- BUILD OUTPUT ---\n' + (context.buildLog || '(none)');
        userMessage += '\n\n--- RUN OUTPUT ---\n' + (context.runLog || '(none)');
        userMessage += '\n\n--- GDB OUTPUT ---\n' + (context.gdbLog || '(none)');
        userMessage += '\n\n--- DLT LOGS ---\n' + (context.dltLogs || '(none)');
        userMessage += '\n\n--- CONFIG ---\n' + JSON.stringify(context.config, null, 2);

        try {
            const axios = (await import('axios')).default;
            const headers: any = {
                'Content-Type': 'application/json'
            };

            if (aiConfig.authType === 'bearer') {
                headers['Authorization'] = `Bearer ${aiConfig.apiKey}`;
            } else {
                headers['x-api-key'] = aiConfig.apiKey;
                headers['anthropic-version'] = '2023-06-01';
            }

            const response = await axios.post(aiConfig.apiUrl, {
                model: aiConfig.model || 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }]
            }, { headers, timeout: 60000 });

            const text = response.data?.content?.[0]?.text
                || response.data?.choices?.[0]?.message?.content
                || 'No response from AI.';

            this._postMessage({ command: 'aiDebugResponse', response: text });
        } catch (error: any) {
            this._postMessage({
                command: 'aiDebugResponse',
                response: `**AI Error:** ${error.message || error}\n\nCheck your ai-config.json settings.`
            });
        }
    }
}
