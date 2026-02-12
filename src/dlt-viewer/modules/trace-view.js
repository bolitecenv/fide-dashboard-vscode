// ============================================================================
// TRACE VIEW MODULE
// ============================================================================

/**
 * Trace View Module
 * Handles trace timeline, call graph, and span visualization
 */

// Import shared state
let traceSpans, callStacks, selectedTrackId, selectedThreadId, timelineView,
    zoomLevel, panOffset, isPanning, panStartX, panStartOffset, currentTimelineElement,
    isSelectingRegion, regionSelectStart, regionSelectEnd, selectedRegion,
    mouseMoveHandler, mouseUpHandler, regionMouseMoveHandler, regionMouseUpHandler,
    taskColors, colorIndex, colors, vscode;

export function initTraceView(state) {
    traceSpans = state.traceSpans;
    callStacks = state.callStacks;
    selectedTrackId = state.selectedTrackId;
    selectedThreadId = state.selectedThreadId;
    timelineView = state.timelineView;
    zoomLevel = state.zoomLevel;
    panOffset = state.panOffset;
    isPanning = state.isPanning;
    panStartX = state.panStartX;
    panStartOffset = state.panStartOffset;
    currentTimelineElement = state.currentTimelineElement;
    isSelectingRegion = state.isSelectingRegion;
    regionSelectStart = state.regionSelectStart;
    regionSelectEnd = state.regionSelectEnd;
    selectedRegion = state.selectedRegion;
    mouseMoveHandler = state.mouseMoveHandler;
    mouseUpHandler = state.mouseUpHandler;
    regionMouseMoveHandler = state.regionMouseMoveHandler;
    regionMouseUpHandler = state.regionMouseUpHandler;
    taskColors = state.taskColors;
    colorIndex = state.colorIndex;
    colors = state.colors;
    vscode = state.vscode;
    
    return { 
        selectedTrackId, selectedThreadId, zoomLevel, panOffset, isPanning,
        panStartX, panStartOffset, currentTimelineElement, isSelectingRegion,
        regionSelectStart, regionSelectEnd, selectedRegion, mouseMoveHandler,
        mouseUpHandler, regionMouseMoveHandler, regionMouseUpHandler, colorIndex
    };
}

export function handleTraceEvent(id, timestamp, type, metadata) {
    if (type === 'start') {
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
        const pendingSpan = traceSpans.find(s => s.id === id && s.pending);
        if (pendingSpan) {
            pendingSpan.endTime = timestamp;
            pendingSpan.duration = timestamp - pendingSpan.startTime;
            pendingSpan.pending = false;
        }
    }
    renderTimeline();
}

export function handleCallEvent(threadId, functionName, timestamp, type) {
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

function getTaskColor(taskId) {
    if (!taskColors.has(taskId)) {
        taskColors.set(taskId, colors[colorIndex % colors.length]);
        colorIndex = (colorIndex + 1) % colors.length;
    }
    return taskColors.get(taskId);
}

export function renderCallGraph() {
    const callGraphList = document.getElementById('callGraphList');
    const threadCount = document.getElementById('threadCount');
    
    if (!callGraphList) return;

    if (callStacks.size === 0) {
        callGraphList.innerHTML = `
            <div class="empty-message">
                <p>No call events received</p>
                <p class="hint">Format: &lt;ThreadID&gt;:&lt;Function&gt;:&lt;Time&gt;:&lt;start|end&gt;</p>
            </div>
        `;
        if (threadCount) {
            threadCount.textContent = '0 threads';
        }
        return;
    }

    callGraphList.innerHTML = '';
    
    callStacks.forEach((threadData, threadId) => {
        const isSelected = selectedThreadId === threadId;
        const threadItem = document.createElement('div');
        threadItem.className = `callgraph-thread ${isSelected ? 'selected' : ''}`;
        threadItem.onclick = (e) => selectThread(threadId, e);
        
        const uniqueFunctions = new Set(threadData.calls.map(c => c.functionName));
        
        threadItem.innerHTML = `
            <div class="thread-header">
                <strong>Thread ${threadId}</strong>
                <span class="badge">${threadData.calls.length} calls</span>
            </div>
            <div class="thread-functions">
                ${Array.from(uniqueFunctions).map(fn => `<span class="function-tag">${fn}</span>`).join(' ')}
            </div>
        `;
        
        callGraphList.appendChild(threadItem);
    });

    if (threadCount) {
        threadCount.textContent = `${callStacks.size} threads`;
    }
}

export function renderTimeline() {
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

    const completedSpans = traceSpans.filter(s => !s.pending);
    if (completedSpans.length === 0) return;

    const minTime = Math.min(...completedSpans.map(s => s.startTime));
    const maxTime = Math.max(...completedSpans.map(s => s.endTime));
    const baseTimeRange = maxTime - minTime || 1000;
    
    const timeRange = baseTimeRange / zoomLevel;
    const visibleMinTime = minTime + (baseTimeRange * panOffset / 100);
    const visibleMaxTime = visibleMinTime + timeRange;

    const tracks = new Map();
    completedSpans.forEach(span => {
        if (!tracks.has(span.id)) {
            tracks.set(span.id, []);
        }
        tracks.get(span.id).push(span);
    });

    const getXPosition = (timestamp) => ((timestamp - visibleMinTime) / timeRange) * 100;
    const getWidth = (duration) => (duration / timeRange) * 100;

    let html = generateRuler(visibleMinTime, visibleMaxTime, timeRange, getXPosition);
    html += generateTracks(tracks, visibleMinTime, visibleMaxTime, getXPosition, getWidth);

    container.innerHTML = html;
    attachTimelineInteractions();

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

    const callBlocks = buildCallBlocks(threadData);
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

    let minTime = Math.min(...callBlocks.map(b => b.startTime));
    let maxTime = Math.max(...callBlocks.map(b => b.endTime));
    const baseTimeRange = maxTime - minTime || 100;
    
    const timeRange = baseTimeRange / zoomLevel;
    const visibleMinTime = minTime + (baseTimeRange * panOffset / 100);
    const visibleMaxTime = visibleMinTime + timeRange;

    const maxDepth = Math.max(...callBlocks.map(b => b.depth), 0);
    const rowHeight = 30;
    const timelineHeight = (maxDepth + 1) * rowHeight + 40;

    const getXPosition = (timestamp) => ((timestamp - visibleMinTime) / timeRange) * 100;
    const getWidth = (duration) => (duration / timeRange) * 100;

    let html = `<h3 style="margin: 20px;">Thread ${selectedThreadId} - ${callBlocks.length} function calls</h3>`;
    html += generateRuler(visibleMinTime, visibleMaxTime, timeRange, getXPosition);
    html += generateCallBlocks(callBlocks, visibleMinTime, visibleMaxTime, getXPosition, getWidth, rowHeight, timelineHeight);

    container.innerHTML = html;
    attachTimelineInteractions();
}

function buildCallBlocks(threadData) {
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
    
    return callBlocks;
}

function generateRuler(visibleMinTime, visibleMaxTime, timeRange, getXPosition) {
    return `
        <div class="timeline-ruler">
            <div class="ruler-track">
                <div class="ruler-label-spacer" style="width: 150px; flex-shrink: 0;"></div>
                <div id="rulerContent" class="ruler-content" style="flex: 1; position: relative; cursor: crosshair;" 
                     data-min-time="${visibleMinTime}" data-max-time="${visibleMaxTime}">
                    <div class="ruler-label" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                        Time ${zoomLevel > 1 ? `<span style="font-size: 10px; opacity: 0.7;"> (${zoomLevel.toFixed(1)}x)</span>` : ''}
                        ${selectedRegion ? `<span style="font-size: 10px; color: var(--vscode-charts-blue);"> [${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms]</span>` : ''}
                    </div>
                    ${selectedRegion ? `<div class="region-overlay" style="position: absolute; top: 0; left: ${getXPosition(selectedRegion.startTime)}%; width: ${getXPosition(selectedRegion.endTime) - getXPosition(selectedRegion.startTime)}%; height: 100%; background: rgba(0, 122, 204, 0.2); border-left: 2px solid var(--vscode-charts-blue); border-right: 2px solid var(--vscode-charts-blue); pointer-events: none;"></div>` : ''}
                    <div class="ruler-ticks" style="pointer-events: none;">
                        ${Array.from({ length: 10 }, (_, i) => {
                            const time = visibleMinTime + (timeRange * i / 9);
                            return `<div class="tick" style="left: ${(i / 9) * 100}%">
                                <div class="tick-label">${time > 1000 ? (time / 1000).toFixed(2) + 's' : time.toFixed(0) + 'ms'}</div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateTracks(tracks, visibleMinTime, visibleMaxTime, getXPosition, getWidth) {
    let html = `<div class="timeline-tracks-wrapper" style="display: flex;">
        <div class="track-labels" style="width: 150px; flex-shrink: 0; background: var(--vscode-sideBar-background); border-right: 1px solid var(--vscode-panel-border);">`;
    
    tracks.forEach((spans, trackId) => {
        const isSelected = selectedTrackId === trackId;
        html += `
            <div class="track-label-item ${isSelected ? 'selected' : ''}" 
                 onclick="window.traceView.selectTrack('${trackId}', event)"
                 style="padding: 15px 10px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer;">
                <div class="track-id" style="font-weight: 600; font-size: 12px;">${trackId}</div>
                <div class="track-count" style="font-size: 10px; color: var(--vscode-descriptionForeground);">${spans.length} spans</div>
            </div>
        `;
    });
    
    html += `</div><div class="timeline-tracks" id="timelineTracks" style="flex: 1;">`;
    
    tracks.forEach((spans, trackId) => {
        const isSelected = selectedTrackId === trackId;
        html += `<div class="timeline-track ${isSelected ? 'selected' : ''}" 
                     onclick="window.traceView.selectTrack('${trackId}', event)"
                     style="margin-bottom: 0; border-bottom: 1px solid var(--vscode-panel-border); padding: 15px 0;">
            <div class="track-timeline">
                ${spans.filter(span => span.endTime >= visibleMinTime && span.startTime <= visibleMaxTime)
                    .map(span => {
                        const left = getXPosition(span.startTime);
                        const width = getWidth(span.duration);
                        return `<div class="trace-span"
                                     style="left: ${left}%; width: ${Math.max(width, 0.5)}%; background-color: ${span.color};"
                                     title="${span.metadata}\\nDuration: ${span.duration.toFixed(2)}ms\\nStart: ${span.startTime.toFixed(2)}">
                                    ${width > 5 ? `<span class="span-label">${span.duration.toFixed(1)}ms</span>` : ''}
                                </div>`;
                    }).join('')}
            </div>
        </div>`;
    });
    
    return html + '</div></div>';
}

function generateCallBlocks(callBlocks, visibleMinTime, visibleMaxTime, getXPosition, getWidth, rowHeight, timelineHeight) {
    const depthLabels = new Map();
    callBlocks.forEach(block => {
        if (!depthLabels.has(block.depth)) {
            depthLabels.set(block.depth, block.functionName);
        }
    });

    return `
        <div id="callTimelineWrapper" style="position: relative; height: ${timelineHeight}px; margin-bottom: 20px; display: flex;">
            <div class="call-depth-labels" style="width: 150px; position: relative; height: 100%; flex-shrink: 0;">
                ${Array.from(depthLabels.entries()).map(([depth, funcName]) => {
                    const top = depth * rowHeight + 10;
                    return `<div class="depth-label" style="position: absolute; top: ${top}px; height: ${rowHeight - 4}px; line-height: ${rowHeight - 4}px; padding: 0 10px; font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" title="Depth ${depth}: ${funcName}">
                        ${funcName}
                    </div>`;
                }).join('')}
            </div>
            <div class="call-timeline" style="height: 100%; flex: 1;">
                ${callBlocks.filter(block => block.endTime >= visibleMinTime && block.startTime <= visibleMaxTime)
                    .map(block => {
                        const left = getXPosition(block.startTime);
                        const width = getWidth(block.duration);
                        const top = block.depth * rowHeight + 10;
                        return `<div class="call-block depth-${block.depth % 5}"
                                     style="left: ${left}%; width: ${Math.max(width, 2)}%; top: ${top}px; height: ${rowHeight - 4}px"
                                     title="${block.functionName}\\nDuration: ${block.duration.toFixed(2)}ms\\nStart: ${block.startTime.toFixed(2)}ms">
                                    ${block.functionName}
                                </div>`;
                    }).join('')}
            </div>
        </div>
    `;
}

function attachTimelineInteractions() {
    const tracksElement = document.getElementById('timelineTracks') || document.getElementById('callTimelineWrapper');
    if (!tracksElement) return;

    // Clean up old listeners
    if (mouseMoveHandler) document.removeEventListener('mousemove', mouseMoveHandler);
    if (mouseUpHandler) document.removeEventListener('mouseup', mouseUpHandler);
    if (regionMouseMoveHandler) document.removeEventListener('mousemove', regionMouseMoveHandler);
    if (regionMouseUpHandler) document.removeEventListener('mouseup', regionMouseUpHandler);

    currentTimelineElement = tracksElement;

    // Wheel to zoom
    tracksElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(1, Math.min(20, zoomLevel * delta));
        
        if (newZoom !== zoomLevel) {
            const rect = tracksElement.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / rect.width;
            panOffset = panOffset + (mouseX * 100 * (1 - zoomLevel / newZoom));
            panOffset = Math.max(0, Math.min(100 * (newZoom - 1), panOffset));
            zoomLevel = newZoom;
            renderTimeline();
        }
    }, { passive: false });

    // Pan with drag
    tracksElement.addEventListener('mousedown', (e) => {
        const isTimelineArea = e.target.classList.contains('call-timeline') || 
                               e.target.classList.contains('track-timeline') ||
                               e.target.closest('.call-timeline') ||
                               e.target.closest('.track-timeline');
        
        if (e.button === 0 && isTimelineArea) {
            e.preventDefault();
            isPanning = true;
            panStartX = e.clientX;
            panStartOffset = panOffset;
            tracksElement.style.cursor = 'grabbing';
        }
    });

    mouseMoveHandler = (e) => {
        if (isPanning && currentTimelineElement) {
            const rect = currentTimelineElement.getBoundingClientRect();
            const deltaX = e.clientX - panStartX;
            const deltaPercent = (deltaX / rect.width) * 100;
            const adjustedDelta = deltaPercent * (zoomLevel - 1);
            panOffset = panStartOffset - adjustedDelta;
            panOffset = Math.max(0, Math.min(100 * (zoomLevel - 1), panOffset));
            renderTimeline();
        }
    };
    document.addEventListener('mousemove', mouseMoveHandler);

    mouseUpHandler = () => {
        if (isPanning && currentTimelineElement) {
            isPanning = false;
            currentTimelineElement.style.cursor = 'grab';
        }
    };
    document.addEventListener('mouseup', mouseUpHandler);

    tracksElement.addEventListener('dblclick', () => resetZoom());

    // Region selection
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
                selectedRegion = { 
                    startTime: Math.min(regionSelectStart, regionSelectEnd),
                    endTime: Math.max(regionSelectStart, regionSelectEnd)
                };
                renderTimeline();
            }
        };
        document.addEventListener('mousemove', regionMouseMoveHandler);
        
        regionMouseUpHandler = () => {
            if (isSelectingRegion) {
                isSelectingRegion = false;
                if (regionSelectStart && regionSelectEnd && Math.abs(regionSelectEnd - regionSelectStart) > 1) {
                    selectedRegion = {
                        startTime: Math.min(regionSelectStart, regionSelectEnd),
                        endTime: Math.max(regionSelectStart, regionSelectEnd)
                    };
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

export function resetZoom() {
    zoomLevel = 1;
    panOffset = 0;
    renderTimeline();
    return { zoomLevel, panOffset };
}

export function selectTrack(trackId, event) {
    if (event && event.shiftKey) return;
    selectedTrackId = trackId;
    renderTimeline();
    return selectedTrackId;
}

export function selectThread(threadId, event) {
    if (event && event.shiftKey) return;
    selectedThreadId = threadId;
    renderCallGraph();
    if (timelineView === 'calls') {
        renderTimeline();
    }
    return selectedThreadId;
}

export function renderLogs(spans) {
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

export function clearRegionSelection() {
    selectedRegion = null;
    document.getElementById('clearRegionBtn').style.display = 'none';
    renderTimeline();
    return selectedRegion;
}

export function exportCurrentView() {
    const timestamp = new Date().toISOString();
    let logContent = `#${timelineView === 'trace' ? 'Trace Timeline' : 'Call Stack'} Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    if (timelineView === 'trace') {
        logContent += exportTraceData();
    } else if (selectedThreadId) {
        logContent += exportCallStackData();
    }

    vscode.postMessage({
        command: 'exportView',
        viewName: timelineView === 'trace' ? 'trace' : 'callstack',
        content: logContent
    });
}

function exportTraceData() {
    let content = '';
    const tracks = new Map();
    traceSpans.filter(s => !s.pending).forEach(span => {
        if (selectedRegion) {
            if (span.startTime < selectedRegion.startTime || span.endTime > selectedRegion.endTime) {
                return;
            }
        }
        if (!tracks.has(span.id)) {
            tracks.set(span.id, []);
        }
        tracks.get(span.id).push(span);
    });

    tracks.forEach((spans, trackId) => {
        content += `## Track: ${trackId} (${spans.length} spans)\n`;
        spans.forEach((span, idx) => {
            content += `${idx + 1}. [${span.startTime.toFixed(2)}ms] ${span.duration.toFixed(2)}ms - ${span.metadata}\n`;
        });
        content += `\n`;
    });

    return content;
}

function exportCallStackData() {
    const threadData = callStacks.get(selectedThreadId);
    if (!threadData) return '';

    const callBlocks = buildCallBlocks(threadData);
    let content = `## Thread: ${selectedThreadId} (${callBlocks.length} calls)\n`;

    callBlocks.forEach((block, idx) => {
        if (selectedRegion) {
            if (block.startTime < selectedRegion.startTime || block.endTime > selectedRegion.endTime) {
                return;
            }
        }
        const indent = '  '.repeat(block.depth);
        content += `${idx + 1}. ${indent}[${block.startTime.toFixed(2)}ms] ${block.functionName} - ${block.duration.toFixed(2)}ms\n`;
    });

    return content;
}
