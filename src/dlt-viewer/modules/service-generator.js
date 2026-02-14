// ============================================================================
// DLT SERVICE GENERATOR MODULE
// Generates DLT service requests/responses using WASM
// ============================================================================

let wasmModule = null;
let wsManager = null;

export function initServiceGenerator(wasm, ws) {
    wasmModule = wasm;
    wsManager = ws;
}

export function setWasm(wasm) {
    wasmModule = wasm;
}

export function setWsManager(ws) {
    wsManager = ws;
}

// ============================================================================
// WASM HELPERS
// ============================================================================

function writeId(mem, ptr, str) {
    for (let i = 0; i < 4; i++) {
        mem[ptr + i] = i < str.length ? str.charCodeAt(i) : 0;
    }
}

function allocConfig12(ecuId, appId, ctxId) {
    const ptr = wasmModule.allocate(12);
    if (ptr === 0) return 0;
    const mem = new Uint8Array(wasmModule.memory.buffer);
    writeId(mem, ptr, ecuId);
    writeId(mem, ptr + 4, appId);
    writeId(mem, ptr + 8, ctxId);
    return ptr;
}

function allocId4(id) {
    const ptr = wasmModule.allocate(4);
    if (ptr === 0) return 0;
    const mem = new Uint8Array(wasmModule.memory.buffer);
    writeId(mem, ptr, id);
    return ptr;
}

// ============================================================================
// SERVICE REQUEST GENERATORS
// ============================================================================

/**
 * Generate and optionally send a SetLogLevel request
 */
export function generateSetLogLevel(ecuId, appId, ctxId, targetApp, targetCtx, logLevel, send = true) {
    if (!wasmModule || !wasmModule.generate_set_log_level_request) {
        console.error('WASM not available for service generation');
        return null;
    }

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = allocConfig12(ecuId, appId, ctxId);
        const targetAppPtr = allocId4(targetApp);
        const targetCtxPtr = allocId4(targetCtx);
        const outPtr = wasmModule.allocate(512);

        if (!configPtr || !targetAppPtr || !targetCtxPtr || !outPtr) return null;

        const size = wasmModule.generate_set_log_level_request(
            configPtr, targetAppPtr, targetCtxPtr, logLevel, outPtr, 512
        );

        if (size <= 0) {
            console.error('SetLogLevel generation failed:', size);
            return null;
        }

        const buffer = wasmModule.memory.buffer;
        const msg = new Uint8Array(buffer, outPtr, size).slice();

        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('SetLogLevel error:', e);
        return null;
    }
}

/**
 * Generate and optionally send a GetLogInfo request
 */
export function generateGetLogInfo(ecuId, appId, ctxId, options, targetApp, targetCtx, send = true) {
    if (!wasmModule || !wasmModule.generate_get_log_info_request) return null;

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = allocConfig12(ecuId, appId, ctxId);
        const targetAppPtr = allocId4(targetApp || '\0\0\0\0');
        const targetCtxPtr = allocId4(targetCtx || '\0\0\0\0');
        const outPtr = wasmModule.allocate(512);

        if (!configPtr || !targetAppPtr || !targetCtxPtr || !outPtr) return null;

        const size = wasmModule.generate_get_log_info_request(
            configPtr, options || 7, targetAppPtr, targetCtxPtr, outPtr, 512
        );

        if (size <= 0) return null;

        const msg = new Uint8Array(wasmModule.memory.buffer, outPtr, size).slice();
        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('GetLogInfo error:', e);
        return null;
    }
}

/**
 * Generate and optionally send a GetDefaultLogLevel request
 */
export function generateGetDefaultLogLevel(ecuId, appId, ctxId, send = true) {
    if (!wasmModule || !wasmModule.generate_get_default_log_level_request) return null;

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = allocConfig12(ecuId, appId, ctxId);
        const outPtr = wasmModule.allocate(512);

        if (!configPtr || !outPtr) return null;

        const size = wasmModule.generate_get_default_log_level_request(configPtr, outPtr, 512);
        if (size <= 0) return null;

        const msg = new Uint8Array(wasmModule.memory.buffer, outPtr, size).slice();
        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('GetDefaultLogLevel error:', e);
        return null;
    }
}

/**
 * Generate and optionally send a GetSoftwareVersion request
 */
export function generateGetSoftwareVersion(ecuId, appId, ctxId, send = true) {
    if (!wasmModule || !wasmModule.generate_get_software_version_request) return null;

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = allocConfig12(ecuId, appId, ctxId);
        const outPtr = wasmModule.allocate(512);

        if (!configPtr || !outPtr) return null;

        const size = wasmModule.generate_get_software_version_request(configPtr, outPtr, 512);
        if (size <= 0) return null;

        const msg = new Uint8Array(wasmModule.memory.buffer, outPtr, size).slice();
        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('GetSoftwareVersion error:', e);
        return null;
    }
}

/**
 * Generate and optionally send a custom DLT log message
 */
export function generateLogMessage(ecuId, appId, ctxId, logLevel, verbose, payload, send = true) {
    if (!wasmModule || !wasmModule.generate_log_message) return null;

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = wasmModule.allocate(24);
        if (!configPtr) return null;

        const mem = new Uint8Array(wasmModule.memory.buffer);
        const dv = new DataView(wasmModule.memory.buffer);

        writeId(mem, configPtr, ecuId);
        writeId(mem, configPtr + 4, appId);
        writeId(mem, configPtr + 8, ctxId);
        mem[configPtr + 12] = logLevel;
        mem[configPtr + 13] = verbose ? 1 : 0;
        mem[configPtr + 14] = 1; // num args
        mem[configPtr + 15] = 0;
        dv.setUint32(configPtr + 16, Date.now() & 0xFFFFFFFF, true);

        const payloadBytes = new TextEncoder().encode(payload);
        const payloadPtr = wasmModule.allocate(payloadBytes.length);
        if (!payloadPtr) return null;

        const mem2 = new Uint8Array(wasmModule.memory.buffer);
        mem2.set(payloadBytes, payloadPtr);

        const outPtr = wasmModule.allocate(512);
        if (!outPtr) return null;

        const size = wasmModule.generate_log_message(
            configPtr, payloadPtr, payloadBytes.length, outPtr, 512
        );

        if (size <= 0) return null;

        const msg = new Uint8Array(wasmModule.memory.buffer, outPtr, size).slice();
        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('LogMessage error:', e);
        return null;
    }
}

/**
 * Generate injection message (custom service ID with payload)
 */
export function generateInjectionMessage(ecuId, appId, ctxId, serviceId, payload, send = true) {
    if (!wasmModule || !wasmModule.generate_service_response) return null;

    try {
        if (wasmModule.reset_allocator) wasmModule.reset_allocator();

        const configPtr = allocConfig12(ecuId, appId, ctxId);
        const outPtr = wasmModule.allocate(512);

        if (!configPtr || !outPtr) return null;

        // Use generate_service_response with the custom service ID
        const size = wasmModule.generate_service_response(
            configPtr, serviceId, 0, outPtr, 512
        );

        if (size <= 0) return null;

        const msg = new Uint8Array(wasmModule.memory.buffer, outPtr, size).slice();
        if (send) sendMessage(msg);
        return msg;
    } catch (e) {
        console.error('Injection error:', e);
        return null;
    }
}

// ============================================================================
// SEND VIA WEBSOCKET
// ============================================================================

function sendMessage(bytes) {
    if (!wsManager) {
        console.warn('WebSocket manager not available');
        return false;
    }
    
    return wsManager.sendBinary(bytes);
}

// ============================================================================
// UI HANDLER
// ============================================================================

export function handleSendService() {
    const serviceType = document.getElementById('svcType')?.value;
    const ecuId = document.getElementById('svcEcu')?.value || 'ECU1';
    const appId = document.getElementById('svcApp')?.value || 'APP1';
    const ctxId = document.getElementById('svcCtx')?.value || 'CTX1';

    let result = null;
    let description = '';

    switch (serviceType) {
        case 'set_log_level': {
            const targetApp = document.getElementById('svcTargetApp')?.value || 'APP1';
            const targetCtx = document.getElementById('svcTargetCtx')?.value || 'CTX1';
            const level = parseInt(document.getElementById('svcLogLevel')?.value || '4');
            result = generateSetLogLevel(ecuId, appId, ctxId, targetApp, targetCtx, level);
            description = `SetLogLevel → ${targetApp}:${targetCtx} level=${level}`;
            break;
        }
        case 'get_log_info': {
            const targetApp = document.getElementById('svcTargetApp')?.value || '';
            const targetCtx = document.getElementById('svcTargetCtx')?.value || '';
            result = generateGetLogInfo(ecuId, appId, ctxId, 7, targetApp, targetCtx);
            description = `GetLogInfo${targetApp ? ` → ${targetApp}:${targetCtx}` : ' (all)'}`;
            break;
        }
        case 'get_default_log_level':
            result = generateGetDefaultLogLevel(ecuId, appId, ctxId);
            description = 'GetDefaultLogLevel';
            break;
        case 'get_sw_version':
            result = generateGetSoftwareVersion(ecuId, appId, ctxId);
            description = 'GetSoftwareVersion';
            break;
        case 'injection': {
            const svcId = parseInt(document.getElementById('svcInjectionId')?.value || '0xFFF', 16);
            const payload = document.getElementById('svcInjectionPayload')?.value || '';
            result = generateInjectionMessage(ecuId, appId, ctxId, svcId, payload);
            description = `Injection 0x${svcId.toString(16)}: ${payload}`;
            break;
        }
        case 'log_message': {
            const level = parseInt(document.getElementById('svcLogLevel')?.value || '4');
            const verbose = document.getElementById('svcVerbose')?.checked ?? true;
            const payload = document.getElementById('svcLogPayload')?.value || 'test';
            result = generateLogMessage(ecuId, appId, ctxId, level, verbose, payload);
            description = `LogMessage [${['','Fatal','Error','Warn','Info','Debug','Verbose'][level]}]: ${payload}`;
            break;
        }
    }

    // Log result to service history
    addServiceHistoryEntry(description, result);
    return result;
}

// ============================================================================
// SERVICE HISTORY
// ============================================================================

const serviceHistory = [];
const MAX_HISTORY = 50;

function addServiceHistoryEntry(description, result) {
    const entry = {
        time: new Date().toLocaleTimeString(),
        description,
        success: result !== null,
        size: result ? result.length : 0,
        hex: result ? Array.from(result.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ') : ''
    };

    serviceHistory.unshift(entry);
    if (serviceHistory.length > MAX_HISTORY) serviceHistory.pop();

    renderServiceHistory();
}

function renderServiceHistory() {
    const list = document.getElementById('svcHistory');
    if (!list) return;

    if (serviceHistory.length === 0) {
        list.innerHTML = '<div class="svc-history-empty">No messages sent yet</div>';
        return;
    }

    list.innerHTML = serviceHistory.map(e => `
        <div class="svc-history-entry ${e.success ? 'success' : 'error'}">
            <span class="svc-history-time">${e.time}</span>
            <span class="svc-history-desc">${e.success ? '✅' : '❌'} ${escapeHtml(e.description)}</span>
            <span class="svc-history-size">${e.size}B</span>
            ${e.hex ? `<div class="svc-history-hex">${e.hex}${e.size > 32 ? '...' : ''}</div>` : ''}
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function getServiceHistory() {
    return serviceHistory;
}
