// ============================================================================
// DLT VIEWER - MAIN MODULE
// Modular architecture with ES6 imports
// ============================================================================

// Import modules
import * as ChartView from './modules/chart-view.js';
import * as RegisterView from './modules/register-view.js';
import * as TraceView from './modules/trace-view.js';
import * as DltParser from './modules/dlt-parser.js';
import * as WsManager from './modules/websocket-manager.js';
import * as DebugView from './modules/debug-view.js';

// ============================================================================
// SHARED STATE
// ============================================================================

const vscode = acquireVsCodeApi();

// Trace and Timeline State
let traceSpans = [];
let callStacks = new Map();
let selectedTrackId = null;
let selectedThreadId = null;
let timelineView = 'trace'; // 'trace', 'calls', or 'charts'

// Zoom and Pan State
let zoomLevel = 1;
let panOffset = 0;
let isPanning = false;
let panStartX = 0;
let panStartOffset = 0;
let currentTimelineElement = null;

// Region Selection State
let isSelectingRegion = false;
let regionSelectStart = null;
let regionSelectEnd = null;
let selectedRegion = null;

// Event Handlers
let mouseMoveHandler = null;
let mouseUpHandler = null;
let regionMouseMoveHandler = null;
let regionMouseUpHandler = null;

// Register State
let registers = new Map();

// Chart State
let charts = [];
let chartDataSeries = new Map();
let nextChartId = 1;

// Colors for tasks
const colors = [
    '#007acc', '#68217a', '#00897b', '#d14',
    '#f9a825', '#6a1b9a', '#0277bd', '#558b2f'
];
let colorIndex = 0;
const taskColors = new Map();

// ============================================================================
// MODULE INITIALIZATION
// ============================================================================

// Initialize Chart View
const chartState = ChartView.initChartView({
    charts,
    chartDataSeries,
    nextChartId,
    selectedRegion,
    vscode
});
charts = chartState.charts;
chartDataSeries = chartState.chartDataSeries;
nextChartId = chartState.nextChartId;

// Initialize Register View
RegisterView.initRegisterView({
    registers,
    selectedRegion,
    vscode
});

// Initialize Trace View
const traceState = TraceView.initTraceView({
    traceSpans,
    callStacks,
    selectedTrackId,
    selectedThreadId,
    timelineView,
    zoomLevel,
    panOffset,
    isPanning,
    panStartX,
    panStartOffset,
    currentTimelineElement,
    isSelectingRegion,
    regionSelectStart,
    regionSelectEnd,
    selectedRegion,
    mouseMoveHandler,
    mouseUpHandler,
    regionMouseMoveHandler,
    regionMouseUpHandler,
    taskColors,
    colorIndex,
    colors,
    vscode
});

// Update state from trace view
selectedTrackId = traceState.selectedTrackId;
selectedThreadId = traceState.selectedThreadId;
zoomLevel = traceState.zoomLevel;
panOffset = traceState.panOffset;
isPanning = traceState.isPanning;
panStartX = traceState.panStartX;
panStartOffset = traceState.panStartOffset;
currentTimelineElement = traceState.currentTimelineElement;
isSelectingRegion = traceState.isSelectingRegion;
regionSelectStart = traceState.regionSelectStart;
regionSelectEnd = traceState.regionSelectEnd;
selectedRegion = traceState.selectedRegion;
mouseMoveHandler = traceState.mouseMoveHandler;
mouseUpHandler = traceState.mouseUpHandler;
regionMouseMoveHandler = traceState.regionMouseMoveHandler;
regionMouseUpHandler = traceState.regionMouseUpHandler;
colorIndex = traceState.colorIndex;

// Initialize DLT Parser
DltParser.initDltParser();

// Initialize Debug View
DebugView.initDebugView({ vscode });

// Initialize WebSocket Manager
WsManager.initWebSocketManager({
    wsPort: 8083,
    packetType: 'text',
    textMessageHandler: handleMessage,
    binaryMessageHandler: (data) => DltParser.handleDltBinaryMessage(data, (msg) => {
        DltParser.displayDltMessage(msg);
        DebugView.captureDltLog(msg);
    })
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function handleMessage(message) {
    const parts = message.split(':');

    if (parts[0] === 'REG' && parts.length >= 3) {
        // Register update: REG:name:value or REG:timestamp:name:value
        let name, value, timestamp;
        
        if (parts.length >= 4 && !isNaN(parseFloat(parts[1]))) {
            timestamp = parts[1];
            name = parts[2];
            value = parts.slice(3).join(':');
        } else {
            name = parts[1];
            value = parts.slice(2).join(':');
            timestamp = new Date().toISOString();
        }
        
        RegisterView.updateRegister(name, value, timestamp);
    } else if (parts.length === 3) {
        // Chart data: Name:Timestamp:Value
        const name = parts[0];
        const timestamp = parseFloat(parts[1]);
        const value = parseFloat(parts[2]);
        
        if (!isNaN(timestamp) && !isNaN(value)) {
            ChartView.handleChartData(name, timestamp, value);
        }
    } else if (parts.length === 4) {
        // Distinguish between trace and call graph
        if (parts[2] === 'start' || parts[2] === 'end') {
            // Trace event: ID:Timestamp:start|end:metadata
            const id = parts[0];
            const timestamp = parseFloat(parts[1]);
            const type = parts[2];
            const metadata = parts[3];
            TraceView.handleTraceEvent(id, timestamp, type, metadata);
        } else if (parts[3] === 'start' || parts[3] === 'end') {
            // Call graph event: ThreadID:FunctionName:Timestamp:start|end
            const threadId = parts[0];
            const functionName = parts[1];
            const timestamp = parseFloat(parts[2]);
            const type = parts[3];
            TraceView.handleCallEvent(threadId, functionName, timestamp, type);
        }
    }
}

// ============================================================================
// UI CONTROL FUNCTIONS
// ============================================================================

function toggleConfig() {
    WsManager.toggleConfig();
}

function applyConfig() {
    WsManager.applyConfig();
}

function connectWebSocket() {
    WsManager.connectWebSocket();
}

function setTimelineView(view) {
    timelineView = view;
    
    const traceBtn = document.getElementById('traceViewBtn');
    const callBtn = document.getElementById('callViewBtn');
    const chartBtn = document.getElementById('chartViewBtn');
    const logsBtn = document.getElementById('logsViewBtn');
    const debugBtn = document.getElementById('debugViewBtn');
    
    const timelineContainer = document.getElementById('timelineContainer');
    const chartContainer = document.getElementById('chartContainer');
    const logsContainer = document.getElementById('logsContainer');
    const debugContainer = document.getElementById('debugContainer');
    
    // Update button states
    [traceBtn, callBtn, chartBtn, logsBtn, debugBtn].forEach(btn => btn?.classList.remove('active'));
    
    // Hide all
    if (timelineContainer) timelineContainer.style.display = 'none';
    if (chartContainer) chartContainer.style.display = 'none';
    if (logsContainer) logsContainer.style.display = 'none';
    if (debugContainer) debugContainer.style.display = 'none';
    
    if (view === 'trace') {
        traceBtn?.classList.add('active');
        if (timelineContainer) timelineContainer.style.display = 'flex';
        TraceView.renderTimeline();
    } else if (view === 'calls') {
        callBtn?.classList.add('active');
        if (timelineContainer) timelineContainer.style.display = 'flex';
        TraceView.renderTimeline();
    } else if (view === 'charts') {
        chartBtn?.classList.add('active');
        if (chartContainer) chartContainer.style.display = 'flex';
        ChartView.renderAllCharts();
    } else if (view === 'logs') {
        logsBtn?.classList.add('active');
        if (logsContainer) logsContainer.style.display = 'flex';
    } else if (view === 'debug') {
        debugBtn?.classList.add('active');
        if (debugContainer) debugContainer.style.display = 'flex';
    }
}

function resetZoom() {
    const result = TraceView.resetZoom();
    zoomLevel = result.zoomLevel;
    panOffset = result.panOffset;
}

function selectTrack(trackId, event) {
    selectedTrackId = TraceView.selectTrack(trackId, event);
}

function selectThread(threadId, event) {
    selectedThreadId = TraceView.selectThread(threadId, event);
}

function clearData() {
    traceSpans.length = 0;
    registers.clear();
    callStacks.clear();
    selectedTrackId = null;
    selectedThreadId = null;
    taskColors.clear();
    colorIndex = 0;
    charts.length = 0;
    chartDataSeries.clear();
    
    zoomLevel = 1;
    panOffset = 0;

    RegisterView.clearRegisters();
    TraceView.renderCallGraph();
    TraceView.renderTimeline();
    TraceView.renderLogs(null);
    ChartView.renderAllCharts();
}

function clearRegionSelection() {
    selectedRegion = TraceView.clearRegionSelection();
}

function exportRegisters() {
    RegisterView.exportRegisters();
}

function exportCurrentView() {
    TraceView.exportCurrentView();
}

function addChart() {
    const result = ChartView.addChart();
    nextChartId = result.nextChartId;
}

function removeChart(chartId) {
    ChartView.removeChart(chartId);
}

function updateChartConfig(chartId, field, value) {
    ChartView.updateChartConfig(chartId, field, value);
}

// ============================================================================
// EXPOSE TO GLOBAL SCOPE (for HTML onclick/onchange handlers)
// ============================================================================

window.toggleConfig = toggleConfig;
window.applyConfig = applyConfig;
window.connectWebSocket = connectWebSocket;
window.setTimelineView = setTimelineView;
window.resetZoom = resetZoom;
window.selectTrack = selectTrack;
window.selectThread = selectThread;
window.clearData = clearData;
window.clearRegionSelection = clearRegionSelection;
window.exportRegisters = exportRegisters;
window.exportCurrentView = exportCurrentView;
window.addChart = addChart;
window.removeChart = removeChart;
window.updateChartConfig = updateChartConfig;

// Debug view functions
function startBuild() { DebugView.startBuild(); }
function startRun() { DebugView.startRun(); }
function stopRun() { DebugView.stopRun(); }
function startGdb() { DebugView.startGdb(); }
function stopGdb() { DebugView.stopGdb(); }
function sendGdbCommand() { DebugView.sendGdbCommand(); }
function buildAndRun() { DebugView.buildAndRun(); }
function buildAndDebug() { DebugView.buildAndDebug(); }
function saveDebugConfig() { DebugView.saveConfig(); }
function switchDebugTab(tab) { DebugView.switchDebugTab(tab); }
function askAiDebug(prompt) { DebugView.askAiDebug(prompt); }
function stopAll() {
    DebugView.stopRun();
    DebugView.stopGdb();
}

window.startBuild = startBuild;
window.startRun = startRun;
window.stopRun = stopRun;
window.startGdb = startGdb;
window.stopGdb = stopGdb;
window.sendGdbCommand = sendGdbCommand;
window.buildAndRun = buildAndRun;
window.buildAndDebug = buildAndDebug;
window.saveDebugConfig = saveDebugConfig;
window.switchDebugTab = switchDebugTab;
window.askAiDebug = askAiDebug;
window.stopAll = stopAll;

// Expose modules for direct access if needed
window.chartView = ChartView;
window.registerView = RegisterView;
window.traceView = TraceView;
window.dltParser = DltParser;
window.wsManager = WsManager;
window.debugView = DebugView;

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('load', async () => {
    console.log('🚀 Initializing DLT Viewer...');
    
    // Initialize WASM module first
    await DltParser.initWasm();
    
    // Load debug config
    vscode.postMessage({ command: 'loadDebugConfig' });
    
    // Listen for provider messages
    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.command) {
            case 'debugOutput':
                DebugView.handleDebugOutput(msg);
                break;
            case 'debugConfigLoaded':
                DebugView.loadConfig(msg.config);
                break;
            case 'debugConfigSaved':
                console.log('Debug config saved');
                break;
            case 'aiDebugResponse':
                DebugView.handleAiResponse(msg.response);
                break;
        }
    });
    
    // Then connect to WebSocket
    setTimeout(() => {
        connectWebSocket();
    }, 500);
});

// ============================================================================
// TEST FUNCTION (from original)
// ============================================================================

function testDltPackets() {
    console.log('\n========================================');
    console.log('🧪 DLT PACKET PARSER TEST');
    console.log('========================================\n');
    
    const { dltPacketBuffer, dltMessagesReceived, dltMessagesIncorrect } = DltParser.resetDltStats();
    
    const testPackets = [
        '3500002045435531645ed2b526014441310044433100',
        '020f00000002000000003d00004e454355310000000e64575e6e4101444c5444',
        '3d020074454355310000000e646c06bc4101444c5444494e544d',
        '0002000054004170706c69636174696f6e494420274c4f472720726567697374',
        '3d01002e454355310000001e646c1a6d31024c4f470054455354',
        '230000000100000000020000060068656c6c6f00',
        '3d02002e454355310000001e646c2dfe31024c4f470054455354230000000200',
        '3d03002e454355310000001e646c41a331024c4f470054455354',
        '230000000300000000020000060068656c6c6f00',
        '3d04002e454355310000001e646c554431024c4f470054455354',
        '230000000400000000020000060068656c6c6f00',
        '3500002745435531646cf28d26014441310044433100',
        '010f0000004c4f47005445535472656d6f3d030038454355310000000e646cf2'
    ];
    
    console.log(`📦 Processing ${testPackets.length} test packets...\n`);
    
    let packetNum = 1;
    testPackets.forEach(hexString => {
        const bytes = new Uint8Array(
            hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
        
        console.log(`\n--- Test Packet ${packetNum++} (${bytes.length} bytes) ---`);
        console.log(`Hex: ${hexString}`);
        
        DltParser.handleDltBinaryMessage(bytes.buffer, DltParser.displayDltMessage);
    });
    
    const stats = DltParser.getDltStats();
    console.log('\n========================================');
    console.log('📊 FINAL STATISTICS');
    console.log('========================================');
    console.log(`✅ Successfully parsed: ${stats.dltMessagesReceived}`);
    console.log(`❌ Parse errors: ${stats.dltMessagesIncorrect}`);
    console.log('========================================\n');
}

window.testDltPackets = testDltPackets;

console.log('💡 DLT Viewer loaded (modular)! Run testDltPackets() in console to test packet parsing.');
