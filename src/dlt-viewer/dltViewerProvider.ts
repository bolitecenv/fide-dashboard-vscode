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
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DLT Timeline Viewer</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: hidden;
            height: 100vh;
        }

        .view-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .dlt-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .timeline-status {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 4px;
            background: var(--vscode-input-background);
            font-size: 13px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-errorForeground);
        }

        .status-indicator.connected .status-dot {
            background: var(--vscode-charts-green);
        }

        .timeline-controls {
            display: flex;
            gap: 10px;
        }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            transition: background 0.2s;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .dlt-main-layout {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .dlt-left-panel {
            width: 300px;
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            background: var(--vscode-sideBar-background);
        }

        .register-panel,
        .callgraph-panel {
            flex: 1;
            overflow-y: auto;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .callgraph-panel {
            border-bottom: none;
        }

        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .panel-header h3 {
            font-size: 13px;
            font-weight: 600;
            margin: 0;
        }

        .badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 600;
        }

        .register-list,
        .callgraph-list {
            padding: 10px;
        }

        .register-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 10px;
            margin-bottom: 5px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-charts-blue);
        }

        .register-name {
            font-weight: 600;
            font-size: 13px;
        }

        .register-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            color: var(--vscode-charts-orange);
        }

        .thread-stack {
            margin-bottom: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .thread-stack:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .thread-stack.selected {
            background: var(--vscode-list-activeSelectionBackground);
            border-left: 3px solid var(--vscode-focusBorder);
        }

        .thread-header {
            display: flex;
            justify-content: space-between;
            padding: 10px;
        }

        .thread-id {
            font-weight: 600;
            font-size: 13px;
        }

        .call-count {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .call-stack-view {
            padding: 0 10px 10px;
            border-top: 1px solid var(--vscode-panel-border);
            margin-top: 5px;
        }

        .call-item {
            padding: 6px 8px;
            margin-top: 5px;
            background: var(--vscode-editor-background);
            border-radius: 3px;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
        }

        .call-function {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-symbolIcon-functionForeground);
        }

        .call-time {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        .empty-message {
            text-align: center;
            padding: 30px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-message p {
            margin-bottom: 8px;
        }

        .hint {
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            opacity: 0.7;
        }

        .dlt-right-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .timeline-gantt-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            position: relative;
        }

        .empty-state {
            text-align: center;
            padding: 80px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
            font-size: 64px;
            margin-bottom: 20px;
            opacity: 0.5;
        }

        .empty-state h3 {
            font-size: 18px;
            margin-bottom: 10px;
        }

        .empty-state p {
            margin-bottom: 5px;
        }

        .timeline-ruler {
            margin-bottom: 20px;
        }

        .ruler-track {
            position: relative;
            height: 40px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .ruler-label {
            position: absolute;
            left: 0;
            top: 0;
            font-weight: 600;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .ruler-ticks {
            position: relative;
            height: 100%;
            margin-left: 50px;
        }

        .tick {
            position: absolute;
            top: 0;
            height: 100%;
            border-left: 1px solid var(--vscode-panel-border);
        }

        .tick-label {
            position: absolute;
            top: 22px;
            left: -20px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .timeline-tracks {
            margin-left: 50px;
        }

        .timeline-track {
            margin-bottom: 15px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .timeline-track.selected {
            background: var(--vscode-list-activeSelectionBackground);
            padding: 5px;
            margin: 0 -5px 15px -5px;
            border-radius: 4px;
        }

        .track-label {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            padding: 5px;
        }

        .track-id {
            font-weight: 600;
            font-size: 13px;
        }

        .track-count {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .track-timeline {
            position: relative;
            height: 30px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .trace-span {
            position: absolute;
            top: 2px;
            height: 26px;
            border-radius: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
        }

        .trace-span:hover {
            transform: scaleY(1.1);
            z-index: 100;
        }

        .span-label {
            font-size: 10px;
            color: white;
            font-weight: 600;
            text-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        .log-panel {
            height: 250px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
        }

        .log-header {
            padding: 12px 20px;
            background: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .log-header h3 {
            font-size: 13px;
            font-weight: 600;
            margin: 0;
        }

        .log-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px 20px;
        }

        .log-entry {
            display: flex;
            gap: 15px;
            padding: 8px;
            margin-bottom: 5px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-charts-blue);
        }

        .log-index {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            min-width: 40px;
        }

        .log-timestamp {
            color: var(--vscode-charts-orange);
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            min-width: 80px;
        }

        .log-duration {
            font-weight: 600;
            font-size: 12px;
            min-width: 80px;
        }

        .log-metadata {
            flex: 1;
            font-size: 12px;
        }

        .log-empty {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }

        .spinner {
            border: 3px solid var(--vscode-panel-border);
            border-top: 3px solid var(--vscode-focusBorder);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 15px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="view-container">
        <div class="dlt-toolbar">
            <div class="timeline-status">
                <div id="statusIndicator" class="status-indicator disconnected">
                    <span class="status-dot"></span>
                    <span id="statusText">Disconnected - ws://localhost:8083</span>
                </div>
            </div>

            <div class="timeline-controls">
                <button onclick="connectWebSocket()" id="connectBtn">
                    🔌 Connect
                </button>
                <button onclick="clearData()" class="secondary">
                    🗑️ Clear
                </button>
            </div>
        </div>

        <div class="dlt-main-layout">
            <!-- Left Panel: Registers and Call Graph -->
            <div class="dlt-left-panel">
                <!-- Register View -->
                <div class="register-panel">
                    <div class="panel-header">
                        <h3>📟 Registers</h3>
                        <span class="badge" id="registerCount">0</span>
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
            </div>
        </div>
    </div>

    <script>
        // State
        let ws = null;
        let wsConnected = false;
        let traceSpans = [];
        let registers = new Map();
        let callStacks = new Map();
        let selectedTrackId = null;
        let selectedThreadId = null;

        // Colors for different tasks
        const colors = [
            '#007acc', '#68217a', '#00897b', '#d14',
            '#f9a825', '#6a1b9a', '#0277bd', '#558b2f'
        ];
        let colorIndex = 0;
        const taskColors = new Map();

        function getTaskColor(taskId) {
            if (!taskColors.has(taskId)) {
                taskColors.set(taskId, colors[colorIndex % colors.length]);
                colorIndex++;
            }
            return taskColors.get(taskId);
        }

        // WebSocket connection
        function connectWebSocket() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
                return;
            }

            ws = new WebSocket('ws://localhost:8083');

            ws.onopen = () => {
                wsConnected = true;
                updateConnectionStatus();
                console.log('✅ Connected to WebSocket');
            };

            ws.onmessage = (event) => {
                handleMessage(event.data);
            };

            ws.onclose = () => {
                wsConnected = false;
                updateConnectionStatus();
                console.log('❌ Disconnected from WebSocket');
            };

            ws.onerror = (error) => {
                console.error('⚠️ WebSocket error:', error);
            };
        }

        function updateConnectionStatus() {
            const indicator = document.getElementById('statusIndicator');
            const statusText = document.getElementById('statusText');
            const connectBtn = document.getElementById('connectBtn');

            if (wsConnected) {
                indicator.classList.add('connected');
                indicator.classList.remove('disconnected');
                statusText.textContent = 'Connected - ws://localhost:8083';
                connectBtn.textContent = '🔌 Disconnect';
            } else {
                indicator.classList.add('disconnected');
                indicator.classList.remove('connected');
                statusText.textContent = 'Disconnected - ws://localhost:8083';
                connectBtn.textContent = '🔌 Connect';
            }
        }

        function handleMessage(message) {
            const parts = message.split(':');

            if (parts[0] === 'REG' && parts.length >= 3) {
                // Register update: REG:name:value
                const name = parts[1];
                const value = parts.slice(2).join(':');
                registers.set(name, { name, value });
                renderRegisters();
            } else if (parts.length === 4) {
                // Distinguish between trace and call graph by checking if parts[2] is 'start' or 'end'
                if (parts[2] === 'start' || parts[2] === 'end') {
                    // Trace event: ID:Timestamp:start|end:metadata
                    const id = parts[0];
                    const timestamp = parseFloat(parts[1]);
                    const type = parts[2];
                    const metadata = parts[3];
                    handleTraceEvent(id, timestamp, type, metadata);
                } else if (parts[3] === 'start' || parts[3] === 'end') {
                    // Call graph event: ThreadID:FunctionName:Timestamp:start|end
                    const threadId = parts[0];
                    const functionName = parts[1];
                    const timestamp = parseFloat(parts[2]);
                    const type = parts[3];
                    handleCallEvent(threadId, functionName, timestamp, type);
                }
            }
        }

        function handleTraceEvent(id, timestamp, type, metadata) {
            if (type === 'start') {
                // Create a pending span
                const span = {
                    id,
                    startTime: timestamp,
                    endTime: timestamp,
                    duration: 0,
                    metadata,
                    color: getTaskColor(id),
                    pending: true
                };
                traceSpans.push(span);
            } else if (type === 'end') {
                // Find the matching start event and update it
                const pendingSpan = traceSpans.find(s => s.id === id && s.pending);
                if (pendingSpan) {
                    pendingSpan.endTime = timestamp;
                    pendingSpan.duration = timestamp - pendingSpan.startTime;
                    pendingSpan.pending = false;
                }
            }

            renderTimeline();
        }

        function handleCallEvent(threadId, functionName, timestamp, type) {
            if (!callStacks.has(threadId)) {
                callStacks.set(threadId, {
                    threadId,
                    calls: [],
                    stack: []
                });
            }

            const threadData = callStacks.get(threadId);
            
            if (type === 'start') {
                const depth = threadData.stack.length;
                threadData.stack.push(functionName);
                threadData.calls.push({
                    functionName,
                    timestamp,
                    type: 'start',
                    depth
                });
            } else if (type === 'end') {
                threadData.stack.pop();
                threadData.calls.push({
                    functionName,
                    timestamp,
                    type: 'end'
                });
            }

            renderCallGraph();
        }

        function renderRegisters() {
            const registerList = document.getElementById('registerList');
            const registerCount = document.getElementById('registerCount');

            registerCount.textContent = registers.size;

            if (registers.size === 0) {
                registerList.innerHTML = \`
                    <div class="empty-message">
                        <p>No registers received</p>
                        <p class="hint">Format: REG:&lt;name&gt;:&lt;value&gt;</p>
                    </div>
                \`;
                return;
            }

            registerList.innerHTML = Array.from(registers.values())
                .map(reg => \`
                    <div class="register-item">
                        <div class="register-name">\${reg.name}</div>
                        <div class="register-value">\${reg.value}</div>
                    </div>
                \`)
                .join('');
        }

        function renderCallGraph() {
            const callGraphList = document.getElementById('callGraphList');
            const threadCount = document.getElementById('threadCount');

            threadCount.textContent = \`\${callStacks.size} threads\`;

            if (callStacks.size === 0) {
                callGraphList.innerHTML = \`
                    <div class="empty-message">
                        <p>No call events received</p>
                        <p class="hint">Format: &lt;ThreadID&gt;:&lt;Function&gt;:&lt;Time&gt;:&lt;start|end&gt;</p>
                    </div>
                \`;
                return;
            }

            callGraphList.innerHTML = Array.from(callStacks.values())
                .map(stack => {
                    const startCalls = stack.calls.filter(c => c.type === 'start');
                    const isSelected = selectedThreadId === stack.threadId;
                    
                    return \`
                        <div class="thread-stack \${isSelected ? 'selected' : ''}" 
                             onclick="toggleThread('\${stack.threadId}')">
                            <div class="thread-header">
                                <span class="thread-id">Thread \${stack.threadId}</span>
                                <span class="call-count">\${startCalls.length} calls</span>
                            </div>
                            \${isSelected ? \`
                                <div class="call-stack-view">
                                    \${startCalls.map(call => \`
                                        <div class="call-item" 
                                             style="margin-left: \${(call.depth || 0) * 20}px; width: calc(100% - \${(call.depth || 0) * 20}px)">
                                            <div class="call-function">\${call.functionName}</div>
                                            <div class="call-time">\${call.timestamp.toFixed(2)}ms</div>
                                        </div>
                                    \`).join('')}
                                </div>
                            \` : ''}
                        </div>
                    \`;
                })
                .join('');
        }

        function toggleThread(threadId) {
            selectedThreadId = selectedThreadId === threadId ? null : threadId;
            renderCallGraph();
        }

        function renderTimeline() {
            const container = document.getElementById('timelineContainer');

            if (traceSpans.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-icon">📡</div>
                        <h3>Waiting for trace data...</h3>
                        <p>Connect to WebSocket at port 8083</p>
                        <p class="hint">Format: &lt;ID&gt;:&lt;Timestamp&gt;:&lt;Start|End&gt;:&lt;metadata&gt;</p>
                    </div>
                \`;
                return;
            }

            // Calculate timeline bounds
            const completedSpans = traceSpans.filter(s => !s.pending);
            if (completedSpans.length === 0) return;

            const minTime = Math.min(...completedSpans.map(s => s.startTime));
            const maxTime = Math.max(...completedSpans.map(s => s.endTime));
            const timeRange = maxTime - minTime || 1000;

            // Group spans by ID for tracks
            const tracks = new Map();
            completedSpans.forEach(span => {
                if (!tracks.has(span.id)) {
                    tracks.set(span.id, []);
                }
                tracks.get(span.id).push(span);
            });

            const getXPosition = (timestamp) => {
                return ((timestamp - minTime) / timeRange) * 100;
            };

            const getWidth = (duration) => {
                return (duration / timeRange) * 100;
            };

            // Render timeline ruler
            let rulerHTML = \`
                <div class="timeline-ruler">
                    <div class="ruler-track">
                        <div class="ruler-label">Time</div>
                        <div class="ruler-ticks">
                            \${Array.from({ length: 10 }, (_, i) => {
                                const time = minTime + (timeRange * i / 9);
                                return \`
                                    <div class="tick" style="left: \${(i / 9) * 100}%">
                                        <div class="tick-label">
                                            \${time > 1000 ? (time / 1000).toFixed(2) + 's' : time.toFixed(0) + 'ms'}
                                        </div>
                                    </div>
                                \`;
                            }).join('')}
                        </div>
                    </div>
                </div>
            \`;

            // Render tracks
            let tracksHTML = \`<div class="timeline-tracks">\`;
            tracks.forEach((spans, trackId) => {
                const isSelected = selectedTrackId === trackId;
                tracksHTML += \`
                    <div class="timeline-track \${isSelected ? 'selected' : ''}" 
                         onclick="selectTrack('\${trackId}')">
                        <div class="track-label">
                            <div class="track-id">\${trackId}</div>
                            <div class="track-count">\${spans.length} spans</div>
                        </div>
                        <div class="track-timeline">
                            \${spans.map((span, idx) => {
                                const left = getXPosition(span.startTime);
                                const width = getWidth(span.duration);
                                return \`
                                    <div class="trace-span"
                                         style="left: \${left}%; width: \${Math.max(width, 0.5)}%; background-color: \${span.color};"
                                         title="\${span.metadata}\\nDuration: \${span.duration.toFixed(2)}ms\\nStart: \${span.startTime.toFixed(2)}">
                                        \${width > 5 ? \`<span class="span-label">\${span.duration.toFixed(1)}ms</span>\` : ''}
                                    </div>
                                \`;
                            }).join('')}
                        </div>
                    </div>
                \`;
            });
            tracksHTML += '</div>';

            container.innerHTML = rulerHTML + tracksHTML;

            // Update logs if a track is selected
            if (selectedTrackId && tracks.has(selectedTrackId)) {
                renderLogs(tracks.get(selectedTrackId));
            }
        }

        function selectTrack(trackId) {
            selectedTrackId = trackId;
            renderTimeline();
        }

        function renderLogs(spans) {
            const logList = document.getElementById('logList');
            const logTitle = document.getElementById('logTitle');

            if (!spans || spans.length === 0) {
                logList.innerHTML = \`
                    <div class="log-empty">
                        <p>Click on a track in the timeline to view detailed logs</p>
                    </div>
                \`;
                logTitle.textContent = '📋 Logs (Select a track above)';
                return;
            }

            logTitle.textContent = \`📋 Logs: \${selectedTrackId}\`;
            
            logList.innerHTML = spans
                .map((span, idx) => \`
                    <div class="log-entry">
                        <div class="log-index">#\${idx + 1}</div>
                        <div class="log-timestamp">\${span.startTime.toFixed(2)}ms</div>
                        <div class="log-duration" style="color: \${span.color}">
                            ⏱ \${span.duration.toFixed(2)}ms
                        </div>
                        <div class="log-metadata">\${span.metadata}</div>
                    </div>
                \`)
                .join('');
        }

        function clearData() {
            traceSpans = [];
            registers.clear();
            callStacks.clear();
            selectedTrackId = null;
            selectedThreadId = null;
            taskColors.clear();
            colorIndex = 0;

            renderRegisters();
            renderCallGraph();
            renderTimeline();
            renderLogs(null);
        }

        // Auto-connect on load
        window.addEventListener('load', () => {
            setTimeout(() => {
                connectWebSocket();
            }, 500);
        });
    </script>
</body>
</html>`;
    }
}
