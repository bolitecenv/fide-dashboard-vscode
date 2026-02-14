// ============================================================================
// DLT SERVICE PARSER MODULE
// Parses DLT service messages (control messages) using WASM
// ============================================================================

let wasmModule = null;

const SERVICE_IDS = {
    0x01: 'SetLogLevel',
    0x02: 'SetTraceStatus',
    0x03: 'GetLogInfo',
    0x04: 'GetDefaultLogLevel',
    0x05: 'StoreConfiguration',
    0x06: 'ResetToFactoryDefault',
    0x0A: 'SetMessageFiltering',
    0x11: 'SetDefaultLogLevel',
    0x12: 'SetDefaultTraceStatus',
    0x13: 'GetSoftwareVersion',
    0x15: 'GetDefaultTraceStatus',
    0x17: 'GetLogChannelNames',
    0x1F: 'GetTraceStatus'
};

const STATUS_CODES = {
    0: 'OK',
    1: 'NOT_SUPPORTED',
    2: 'ERROR',
    3: 'PENDING',
    6: 'WITH_LOG_LEVEL_AND_TRACE_STATUS',
    7: 'WITH_DESCRIPTIONS',
    8: 'NO_MATCHING_CONTEXTS',
    9: 'OVERFLOW'
};

const LOG_LEVELS = {
    1: 'Fatal',
    2: 'Error',
    3: 'Warn',
    4: 'Info',
    5: 'Debug',
    6: 'Verbose'
};

export function initServiceParser(wasm) {
    wasmModule = wasm;
}

/**
 * Parse a DLT service message packet
 * @param {Uint8Array} packet - Raw DLT packet bytes  
 * @returns {Object|null} Parsed service message or null
 */
export function parseServiceMessage(packet) {
    if (!wasmModule || !wasmModule.parse_service_message) {
        return parseServiceMessageFallback(packet);
    }

    try {
        if (wasmModule.reset_allocator) {
            wasmModule.reset_allocator();
        }

        const msgPtr = wasmModule.allocate(packet.length);
        if (msgPtr === 0) return null;

        let mem = new Uint8Array(wasmModule.memory.buffer);
        mem.set(packet, msgPtr);

        const resultPtr = wasmModule.allocate(48);
        if (resultPtr === 0) {
            wasmModule.deallocate(msgPtr);
            return null;
        }

        const rc = wasmModule.parse_service_message(msgPtr, packet.length, resultPtr);

        if (rc !== 0) {
            wasmModule.deallocate(msgPtr);
            wasmModule.deallocate(resultPtr);
            return null;
        }

        // Re-read memory after WASM call
        const buffer = wasmModule.memory.buffer;
        const result = new Uint8Array(buffer, resultPtr, 48);
        const dv = new DataView(buffer, resultPtr);

        const serviceId = dv.getUint32(0, true);
        const isResponse = result[4] === 1;
        const status = result[5];
        const mstp = result[6];
        const mtin = result[7];
        const ecuId = bytes4ToString(result.slice(8, 12));
        const appId = bytes4ToString(result.slice(12, 16));
        const ctxId = bytes4ToString(result.slice(16, 20));
        const payloadLen = dv.getUint16(20, true);
        const payloadOff = dv.getUint16(22, true);

        const parsed = {
            serviceId,
            serviceName: SERVICE_IDS[serviceId] || `Unknown(0x${serviceId.toString(16)})`,
            isResponse,
            status,
            statusName: STATUS_CODES[status] || `Unknown(${status})`,
            mstp,
            mtin,
            ecuId,
            appId,
            ctxId,
            payloadLen,
            payloadOff,
            params: {}
        };

        // Extract service-specific parameters
        if (serviceId === 0x01) { // SetLogLevel
            const tAppBytes = new Uint8Array(buffer, resultPtr + 24, 4);
            const tCtxBytes = new Uint8Array(buffer, resultPtr + 28, 4);
            parsed.params.targetApp = bytes4ToString(tAppBytes);
            parsed.params.targetCtx = bytes4ToString(tCtxBytes);
            parsed.params.logLevel = result[32];
            parsed.params.logLevelName = LOG_LEVELS[result[32]] || `Level(${result[32]})`;
        } else if (serviceId === 0x04 && isResponse) { // GetDefaultLogLevel response
            parsed.params.logLevel = result[32];
            parsed.params.logLevelName = LOG_LEVELS[result[32]] || `Level(${result[32]})`;
        } else if (serviceId === 0x13 && isResponse) { // GetSoftwareVersion response
            const verLen = dv.getUint32(24, true);
            const verOff = dv.getUint32(28, true);
            if (verLen > 0 && verOff < packet.length) {
                const msgMem = new Uint8Array(buffer, msgPtr + verOff, verLen);
                parsed.params.version = new TextDecoder().decode(msgMem.slice(0));
            }
        }

        wasmModule.deallocate(msgPtr);
        wasmModule.deallocate(resultPtr);

        return parsed;
    } catch (error) {
        console.error('Service parse error:', error);
        return null;
    }
}

function parseServiceMessageFallback(packet) {
    // Minimal fallback: detect control messages from MSTP bits
    if (packet.length < 16) return null;
    
    const htyp = packet[0];
    const hasExtHeader = (htyp & 0x01) !== 0;
    
    if (!hasExtHeader) return null;
    
    let offset = 4; // skip standard header minimum
    const hasEcu = (htyp & 0x04) !== 0;
    const hasSeid = (htyp & 0x08) !== 0;
    const hasTmsp = (htyp & 0x10) !== 0;
    
    if (hasEcu) offset += 4;
    if (hasSeid) offset += 4;
    if (hasTmsp) offset += 4;
    
    if (offset + 4 > packet.length) return null;
    
    const msin = packet[offset];
    const mstp = (msin >> 1) & 0x07;
    
    // MSTP=3 means control message
    if (mstp !== 3) return null;
    
    return {
        serviceId: 0,
        serviceName: 'Unknown (fallback)',
        isResponse: false,
        status: 0,
        statusName: 'Unknown',
        mstp,
        mtin: (msin >> 4) & 0x0F,
        ecuId: '',
        appId: '',
        ctxId: '',
        payloadLen: 0,
        payloadOff: 0,
        params: {}
    };
}

function bytes4ToString(bytes) {
    return String.fromCharCode(...bytes).replace(/\0/g, '').trim();
}

export function getServiceName(id) {
    return SERVICE_IDS[id] || `0x${id.toString(16).padStart(2, '0')}`;
}

export function getStatusName(code) {
    return STATUS_CODES[code] || `Unknown(${code})`;
}

export function getLogLevelName(level) {
    return LOG_LEVELS[level] || `Level(${level})`;
}

export { SERVICE_IDS, STATUS_CODES, LOG_LEVELS };
