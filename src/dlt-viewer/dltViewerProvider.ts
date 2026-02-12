import * as vscode from 'vscode';

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

export class DltViewerProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
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
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out', 'dlt-viewer')]
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DLT Timeline Viewer</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
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
                <div class="log-panel">
                    <div class="log-header">
                        <h3 id="logTitle">📋 Logs (Select a track above)</h3>
                    </div>
                    <div class="log-list" id="logList">
                        <div class="log-empty">
                            <p>Click on a track in the timeline to view detailed logs</p>
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
}
