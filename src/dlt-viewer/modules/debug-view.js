// ============================================================================
// DEBUG VIEW MODULE
// Build + Run + Debug with AI-assisted analysis using DLT logs
// ============================================================================

let vscode;
let buildConfig = {
    buildCmd: 'cargo build',
    runCmd: 'cargo run',
    gdbCmd: 'arm-none-eabi-gdb',
    gdbTarget: 'localhost:3333',
    elfPath: 'target/thumbv7em-none-eabihf/debug/firmware',
    gdbInitCmds: 'target remote localhost:3333\nmonitor reset halt\nload\ncontinue'
};

let buildOutput = [];
let runOutput = [];
let gdbOutput = [];
let dltLogBuffer = [];
let aiAnalysis = '';
let isBuilding = false;
let isRunning = false;
let isDebugging = false;
let isAiProcessing = false;

const MAX_OUTPUT_LINES = 500;
const MAX_DLT_BUFFER = 200;

export function initDebugView(state) {
    vscode = state.vscode;
    return { buildConfig };
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

export function loadConfig(config) {
    if (config) {
        buildConfig = { ...buildConfig, ...config };
        updateConfigUI();
    }
}

export function saveConfig() {
    buildConfig.buildCmd = document.getElementById('debugBuildCmd')?.value || buildConfig.buildCmd;
    buildConfig.runCmd = document.getElementById('debugRunCmd')?.value || buildConfig.runCmd;
    buildConfig.gdbCmd = document.getElementById('debugGdbCmd')?.value || buildConfig.gdbCmd;
    buildConfig.gdbTarget = document.getElementById('debugGdbTarget')?.value || buildConfig.gdbTarget;
    buildConfig.elfPath = document.getElementById('debugElfPath')?.value || buildConfig.elfPath;
    buildConfig.gdbInitCmds = document.getElementById('debugGdbInitCmds')?.value || buildConfig.gdbInitCmds;
    
    vscode.postMessage({
        command: 'saveDebugConfig',
        config: buildConfig
    });
}

function updateConfigUI() {
    const fields = {
        'debugBuildCmd': buildConfig.buildCmd,
        'debugRunCmd': buildConfig.runCmd,
        'debugGdbCmd': buildConfig.gdbCmd,
        'debugGdbTarget': buildConfig.gdbTarget,
        'debugElfPath': buildConfig.elfPath,
        'debugGdbInitCmds': buildConfig.gdbInitCmds
    };
    
    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }
}

// ============================================================================
// BUILD / RUN / DEBUG ACTIONS
// ============================================================================

export function startBuild() {
    if (isBuilding) return;
    isBuilding = true;
    buildOutput = [];
    updateBuildStatus('building');
    appendOutput('build', '$ ' + buildConfig.buildCmd, 'cmd');
    
    vscode.postMessage({
        command: 'debugAction',
        action: 'build',
        config: buildConfig
    });
}

export function startRun() {
    if (isRunning) return;
    isRunning = true;
    runOutput = [];
    updateRunStatus('running');
    appendOutput('run', '$ ' + buildConfig.runCmd, 'cmd');
    
    vscode.postMessage({
        command: 'debugAction',
        action: 'run',
        config: buildConfig
    });
}

export function stopRun() {
    vscode.postMessage({
        command: 'debugAction',
        action: 'stopRun'
    });
}

export function startGdb() {
    if (isDebugging) return;
    isDebugging = true;
    gdbOutput = [];
    updateGdbStatus('connecting');
    appendOutput('gdb', '$ ' + buildConfig.gdbCmd + ' ' + buildConfig.elfPath, 'cmd');
    
    vscode.postMessage({
        command: 'debugAction',
        action: 'gdb',
        config: buildConfig
    });
}

export function stopGdb() {
    vscode.postMessage({
        command: 'debugAction',
        action: 'stopGdb'
    });
}

export function sendGdbCommand() {
    const input = document.getElementById('gdbInput');
    if (!input || !input.value.trim()) return;
    
    const cmd = input.value.trim();
    appendOutput('gdb', '(gdb) ' + cmd, 'cmd');
    
    vscode.postMessage({
        command: 'debugAction',
        action: 'gdbCommand',
        gdbCmd: cmd
    });
    
    input.value = '';
}

export function buildAndRun() {
    startBuild();
    // Run will be triggered after build succeeds via handleDebugOutput
}

export function buildAndDebug() {
    startBuild();
    // GDB will be triggered after build succeeds via handleDebugOutput
}

// ============================================================================
// OUTPUT HANDLING
// ============================================================================

export function handleDebugOutput(data) {
    const { action, stream, text, exitCode, status } = data;
    
    if (action === 'build') {
        if (status === 'exit') {
            isBuilding = false;
            if (exitCode === 0) {
                updateBuildStatus('success');
                appendOutput('build', '✅ Build succeeded (exit code 0)', 'success');
            } else {
                updateBuildStatus('error');
                appendOutput('build', `❌ Build failed (exit code ${exitCode})`, 'error');
            }
        } else if (text) {
            appendOutput('build', text, stream === 'stderr' ? 'stderr' : 'stdout');
        }
    } else if (action === 'run') {
        if (status === 'exit') {
            isRunning = false;
            updateRunStatus(exitCode === 0 ? 'stopped' : 'error');
            appendOutput('run', `Process exited (code ${exitCode})`, exitCode === 0 ? 'info' : 'error');
        } else if (text) {
            appendOutput('run', text, stream === 'stderr' ? 'stderr' : 'stdout');
        }
    } else if (action === 'gdb') {
        if (status === 'exit') {
            isDebugging = false;
            updateGdbStatus('disconnected');
            appendOutput('gdb', 'GDB session ended', 'info');
        } else if (status === 'connected') {
            updateGdbStatus('connected');
            appendOutput('gdb', '✅ GDB connected', 'success');
        } else if (text) {
            appendOutput('gdb', text, stream === 'stderr' ? 'stderr' : 'stdout');
        }
    }
}

function appendOutput(target, text, type) {
    let outputList;
    let outputArr;
    
    switch (target) {
        case 'build':
            outputList = document.getElementById('buildOutput');
            outputArr = buildOutput;
            break;
        case 'run':
            outputList = document.getElementById('runOutput');
            outputArr = runOutput;
            break;
        case 'gdb':
            outputList = document.getElementById('gdbOutput');
            outputArr = gdbOutput;
            break;
        default:
            return;
    }
    
    if (!outputList) return;
    
    // Remove empty state
    const emptyEl = outputList.querySelector('.debug-output-empty');
    if (emptyEl) emptyEl.remove();
    
    const lines = text.split('\n');
    lines.forEach(line => {
        if (!line && lines.length > 1) return; // skip empty in multi-line
        
        const entry = document.createElement('div');
        entry.className = `debug-output-line ${type}`;
        entry.textContent = line;
        outputList.appendChild(entry);
        outputArr.push({ text: line, type, time: Date.now() });
    });
    
    // Trim old lines
    while (outputArr.length > MAX_OUTPUT_LINES) {
        outputArr.shift();
        outputList.firstChild?.remove();
    }
    
    outputList.scrollTop = outputList.scrollHeight;
}

// ============================================================================
// DLT LOG INTEGRATION
// ============================================================================

export function captureDltLog(msg) {
    dltLogBuffer.push({
        timestamp: new Date().toISOString(),
        level: msg.logLevel,
        ecu: msg.ecuId,
        app: msg.appId,
        ctx: msg.ctxId,
        payload: msg.payload
    });
    
    if (dltLogBuffer.length > MAX_DLT_BUFFER) {
        dltLogBuffer.shift();
    }
    
    // Update DLT log count in debug view
    const countEl = document.getElementById('debugDltCount');
    if (countEl) countEl.textContent = dltLogBuffer.length;
}

function getDltLogsForAi() {
    return dltLogBuffer.map(l => 
        `[${l.timestamp}] ${l.level} [${l.ecu}] ${l.app}:${l.ctx} - ${l.payload}`
    ).join('\n');
}

// ============================================================================
// AI DEBUG ASSISTANT
// ============================================================================

export function askAiDebug(customPrompt) {
    if (isAiProcessing) return;
    isAiProcessing = true;
    
    const aiOutput = document.getElementById('aiDebugOutput');
    if (aiOutput) {
        aiOutput.innerHTML = '<div class="ai-thinking">🤔 AI is analyzing...</div>';
    }
    
    // Gather context
    const context = {
        buildLog: buildOutput.slice(-50).map(l => l.text).join('\n'),
        runLog: runOutput.slice(-50).map(l => l.text).join('\n'),
        gdbLog: gdbOutput.slice(-30).map(l => l.text).join('\n'),
        dltLogs: getDltLogsForAi(),
        config: buildConfig
    };
    
    const prompt = customPrompt || document.getElementById('aiDebugPrompt')?.value || '';
    
    vscode.postMessage({
        command: 'aiDebugAnalyze',
        prompt,
        context
    });
}

export function handleAiResponse(response) {
    isAiProcessing = false;
    aiAnalysis = response;
    
    const aiOutput = document.getElementById('aiDebugOutput');
    if (!aiOutput) return;
    
    // Simple markdown-like rendering
    aiOutput.innerHTML = renderAiResponse(response);
    aiOutput.scrollTop = 0;
}

function renderAiResponse(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>')
        .replace(/^- (.+)$/gm, '<div class="ai-list-item">• $1</div>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

// ============================================================================
// STATUS UPDATES
// ============================================================================

function updateBuildStatus(status) {
    const indicator = document.getElementById('buildStatusDot');
    const label = document.getElementById('buildStatusLabel');
    if (!indicator || !label) return;
    
    indicator.className = 'status-dot ' + status;
    const labels = { building: 'Building...', success: 'Success', error: 'Failed', idle: 'Idle' };
    label.textContent = labels[status] || status;
}

function updateRunStatus(status) {
    const indicator = document.getElementById('runStatusDot');
    const label = document.getElementById('runStatusLabel');
    if (!indicator || !label) return;
    
    indicator.className = 'status-dot ' + status;
    const labels = { running: 'Running', stopped: 'Stopped', error: 'Error', idle: 'Idle' };
    label.textContent = labels[status] || status;
}

function updateGdbStatus(status) {
    const indicator = document.getElementById('gdbStatusDot');
    const label = document.getElementById('gdbStatusLabel');
    if (!indicator || !label) return;
    
    indicator.className = 'status-dot ' + status;
    const labels = { connecting: 'Connecting...', connected: 'Connected', disconnected: 'Disconnected', idle: 'Idle' };
    label.textContent = labels[status] || status;
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

export function switchDebugTab(tab) {
    const tabs = ['config', 'build', 'run', 'gdb', 'ai'];
    tabs.forEach(t => {
        const btn = document.getElementById(`debugTab-${t}`);
        const panel = document.getElementById(`debugPanel-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = t === tab ? 'flex' : 'none';
    });
}
