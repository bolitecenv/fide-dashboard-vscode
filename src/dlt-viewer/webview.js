// VS Code API
const vscode = acquireVsCodeApi();

// State
let ws = null;
let wsConnected = false;
let traceSpans = [];
let registers = new Map();
let callStacks = new Map();
let selectedTrackId = null;
let selectedThreadId = null;
let timelineView = 'trace'; // 'trace', 'calls', or 'charts'

// Configuration
let wsPort = 8083;
let packetType = 'text'; // 'text' or 'dlt'

// DLT Packet Buffer and Statistics
let dltPacketBuffer = new Uint8Array(0); // Buffer for incomplete DLT packets
let dltMessagesReceived = 0; // Total DLT messages successfully parsed
let dltMessagesIncorrect = 0; // Total DLT messages with errors

// Chart data
let charts = [];
let chartDataSeries = new Map(); // Map<chartId, Map<name, Array<{x, y}>>>
let nextChartId = 1;

// Zoom and Pan state
let zoomLevel = 1; // 1 = 100%, 2 = 200%, etc.
let panOffset = 0; // Horizontal pan offset as percentage
let isPanning = false;
let panStartX = 0;
let panStartOffset = 0;
let currentTimelineElement = null;

// Event handlers stored for cleanup
let mouseMoveHandler = null;
let mouseUpHandler = null;
let regionMouseMoveHandler = null;
let regionMouseUpHandler = null;

// Region selection state
let isSelectingRegion = false;
let regionSelectStart = null;
let regionSelectEnd = null;
let selectedRegion = null; // { startTime: number, endTime: number }

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

// WebSocket configuration
function toggleConfig() {
    const panel = document.getElementById('configPanel');
    panel.classList.toggle('active');
}

function applyConfig() {
    wsPort = parseInt(document.getElementById('wsPort').value);
    packetType = document.getElementById('packetType').value;
    
    toggleConfig();
    
    // Reconnect with new settings
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    setTimeout(() => connectWebSocket(), 100);
}

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        return;
    }

    const wsUrl = `ws://localhost:${wsPort}`;
    ws = new WebSocket(wsUrl);
    
    // Set binary type to arraybuffer for DLT binary packets
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        wsConnected = true;
        updateConnectionStatus();
        console.log(`✅ Connected to ${wsUrl}`);
    };

    ws.onmessage = (event) => {
        if (packetType === 'text') {
            handleMessage(event.data);
        } else {
            // event.data will be ArrayBuffer when binaryType = 'arraybuffer'
            handleDltBinaryMessage(event.data);
        }
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
        statusText.textContent = `Connected - ws://localhost:${wsPort} (${packetType})`;
        connectBtn.textContent = '🔌 Disconnect';
    } else {
        indicator.classList.add('disconnected');
        indicator.classList.remove('connected');
        statusText.textContent = `Disconnected - ws://localhost:${wsPort}`;
        connectBtn.textContent = '🔌 Connect';
    }
}

function handleMessage(message) {
    const parts = message.split(':');

    if (parts[0] === 'REG' && parts.length >= 3) {
        // Register update: REG:name:value or REG:timestamp:name:value
        let name, value, timestamp;
        
        if (parts.length >= 4 && !isNaN(parseFloat(parts[1]))) {
            // Format: REG:timestamp:name:value
            timestamp = parts[1];
            name = parts[2];
            value = parts.slice(3).join(':');
        } else {
            // Format: REG:name:value
            name = parts[1];
            value = parts.slice(2).join(':');
            timestamp = new Date().toISOString();
        }
        
        registers.set(name, { name, value, timestamp });
        renderRegisters();
    } else if (parts.length === 3) {
        // Chart data: Name:Timestamp:Value
        const name = parts[0];
        const timestamp = parseFloat(parts[1]);
        const value = parseFloat(parts[2]);
        
        if (!isNaN(timestamp) && !isNaN(value)) {
            handleChartData(name, timestamp, value);
        }
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

/**
 * Parse DLT binary packet
 * @param {Uint8Array} packet - Complete DLT packet data
 * @returns {Object|null} Parsed DLT message or null if invalid
 * 
 * DLT Standard Header (4 bytes):
 *   - HTYP (1 byte): Header Type
 *   - MCNT (1 byte): Message Counter
 *   - LEN (2 bytes): Length of complete packet
 * 
 * This function will be replaced with WASM parser implementation
 */
function parseDltPacket(packet) {
    // TODO: WASM parser will be integrated here
    // For now, this is a placeholder that validates minimum header
    
    if (packet.length < 4) {
        return null; // Not enough data for standard header
    }
    
    // Read packet length from bytes 2-3 (big-endian)
    const packetLength = (packet[2] << 8) | packet[3];
    
    if (packet.length !== packetLength) {
        return null; // Packet length mismatch
    }
    
    // Extract basic header info
    const htyp = packet[0];
    const mcnt = packet[1];
    
    // Convert to hex string for debugging
    const hexDump = Array.from(packet.slice(0, Math.min(32, packet.length)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    // WASM parser will return structured data:
    // {
    //   timestamp: number,
    //   appId: string,
    //   contextId: string,
    //   messageType: string,
    //   payload: string
    // }
    
    return {
        timestamp: Date.now(),
        appId: 'UNKNOWN',
        contextId: 'UNKNOWN',
        messageType: 'INFO',
        htyp: `0x${htyp.toString(16).padStart(2, '0')}`,
        mcnt: mcnt,
        length: packetLength,
        payload: `DLT packet [HTYP:0x${htyp.toString(16)}, MCNT:${mcnt}, LEN:${packetLength}] - First bytes: ${hexDump}${packet.length > 32 ? '...' : ''}`
    };
}

/**
 * Update DLT statistics display in the UI
 */
function updateDltStats() {
    const receivedEl = document.getElementById('dltReceivedCount');
    const incorrectEl = document.getElementById('dltIncorrectCount');
    
    if (receivedEl) {
        receivedEl.textContent = dltMessagesReceived;
    }
    if (incorrectEl) {
        incorrectEl.textContent = dltMessagesIncorrect;
    }
}

function handleDltBinaryMessage(data) {
    // Handle different data types that might come from WebSocket
    let arrayBuffer;
    
    if (data instanceof ArrayBuffer) {
        arrayBuffer = data;
    } else if (data instanceof Blob) {
        // If somehow we still get a Blob, convert it (shouldn't happen with binaryType='arraybuffer')
        console.warn('⚠️ Received Blob instead of ArrayBuffer, converting...');
        const reader = new FileReader();
        reader.onload = () => handleDltBinaryMessage(reader.result);
        reader.readAsArrayBuffer(data);
        return;
    } else if (typeof data === 'string') {
        // If we get string data in DLT mode, something is wrong with config
        console.error('❌ Received text data in DLT binary mode. Check packetType configuration.');
        return;
    } else {
        console.error('❌ Unknown data type received:', typeof data);
        return;
    }
    
    // Append incoming data to buffer
    const newData = new Uint8Array(arrayBuffer);
    const combinedBuffer = new Uint8Array(dltPacketBuffer.length + newData.length);
    combinedBuffer.set(dltPacketBuffer, 0);
    combinedBuffer.set(newData, dltPacketBuffer.length);
    dltPacketBuffer = combinedBuffer;
    
    console.log(`📦 Added ${newData.length} bytes to buffer, total buffer size: ${dltPacketBuffer.length} bytes`);
    
    // Process all complete packets in buffer
    while (dltPacketBuffer.length >= 4) {
        // Read packet length from DLT standard header (bytes 2-3, big-endian)
        const packetLength = (dltPacketBuffer[2] << 8) | dltPacketBuffer[3];
        
        console.log(`🔍 Buffer has ${dltPacketBuffer.length} bytes, next packet expects ${packetLength} bytes`);
        
        // Validate packet length (sanity check: between 4 and 65535 bytes)
        if (packetLength < 4 || packetLength > 65535) {
            console.error('❌ Invalid DLT packet length:', packetLength);
            dltMessagesIncorrect++;
            updateDltStats();
            // Discard invalid header and try to find next valid packet
            dltPacketBuffer = dltPacketBuffer.slice(1);
            continue;
        }
        
        // Check if we have enough data for complete packet
        if (dltPacketBuffer.length < packetLength) {
            // Not enough data yet, wait for next WebSocket message
            console.log(`⏳ Waiting for more data: have ${dltPacketBuffer.length}, need ${packetLength}`);
            break;
        }
        
        // Extract complete packet
        const packet = dltPacketBuffer.slice(0, packetLength);
        dltPacketBuffer = dltPacketBuffer.slice(packetLength);
        
        console.log(`✂️ Extracted complete packet (${packetLength} bytes), remaining buffer: ${dltPacketBuffer.length} bytes`);
        
        // Parse the packet (WASM parser will be used here)
        try {
            const parsedMessage = parseDltPacket(packet);
            
            if (parsedMessage) {
                dltMessagesReceived++;
                updateDltStats();
                
                // Process the parsed DLT message
                // For now, just log it (will be integrated with timeline/trace view)
                console.log('✅ DLT Message:', parsedMessage);
                
                // You can route this to trace timeline, logs, or other views
                // handleMessage(parsedMessage.payload);
            } else {
                dltMessagesIncorrect++;
                updateDltStats();
                console.error('❌ Failed to parse DLT packet');
            }
        } catch (error) {
            dltMessagesIncorrect++;
            updateDltStats();
            console.error('❌ Error parsing DLT packet:', error);
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
        registerList.innerHTML = `
            <div class="empty-message">
                <p>No registers received</p>
                <p class="hint">Format: REG:&lt;name&gt;:&lt;value&gt;</p>
            </div>
        `;
        return;
    }

    registerList.innerHTML = Array.from(registers.values())
        .map(reg => `
            <div class="register-item">
                <div class="register-name">${reg.name}</div>
                <div class="register-value">${reg.value}</div>
            </div>
        `)
        .join('');
}

function exportRegisters() {
    if (registers.size === 0) {
        vscode.postMessage({
            command: 'showMessage',
            type: 'warning',
            message: 'No registers to export'
        });
        return;
    }

    const timestamp = new Date().toISOString();
    let logContent = `# Register Log Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    logContent += `# Total Registers: ${registers.size}\n\n`;

    Array.from(registers.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(reg => {
            logContent += `${reg.timestamp || timestamp} | ${reg.name.padEnd(30)} | ${reg.value}\n`;
        });

    vscode.postMessage({
        command: 'exportRegisters',
        content: logContent
    });
}

function renderCallGraph() {
    const callGraphList = document.getElementById('callGraphList');
    const threadCount = document.getElementById('threadCount');

    threadCount.textContent = `${callStacks.size} threads`;

    if (callStacks.size === 0) {
        callGraphList.innerHTML = `
            <div class="empty-message">
                <p>No call events received</p>
                <p class="hint">Format: &lt;ThreadID&gt;:&lt;Function&gt;:&lt;Time&gt;:&lt;start|end&gt;</p>
            </div>
        `;
        return;
    }

    callGraphList.innerHTML = Array.from(callStacks.values())
        .map(stack => {
            const isSelected = selectedThreadId === stack.threadId;
            
            // Count completed calls
            const callStack = [];
            let completedCalls = 0;
            
            stack.calls.forEach(call => {
                if (call.type === 'start') {
                    callStack.push(call.functionName);
                } else if (call.type === 'end') {
                    if (callStack.length > 0) {
                        callStack.pop();
                        completedCalls++;
                    }
                }
            });

            return `
                <div class="thread-list-item ${isSelected ? 'selected' : ''}" 
                     onclick="selectThread('${stack.threadId}', event)">
                    <div class="thread-name">Thread ${stack.threadId}</div>
                    <div class="thread-stats">${completedCalls} calls</div>
                </div>
            `;
        })
        .join('');
}

function selectThread(threadId, event) {
    // Don't select thread if shift key is pressed (for region selection)
    if (event && event.shiftKey) {
        return;
    }
    selectedThreadId = threadId;
    renderCallGraph();
    if (timelineView === 'calls') {
        renderTimeline();
    }
}

function setTimelineView(view) {
    timelineView = view;
    
    // Update button states
    document.getElementById('traceViewBtn').classList.toggle('active', view === 'trace');
    document.getElementById('callViewBtn').classList.toggle('active', view === 'calls');
    document.getElementById('chartViewBtn').classList.toggle('active', view === 'charts');
    
    // Show/hide appropriate containers
    document.getElementById('timelineContainer').style.display = view !== 'charts' ? 'block' : 'none';
    document.getElementById('chartContainer').style.display = view === 'charts' ? 'block' : 'none';
    
    if (view === 'charts') {
        renderAllCharts();
    } else {
        renderTimeline();
    }
}

function renderTimeline() {
    if (timelineView === 'trace') {
        renderTraceTimeline();
    } else {
        renderCallStackTimeline();
    }
}

function renderTraceTimeline() {
    const container = document.getElementById('timelineContainer');

    if (traceSpans.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📡</div>
                <h3>Waiting for trace data...</h3>
                <p>Connect to WebSocket at port 8083</p>
                <p class="hint">Format: &lt;ID&gt;:&lt;Timestamp&gt;:&lt;Start|End&gt;:&lt;metadata&gt;</p>
            </div>
        `;
        return;
    }

    // Calculate timeline bounds
    const completedSpans = traceSpans.filter(s => !s.pending);
    if (completedSpans.length === 0) return;

    const minTime = Math.min(...completedSpans.map(s => s.startTime));
    const maxTime = Math.max(...completedSpans.map(s => s.endTime));
    const baseTimeRange = maxTime - minTime || 1000;
    
    // Apply zoom and pan
    const timeRange = baseTimeRange / zoomLevel;
    const visibleMinTime = minTime + (baseTimeRange * panOffset / 100);
    const visibleMaxTime = visibleMinTime + timeRange;

    // Group spans by ID for tracks
    const tracks = new Map();
    completedSpans.forEach(span => {
        if (!tracks.has(span.id)) {
            tracks.set(span.id, []);
        }
        tracks.get(span.id).push(span);
    });

    const getXPosition = (timestamp) => {
        return ((timestamp - visibleMinTime) / timeRange) * 100;
    };

    const getWidth = (duration) => {
        return (duration / timeRange) * 100;
    };

    // Render timeline ruler with left padding for labels
    let rulerHTML = `
        <div class="timeline-ruler">
            <div class="ruler-track">
                <div class="ruler-label-spacer" style="width: 150px; flex-shrink: 0;"></div>
                <div id="rulerContent" class="ruler-content" style="flex: 1; position: relative; cursor: crosshair;" data-min-time="${visibleMinTime}" data-max-time="${visibleMaxTime}">
                    <div class="ruler-label" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                        Time
                        ${zoomLevel > 1 ? `<span style="font-size: 10px; opacity: 0.7;"> (${zoomLevel.toFixed(1)}x)</span>` : ''}
                        ${selectedRegion ? `<span style="font-size: 10px; color: var(--vscode-charts-blue);"> [${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms]</span>` : ''}
                    </div>
                    ${selectedRegion ? `<div class="region-overlay" style="position: absolute; top: 0; left: ${getXPosition(selectedRegion.startTime)}%; width: ${getXPosition(selectedRegion.endTime) - getXPosition(selectedRegion.startTime)}%; height: 100%; background: rgba(0, 122, 204, 0.2); border-left: 2px solid var(--vscode-charts-blue); border-right: 2px solid var(--vscode-charts-blue); pointer-events: none;"></div>` : ''}
                    <div class="ruler-ticks" style="pointer-events: none;">
                        ${Array.from({ length: 10 }, (_, i) => {
                            const time = visibleMinTime + (timeRange * i / 9);
                            return `
                                <div class="tick" style="left: ${(i / 9) * 100}%">
                                    <div class="tick-label">
                                        ${time > 1000 ? (time / 1000).toFixed(2) + 's' : time.toFixed(0) + 'ms'}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Render tracks with labels on the left
    let tracksHTML = `<div class="timeline-tracks-wrapper" style="display: flex;">
        <div class="track-labels" style="width: 150px; flex-shrink: 0; background: var(--vscode-sideBar-background); border-right: 1px solid var(--vscode-panel-border);">`;
    
    tracks.forEach((spans, trackId) => {
        const isSelected = selectedTrackId === trackId;
        tracksHTML += `
            <div class="track-label-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectTrack('${trackId}', event)"
                 style="padding: 15px 10px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer;">
                <div class="track-id" style="font-weight: 600; font-size: 12px;">${trackId}</div>
                <div class="track-count" style="font-size: 10px; color: var(--vscode-descriptionForeground);">${spans.length} spans</div>
            </div>
        `;
    });
    
    tracksHTML += `</div><div class="timeline-tracks" id="timelineTracks" style="flex: 1;">`;
    
    tracks.forEach((spans, trackId) => {
        const isSelected = selectedTrackId === trackId;
        tracksHTML += `
            <div class="timeline-track ${isSelected ? 'selected' : ''}" 
                 onclick="selectTrack('${trackId}', event)"
                 style="margin-bottom: 0; border-bottom: 1px solid var(--vscode-panel-border); padding: 15px 0;">
                <div class="track-timeline">
                    ${spans.filter(span => {
                        // Only render visible spans
                        return span.endTime >= visibleMinTime && span.startTime <= visibleMaxTime;
                    }).map((span, idx) => {
                        const left = getXPosition(span.startTime);
                        const width = getWidth(span.duration);
                        return `
                            <div class="trace-span"
                                 style="left: ${left}%; width: ${Math.max(width, 0.5)}%; background-color: ${span.color};"
                                 title="${span.metadata}\\nDuration: ${span.duration.toFixed(2)}ms\\nStart: ${span.startTime.toFixed(2)}">
                                ${width > 5 ? `<span class="span-label">${span.duration.toFixed(1)}ms</span>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });
    tracksHTML += '</div></div>';

    container.innerHTML = rulerHTML + tracksHTML;
    
    // Attach zoom and pan event listeners
    attachTimelineInteractions();

    // Update logs if a track is selected
    if (selectedTrackId && tracks.has(selectedTrackId)) {
        renderLogs(tracks.get(selectedTrackId));
    }
}

function renderCallStackTimeline() {
    const container = document.getElementById('timelineContainer');

    if (callStacks.size === 0 || !selectedThreadId) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📞</div>
                <h3>${callStacks.size === 0 ? 'Waiting for call data...' : 'Select a thread'}</h3>
                <p>${callStacks.size === 0 ? 'Call events will appear here' : 'Click a thread in the Call Graph panel'}</p>
            </div>
        `;
        return;
    }

    const threadData = callStacks.get(selectedThreadId);
    if (!threadData) return;

    // Build call blocks with start/end pairs
    const callBlocks = [];
    const callStack = [];
    
    threadData.calls.forEach(call => {
        if (call.type === 'start') {
            callStack.push({
                functionName: call.functionName,
                startTime: call.timestamp,
                depth: call.depth
            });
        } else if (call.type === 'end') {
            // Find matching start
            for (let i = callStack.length - 1; i >= 0; i--) {
                if (callStack[i].functionName === call.functionName) {
                    const startCall = callStack.splice(i, 1)[0];
                    callBlocks.push({
                        functionName: call.functionName,
                        startTime: startCall.startTime,
                        endTime: call.timestamp,
                        duration: call.timestamp - startCall.startTime,
                        depth: startCall.depth
                    });
                    break;
                }
            }
        }
    });

    if (callBlocks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⏳</div>
                <h3>Waiting for completed calls...</h3>
                <p>Thread ${selectedThreadId} has no completed function calls yet</p>
            </div>
        `;
        return;
    }

    // Calculate timeline bounds
    let minTime = Infinity;
    let maxTime = -Infinity;
    callBlocks.forEach(block => {
        minTime = Math.min(minTime, block.startTime);
        maxTime = Math.max(maxTime, block.endTime);
    });
    const baseTimeRange = maxTime - minTime || 100;
    
    // Apply zoom and pan
    const timeRange = baseTimeRange / zoomLevel;
    const visibleMinTime = minTime + (baseTimeRange * panOffset / 100);
    const visibleMaxTime = visibleMinTime + timeRange;

    // Calculate max depth for height
    const maxDepth = Math.max(...callBlocks.map(b => b.depth), 0);
    const rowHeight = 30;
    const timelineHeight = (maxDepth + 1) * rowHeight + 40;

    const getXPosition = (timestamp) => {
        return ((timestamp - visibleMinTime) / timeRange) * 100;
    };

    const getWidth = (duration) => {
        return (duration / timeRange) * 100;
    };

    // Render timeline ruler
    let rulerHTML = `
        <div class="timeline-ruler">
            <div class="ruler-track">
                <div class="ruler-label-spacer" style="width: 150px; flex-shrink: 0;"></div>
                <div id="rulerContent" class="ruler-content" style="flex: 1; position: relative; cursor: crosshair;" data-min-time="${visibleMinTime}" data-max-time="${visibleMaxTime}">
                    <div class="ruler-label" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                        Time
                        ${zoomLevel > 1 ? `<span style="font-size: 10px; opacity: 0.7;"> (${zoomLevel.toFixed(1)}x)</span>` : ''}
                        ${selectedRegion ? `<span style="font-size: 10px; color: var(--vscode-charts-blue);"> [${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms]</span>` : ''}
                    </div>
                    ${selectedRegion ? `<div class="region-overlay" style="position: absolute; top: 0; left: ${getXPosition(selectedRegion.startTime)}%; width: ${getXPosition(selectedRegion.endTime) - getXPosition(selectedRegion.startTime)}%; height: 100%; background: rgba(0, 122, 204, 0.2); border-left: 2px solid var(--vscode-charts-blue); border-right: 2px solid var(--vscode-charts-blue); pointer-events: none;"></div>` : ''}
                    <div class="ruler-ticks" style="pointer-events: none;">
                        ${Array.from({ length: 10 }, (_, i) => {
                            const time = visibleMinTime + (timeRange * i / 9);
                            return `
                                <div class="tick" style="left: ${(i / 9) * 100}%">
                                    <div class="tick-label">
                                        ${time > 1000 ? (time / 1000).toFixed(2) + 's' : time.toFixed(0) + 'ms'}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Build depth labels with function names at each level
    const depthLabels = new Map();
    callBlocks.forEach(block => {
        if (!depthLabels.has(block.depth)) {
            depthLabels.set(block.depth, block.functionName);
        }
    });

    // Render call blocks with depth labels on the left
    let callsHTML = `
        <div id="callTimelineWrapper" style="position: relative; height: ${timelineHeight}px; margin-bottom: 20px; display: flex;">
            <div class="call-depth-labels" style="width: 150px; position: relative; height: 100%; flex-shrink: 0;">
                ${Array.from(depthLabels.entries()).map(([depth, funcName]) => {
                    const top = depth * rowHeight + 10;
                    return `
                        <div class="depth-label" style="position: absolute; top: ${top}px; height: ${rowHeight - 4}px; line-height: ${rowHeight - 4}px; padding: 0 10px; font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" title="Depth ${depth}: ${funcName}">
                            ${funcName}
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="call-timeline" style="height: 100%; flex: 1;">
                ${callBlocks.filter(block => {
                    // Only render visible blocks
                    return block.endTime >= visibleMinTime && block.startTime <= visibleMaxTime;
                }).map(block => {
                    const left = getXPosition(block.startTime);
                    const width = getWidth(block.duration);
                    const top = block.depth * rowHeight + 10;
                    
                    return `
                        <div class="call-block depth-${block.depth % 5}"
                             style="left: ${left}%; width: ${Math.max(width, 2)}%; top: ${top}px; height: ${rowHeight - 4}px"
                             title="${block.functionName}\\nDuration: ${block.duration.toFixed(2)}ms\\nStart: ${block.startTime.toFixed(2)}ms">
                            ${block.functionName}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    container.innerHTML = `
        <h3 style="margin: 20px; color: var(--vscode-foreground);">Thread ${selectedThreadId} - ${callBlocks.length} function calls</h3>
        ${rulerHTML}
        ${callsHTML}
    `;
    
    // Attach zoom and pan event listeners
    attachTimelineInteractions();
}

// Zoom and Pan functions
function attachTimelineInteractions() {
    const tracksElement = document.getElementById('timelineTracks') || document.getElementById('callTimelineWrapper');
    if (!tracksElement) return;

    // Clean up old event listeners from previous render
    if (mouseMoveHandler) {
        document.removeEventListener('mousemove', mouseMoveHandler);
        mouseMoveHandler = null;
    }
    if (mouseUpHandler) {
        document.removeEventListener('mouseup', mouseUpHandler);
        mouseUpHandler = null;
    }
    if (regionMouseMoveHandler) {
        document.removeEventListener('mousemove', regionMouseMoveHandler);
        regionMouseMoveHandler = null;
    }
    if (regionMouseUpHandler) {
        document.removeEventListener('mouseup', regionMouseUpHandler);
        regionMouseUpHandler = null;
    }

    // Store current element
    currentTimelineElement = tracksElement;

    // Scroll to zoom
    tracksElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(1, Math.min(20, zoomLevel * delta));
        
        if (newZoom !== zoomLevel) {
            // Adjust pan offset to zoom toward cursor position
            const rect = tracksElement.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / rect.width;
            const oldPanOffset = panOffset;
            
            // Calculate new pan offset to keep the point under cursor stable
            panOffset = oldPanOffset + (mouseX * 100 * (1 - zoomLevel / newZoom));
            panOffset = Math.max(0, Math.min(100 * (newZoom - 1), panOffset));
            
            zoomLevel = newZoom;
            renderTimeline();
        }
    }, { passive: false });

    // Pan with mouse drag - only on timeline area, not on track labels
    tracksElement.addEventListener('mousedown', (e) => {
        // Check if we're clicking on the timeline area (not on labels)
        const target = e.target;
        const isTimelineArea = target.classList.contains('call-timeline') || 
                              target.classList.contains('track-timeline') ||
                              target.closest('.call-timeline') ||
                              target.closest('.track-timeline');
        
        if (e.button === 0 && isTimelineArea) { // Left mouse button on timeline area
            e.preventDefault(); // Prevent text selection
            isPanning = true;
            panStartX = e.clientX;
            panStartOffset = panOffset;
            tracksElement.style.cursor = 'grabbing';
        }
    });

    // Create and store mouse move handler
    mouseMoveHandler = (e) => {
        if (isPanning && currentTimelineElement) {
            const rect = currentTimelineElement.getBoundingClientRect();
            const deltaX = e.clientX - panStartX;
            const deltaPercent = (deltaX / rect.width) * 100;
            
            // Adjust pan speed based on zoom level - slower when zoomed in
            // At zoom 1x: normal speed, at zoom 10x: 10x slower
            const adjustedDelta = deltaPercent * (zoomLevel - 1);
            
            // Invert direction for natural panning
            panOffset = panStartOffset - adjustedDelta;
            panOffset = Math.max(0, Math.min(100 * (zoomLevel - 1), panOffset));
            
            renderTimeline();
        }
    };
    document.addEventListener('mousemove', mouseMoveHandler);

    // Create and store mouse up handler
    mouseUpHandler = () => {
        if (isPanning && currentTimelineElement) {
            isPanning = false;
            currentTimelineElement.style.cursor = 'grab';
        }
    };
    document.addEventListener('mouseup', mouseUpHandler);

    tracksElement.addEventListener('mouseleave', () => {
        if (isPanning) {
            isPanning = false;
            tracksElement.style.cursor = 'grab';
        }
    });

    // Double-click to reset zoom
    tracksElement.addEventListener('dblclick', () => {
        resetZoom();
    });
    
    // Add region selection on ruler (Shift + Click and drag)
    const rulerContent = document.getElementById('rulerContent');
    if (rulerContent) {
        rulerContent.addEventListener('mousedown', (e) => {
            if (e.shiftKey && e.button === 0) {
                e.preventDefault();
                e.stopPropagation();
                isSelectingRegion = true;
                
                const rect = rulerContent.getBoundingClientRect();
                const clickX = (e.clientX - rect.left) / rect.width;
                const minTime = parseFloat(rulerContent.dataset.minTime);
                const maxTime = parseFloat(rulerContent.dataset.maxTime);
                const timeRange = maxTime - minTime;
                
                regionSelectStart = minTime + (clickX * timeRange);
                regionSelectEnd = regionSelectStart;
            }
        });
        
        regionMouseMoveHandler = (e) => {
            if (isSelectingRegion) {
                e.preventDefault();
                const rulerContent = document.getElementById('rulerContent');
                if (!rulerContent) return;
                
                const rect = rulerContent.getBoundingClientRect();
                const clickX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const minTime = parseFloat(rulerContent.dataset.minTime);
                const maxTime = parseFloat(rulerContent.dataset.maxTime);
                const timeRange = maxTime - minTime;
                
                regionSelectEnd = minTime + (clickX * timeRange);
                
                // Update visual feedback (temporary overlay)
                const start = Math.min(regionSelectStart, regionSelectEnd);
                const end = Math.max(regionSelectStart, regionSelectEnd);
                selectedRegion = { startTime: start, endTime: end };
                renderTimeline();
            }
        };
        document.addEventListener('mousemove', regionMouseMoveHandler);
        
        regionMouseUpHandler = () => {
            if (isSelectingRegion) {
                isSelectingRegion = false;
                
                if (regionSelectStart && regionSelectEnd && Math.abs(regionSelectEnd - regionSelectStart) > 1) {
                    const start = Math.min(regionSelectStart, regionSelectEnd);
                    const end = Math.max(regionSelectStart, regionSelectEnd);
                    selectedRegion = { startTime: start, endTime: end };
                    document.getElementById('clearRegionBtn').style.display = 'inline-block';
                } else {
                    selectedRegion = null;
                    document.getElementById('clearRegionBtn').style.display = 'none';
                }
                
                regionSelectStart = null;
                regionSelectEnd = null;
                renderTimeline();
            }
        };
        document.addEventListener('mouseup', regionMouseUpHandler);
    }
}

function resetZoom() {
    zoomLevel = 1;
    panOffset = 0;
    renderTimeline();
}

function selectTrack(trackId, event) {
    // Don't select track if shift key is pressed (for region selection)
    if (event && event.shiftKey) {
        return;
    }
    selectedTrackId = trackId;
    renderTimeline();
}

function selectThread(threadId, event) {
    // Don't select thread if shift key is pressed (for region selection)
    if (event && event.shiftKey) {
        return;
    }
    selectedThreadId = threadId;
    renderCallGraph();
    if (timelineView === 'calls') {
        renderTimeline();
    }
}

function renderLogs(spans) {
    const logList = document.getElementById('logList');
    const logTitle = document.getElementById('logTitle');

    if (!spans || spans.length === 0) {
        logList.innerHTML = `
            <div class="log-empty">
                <p>Click on a track in the timeline to view detailed logs</p>
            </div>
        `;
        logTitle.textContent = '📋 Logs (Select a track above)';
        return;
    }

    logTitle.textContent = `📋 Logs: ${selectedTrackId}`;
    
    logList.innerHTML = spans
        .map((span, idx) => `
            <div class="log-entry">
                <div class="log-index">#${idx + 1}</div>
                <div class="log-timestamp">${span.startTime.toFixed(2)}ms</div>
                <div class="log-duration" style="color: ${span.color}">
                    ⏱ ${span.duration.toFixed(2)}ms
                </div>
                <div class="log-metadata">${span.metadata}</div>
            </div>
        `)
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
    charts = [];
    chartDataSeries.clear();
    
    // Reset zoom and pan
    zoomLevel = 1;
    panOffset = 0;

    renderRegisters();
    renderCallGraph();
    renderTimeline();
    renderLogs(null);
    renderAllCharts();
}

// Chart functions
function handleChartData(name, timestamp, value) {
    // Store data for all configured charts
    charts.forEach(chart => {
        const seriesKey = `${chart.id}:${name}`;
        if (!chartDataSeries.has(seriesKey)) {
            chartDataSeries.set(seriesKey, []);
        }
        
        const series = chartDataSeries.get(seriesKey);
        series.push({ x: timestamp, y: value, name });
        
        // Keep last 100 points
        if (series.length > 100) {
            series.shift();
        }
    });

    // Render charts in real-time
    if (timelineView === 'charts') {
        renderAllCharts();
    }
}

function addChart() {
    const chart = {
        id: nextChartId++,
        title: `Chart ${nextChartId - 1}`,
        nameFilter: '',
        minY: 'auto',
        maxY: 'auto',
        color: colors[(nextChartId - 1) % colors.length]
    };
    
    charts.push(chart);
    renderAllCharts();
}

function removeChart(chartId) {
    charts = charts.filter(c => c.id !== chartId);
    
    // Clean up data series
    const keysToDelete = [];
    chartDataSeries.forEach((_, key) => {
        if (key.startsWith(`${chartId}:`)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => chartDataSeries.delete(key));
    
    renderAllCharts();
}

function toggleChartConfig(chartId) {
    const config = document.getElementById(`chartConfig${chartId}`);
    config.classList.toggle('active');
}

function updateChartConfig(chartId, field, value) {
    const chart = charts.find(c => c.id === chartId);
    if (chart) {
        chart[field] = value;
        renderChart(chart);
    }
}

function renderAllCharts() {
    const chartList = document.getElementById('chartList');
    
    if (charts.length === 0) {
        chartList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <h3>No charts configured</h3>
                <p>Click "Add Chart" to create a new chart</p>
                <p class="hint">Charts display data in format: NAME:timestamp:value</p>
            </div>
        `;
        return;
    }

    chartList.innerHTML = charts.map(chart => `
        <div class="chart-item">
            <div class="chart-item-header">
                <h4>${chart.title}</h4>
                <div class="chart-item-controls">
                    <button onclick="toggleChartConfig(${chart.id})">⚙️ Config</button>
                    <button onclick="removeChart(${chart.id})">🗑️ Remove</button>
                </div>
            </div>
            <canvas id="chart${chart.id}" class="chart-canvas"></canvas>
            <div id="chartConfig${chart.id}" class="chart-config">
                <div class="config-row">
                    <label>Title:</label>
                    <input type="text" value="${chart.title}" 
                           onchange="updateChartConfig(${chart.id}, 'title', this.value)">
                </div>
                <div class="config-row">
                    <label>Name Filter:</label>
                    <input type="text" value="${chart.nameFilter}" placeholder="Leave empty for all"
                           onchange="updateChartConfig(${chart.id}, 'nameFilter', this.value)">
                </div>
                <div class="config-row">
                    <label>Min Y:</label>
                    <input type="text" value="${chart.minY}" placeholder="auto"
                           onchange="updateChartConfig(${chart.id}, 'minY', this.value)">
                </div>
                <div class="config-row">
                    <label>Max Y:</label>
                    <input type="text" value="${chart.maxY}" placeholder="auto"
                           onchange="updateChartConfig(${chart.id}, 'maxY', this.value)">
                </div>
            </div>
        </div>
    `).join('');

    // Render each chart after DOM update
    setTimeout(() => {
        charts.forEach(chart => renderChart(chart));
    }, 0);
}

function renderChart(chart) {
    const canvas = document.getElementById(`chart${chart.id}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 30, right: 20, bottom: 40, left: 60 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.fillStyle = getComputedStyle(canvas).backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Get data for this chart
    const allData = [];
    chartDataSeries.forEach((series, key) => {
        if (key.startsWith(`${chart.id}:`)) {
            const name = key.split(':')[1];
            if (!chart.nameFilter || name.includes(chart.nameFilter)) {
                series.forEach(point => {
                    allData.push({ ...point, seriesName: name });
                });
            }
        }
    });

    if (allData.length === 0) {
        ctx.fillStyle = '#888';
        ctx.font = '14px var(--vscode-font-family)';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet...', width / 2, height / 2);
        return;
    }

    // Calculate ranges
    const xValues = allData.map(d => d.x);
    const yValues = allData.map(d => d.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = chart.minY === 'auto' ? Math.min(...yValues) : parseFloat(chart.minY);
    const maxY = chart.maxY === 'auto' ? Math.max(...yValues) : parseFloat(chart.maxY);

    // Draw axes
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (graphHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#aaa';
    ctx.font = '11px var(--vscode-font-family)';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (graphHeight / 5) * i;
        const value = maxY - ((maxY - minY) / 5) * i;
        ctx.fillText(value.toFixed(1), padding.left - 10, y + 4);
    }

    // X-axis labels (time)
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
        const x = padding.left + (graphWidth / 4) * i;
        const value = minX + ((maxX - minX) / 4) * i;
        ctx.fillText(value.toFixed(0), x, height - padding.bottom + 20);
    }

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = '14px var(--vscode-font-family)';
    ctx.textAlign = 'center';
    ctx.fillText(chart.title, width / 2, 20);

    // Group data by series name
    const seriesMap = new Map();
    allData.forEach(point => {
        if (!seriesMap.has(point.seriesName)) {
            seriesMap.set(point.seriesName, []);
        }
        seriesMap.get(point.seriesName).push(point);
    });

    // Draw each series
    let seriesIndex = 0;
    seriesMap.forEach((points, seriesName) => {
        const seriesColor = colors[seriesIndex % colors.length];
        
        ctx.strokeStyle = seriesColor;
        ctx.lineWidth = 2;
        ctx.beginPath();

        points.forEach((point, idx) => {
            const x = padding.left + ((point.x - minX) / (maxX - minX)) * graphWidth;
            const y = height - padding.bottom - ((point.y - minY) / (maxY - minY)) * graphHeight;

            if (idx === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw series label
        ctx.fillStyle = seriesColor;
        ctx.font = '11px var(--vscode-font-family)';
        ctx.textAlign = 'left';
        ctx.fillText(seriesName, padding.left + 10, padding.top + 15 + seriesIndex * 15);

        seriesIndex++;
    });
}

// Region selection and export functions
function clearRegionSelection() {
    selectedRegion = null;
    document.getElementById('clearRegionBtn').style.display = 'none';
    renderTimeline();
}

function exportCurrentView() {
    const viewName = timelineView === 'trace' ? 'trace' : timelineView === 'calls' ? 'callstack' : 'charts';
    
    if (timelineView === 'trace') {
        exportTraceTimeline();
    } else if (timelineView === 'calls') {
        exportCallStack();
    } else if (timelineView === 'charts') {
        exportCharts();
    }
}

function exportTraceTimeline() {
    const completedSpans = traceSpans.filter(s => !s.pending);
    
    if (completedSpans.length === 0) {
        vscode.postMessage({
            command: 'showMessage',
            type: 'warning',
            message: 'No trace data to export'
        });
        return;
    }

    const minTime = Math.min(...completedSpans.map(s => s.startTime));
    const maxTime = Math.max(...completedSpans.map(s => s.endTime));
    
    // Filter by selected region if exists
    let spansToExport = completedSpans;
    if (selectedRegion) {
        spansToExport = completedSpans.filter(s => 
            s.startTime >= selectedRegion.startTime && s.endTime <= selectedRegion.endTime
        );
    }

    if (spansToExport.length === 0) {
        vscode.postMessage({
            command: 'showMessage',
            type: 'warning',
            message: 'No trace data in selected region'
        });
        return;
    }

    const timestamp = new Date().toISOString();
    let logContent = `# Trace Timeline Log Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    logContent += `# Total Spans: ${spansToExport.length}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    } else {
        logContent += `# Full Timeline: ${minTime.toFixed(2)}ms - ${maxTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    // Group by track ID
    const tracks = new Map();
    spansToExport.forEach(span => {
        if (!tracks.has(span.id)) {
            tracks.set(span.id, []);
        }
        tracks.get(span.id).push(span);
    });

    tracks.forEach((spans, trackId) => {
        logContent += `\n## Track: ${trackId} (${spans.length} spans)\n`;
        spans.sort((a, b) => a.startTime - b.startTime);
        spans.forEach((span, idx) => {
            logContent += `${idx + 1}. [${span.startTime.toFixed(2)}ms - ${span.endTime.toFixed(2)}ms] Duration: ${span.duration.toFixed(2)}ms | ${span.metadata}\n`;
        });
    });

    vscode.postMessage({
        command: 'exportView',
        viewName: 'trace',
        content: logContent
    });
}

function exportCallStack() {
    if (callStacks.size === 0) {
        vscode.postMessage({
            command: 'showMessage',
            type: 'warning',
            message: 'No call stack data to export'
        });
        return;
    }

    const timestamp = new Date().toISOString();
    let logContent = `# Call Stack Log Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    logContent += `# Total Threads: ${callStacks.size}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    callStacks.forEach((threadData, threadId) => {
        // Build call blocks
        const callBlocks = [];
        const callStack = [];
        
        threadData.calls.forEach(call => {
            if (call.type === 'start') {
                callStack.push({
                    functionName: call.functionName,
                    startTime: call.timestamp,
                    depth: call.depth
                });
            } else if (call.type === 'end') {
                for (let i = callStack.length - 1; i >= 0; i--) {
                    if (callStack[i].functionName === call.functionName) {
                        const startCall = callStack.splice(i, 1)[0];
                        callBlocks.push({
                            functionName: call.functionName,
                            startTime: startCall.startTime,
                            endTime: call.timestamp,
                            duration: call.timestamp - startCall.startTime,
                            depth: startCall.depth
                        });
                        break;
                    }
                }
            }
        });

        // Filter by region
        let blocksToExport = callBlocks;
        if (selectedRegion) {
            blocksToExport = callBlocks.filter(b =>
                b.startTime >= selectedRegion.startTime && b.endTime <= selectedRegion.endTime
            );
        }

        if (blocksToExport.length > 0) {
            logContent += `\n## Thread: ${threadId} (${blocksToExport.length} calls)\n`;
            blocksToExport.sort((a, b) => a.startTime - b.startTime);
            blocksToExport.forEach((block, idx) => {
                const indent = '  '.repeat(block.depth);
                logContent += `${idx + 1}. ${indent}[${block.startTime.toFixed(2)}ms - ${block.endTime.toFixed(2)}ms] ${block.functionName} (${block.duration.toFixed(2)}ms)\n`;
            });
        }
    });

    vscode.postMessage({
        command: 'exportView',
        viewName: 'callstack',
        content: logContent
    });
}

function exportCharts() {
    if (charts.length === 0) {
        vscode.postMessage({
            command: 'showMessage',
            type: 'warning',
            message: 'No chart data to export'
        });
        return;
    }

    const timestamp = new Date().toISOString();
    let logContent = `# Charts Log Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    logContent += `# Total Charts: ${charts.length}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    charts.forEach(chart => {
        logContent += `\n## Chart: ${chart.title}\n`;
        logContent += `Name Filter: ${chart.nameFilter || 'All'}\n`;
        logContent += `Y Range: ${chart.minY} to ${chart.maxY}\n\n`;

        // Collect all data for this chart
        const chartData = new Map();
        chartDataSeries.forEach((series, key) => {
            if (key.startsWith(`${chart.id}:`)) {
                const seriesName = key.split(':')[1];
                
                // Filter by region if selected
                let dataPoints = series;
                if (selectedRegion) {
                    dataPoints = series.filter(p =>
                        p.x >= selectedRegion.startTime && p.x <= selectedRegion.endTime
                    );
                }
                
                if (dataPoints.length > 0) {
                    chartData.set(seriesName, dataPoints);
                }
            }
        });

        chartData.forEach((points, seriesName) => {
            logContent += `### Series: ${seriesName} (${points.length} points)\n`;
            points.forEach((point, idx) => {
                logContent += `${idx + 1}. [${point.x.toFixed(2)}ms] ${point.y.toFixed(4)}\n`;
            });
            logContent += `\n`;
        });
    });

    vscode.postMessage({
        command: 'exportView',
        viewName: 'charts',
        content: logContent
    });
}

// Auto-connect on load
window.addEventListener('load', () => {
    setTimeout(() => {
        connectWebSocket();
    }, 500);
});
// ============================================================================
// TEST FUNCTION - DLT Packet Parser Testing
// ============================================================================

/**
 * Test DLT packet parsing with real data from your WebSocket server
 * Open browser console and run: testDltPackets()
 */
function testDltPackets() {
    console.log('\n========================================');
    console.log('🧪 DLT PACKET PARSER TEST');
    console.log('========================================\n');
    
    // Reset statistics and buffer
    dltPacketBuffer = new Uint8Array(0);
    dltMessagesReceived = 0;
    dltMessagesIncorrect = 0;
    updateDltStats();
    
    // Real packet data from your WebSocket server
    const testPackets = [
        '3500002045435531645ed2b526014441310044433100',                    // 22 bytes (incomplete, expects 32)
        '020f00000002000000003d00004e454355310000000e64575e6e4101444c5444', // 32 bytes (continues packet 1? or new?)
        '3d020074454355310000000e646c06bc4101444c5444494e544d',             // 26 bytes (incomplete, expects 116)
        '0002000054004170706c69636174696f6e494420274c4f472720726567697374', // Data continuation
        '3d01002e454355310000001e646c1a6d31024c4f470054455354',             // 26 bytes (incomplete, expects 46)
        '230000000100000000020000060068656c6c6f00',                         // 20 bytes
        '3d02002e454355310000001e646c2dfe31024c4f470054455354230000000200', // 46 bytes (complete!)
        '3d03002e454355310000001e646c41a331024c4f470054455354',             // 26 bytes (incomplete, expects 46)
        '230000000300000000020000060068656c6c6f00',                         // 20 bytes
        '3d04002e454355310000001e646c554431024c4f470054455354',             // 26 bytes
        '230000000400000000020000060068656c6c6f00',                         // 20 bytes
        '3500002745435531646cf28d26014441310044433100',                    // 22 bytes
        '010f0000004c4f47005445535472656d6f3d030038454355310000000e646cf2', // 32 bytes
    ];
    
    console.log(`📦 Processing ${testPackets.length} test packets...\\n`);
    
    let packetNum = 1;
    testPackets.forEach(hexString => {
        // Convert hex string to Uint8Array
        const bytes = new Uint8Array(
            hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
        
        console.log(`\\n--- Test Packet ${packetNum++} (${bytes.length} bytes) ---`);
        console.log(`Hex: ${hexString}`);
        
        // Simulate WebSocket binary message
        handleDltBinaryMessage(bytes.buffer);
    });
    
    console.log('\\n========================================');
    console.log('📊 FINAL STATISTICS');
    console.log('========================================');
    console.log(`✅ Successfully parsed: ${dltMessagesReceived}`);
    console.log(`❌ Parse errors: ${dltMessagesIncorrect}`);
    console.log(`📦 Remaining buffer: ${dltPacketBuffer.length} bytes`);
    console.log('========================================\\n');
}

// Make test function globally accessible
window.testDltPackets = testDltPackets;

console.log('💡 DLT Viewer loaded! Run testDltPackets() in console to test packet parsing.');