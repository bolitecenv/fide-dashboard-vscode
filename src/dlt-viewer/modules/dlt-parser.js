// ============================================================================
// DLT PARSER MODULE
// ============================================================================

/**
 * DLT Parser Module
 * Handles DLT packet parsing using WASM module
 */

// WASM Module state
let wasmModule = null;
let wasmMemory = null;
let wasmInitialized = false;

// DLT Statistics
let dltPacketBuffer = new Uint8Array(0);
let dltMessagesReceived = 0;
let dltMessagesIncorrect = 0;

export function initDltParser() {
    return { dltPacketBuffer, dltMessagesReceived, dltMessagesIncorrect };
}

export async function initWasm() {
    const wasmUri = document.body.getAttribute('data-wasm-uri');
    if (!wasmUri) {
        console.error('❌ WASM URI not found in data attribute');
        return false;
    }

    try {
        console.log(`🔄 Loading WASM from: ${wasmUri}`);
        const response = await fetch(wasmUri);
        const wasmBytes = await response.arrayBuffer();
        
        const wasmImports = { env: {} };
        const wasmObj = await WebAssembly.instantiate(wasmBytes, wasmImports);
        wasmModule = wasmObj.instance.exports;
        wasmMemory = wasmModule.memory;
        wasmInitialized = true;
        
        const version = wasmModule.get_version ? wasmModule.get_version() : 0;
        console.log(`✅ WASM module loaded! Version: ${version}, Heap: ${wasmModule.get_heap_capacity()} bytes`);
        return true;
    } catch (error) {
        console.error('❌ Failed to load WASM module:', error);
        wasmInitialized = false;
        return false;
    }
}

export function handleDltBinaryMessage(data, displayCallback) {
    let arrayBuffer;
    
    if (data instanceof ArrayBuffer) {
        arrayBuffer = data;
    } else if (data instanceof Blob) {
        console.warn('⚠️ Received Blob instead of ArrayBuffer, converting...');
        const reader = new FileReader();
        reader.onload = () => handleDltBinaryMessage(reader.result, displayCallback);
        reader.readAsArrayBuffer(data);
        return;
    } else if (typeof data === 'string') {
        console.error('❌ Received text data in DLT binary mode. Check packetType configuration.');
        return;
    } else {
        console.error('❌ Unknown data type received:', typeof data);
        return;
    }
    
    const newData = new Uint8Array(arrayBuffer);
    const combinedBuffer = new Uint8Array(dltPacketBuffer.length + newData.length);
    combinedBuffer.set(dltPacketBuffer, 0);
    combinedBuffer.set(newData, dltPacketBuffer.length);
    dltPacketBuffer = combinedBuffer;
    
    console.log(`📦 Added ${newData.length} bytes to buffer, total buffer size: ${dltPacketBuffer.length} bytes`);
    
    while (dltPacketBuffer.length >= 4) {
        const packetLength = (dltPacketBuffer[2] << 8) | dltPacketBuffer[3];
        
        console.log(`🔍 Buffer has ${dltPacketBuffer.length} bytes, next packet expects ${packetLength} bytes`);
        
        if (packetLength < 4 || packetLength > 65535) {
            console.error('❌ Invalid DLT packet length:', packetLength);
            dltMessagesIncorrect++;
            updateDltStats();
            dltPacketBuffer = dltPacketBuffer.slice(1);
            continue;
        }
        
        if (dltPacketBuffer.length < packetLength) {
            console.log(`⏳ Waiting for more data: have ${dltPacketBuffer.length}, need ${packetLength}`);
            break;
        }
        
        const packet = dltPacketBuffer.slice(0, packetLength);
        dltPacketBuffer = dltPacketBuffer.slice(packetLength);
        
        console.log(`✂️ Extracted complete packet (${packetLength} bytes), remaining buffer: ${dltPacketBuffer.length} bytes`);
        
        try {
            const parsedMessage = parseDltPacket(packet);
            
            if (parsedMessage) {
                dltMessagesReceived++;
                updateDltStats();
                console.log('✅ DLT Message:', parsedMessage);
                
                if (displayCallback) {
                    displayCallback(parsedMessage);
                }
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
    
    return { dltPacketBuffer, dltMessagesReceived, dltMessagesIncorrect };
}

function parseDltPacket(packet) {
    if (!wasmInitialized || !wasmModule) {
        console.warn('⚠️ WASM not initialized, using fallback parser');
        return parseDltPacketFallback(packet);
    }
    
    try {
        // Reset allocator to prevent memory corruption from accumulated allocations
        if (wasmModule.reset_allocator) {
            wasmModule.reset_allocator();
        }

        const packetPtr = wasmModule.allocate(packet.length);
        if (packetPtr === 0) {
            console.error('❌ WASM allocation failed');
            return null;
        }
        
        // Get fresh buffer reference for writing
        let memory = new Uint8Array(wasmModule.memory.buffer);
        memory.set(packet, packetPtr);
        
        const resultPtr = wasmModule.analyze_dlt_message(packetPtr, packet.length);
        
        if (resultPtr === 0) {
            wasmModule.deallocate(packetPtr);
            console.error('❌ WASM analyze_dlt_message returned null');
            return null;
        }
        
        // IMPORTANT: Get fresh buffer reference after WASM call (memory may have grown)
        let buffer = wasmModule.memory.buffer;
        memory = new Uint8Array(buffer);
        const dataView = new DataView(buffer);

        const totalLen = dataView.getUint16(resultPtr, true);
        const headerLen = dataView.getUint16(resultPtr + 2, true);
        const payloadLen = dataView.getUint16(resultPtr + 4, true);
        const payloadOffset = dataView.getUint16(resultPtr + 6, true);
        const msgType = memory[resultPtr + 8];
        const logLevel = memory[resultPtr + 9];
        const hasSerial = memory[resultPtr + 10];
        const hasEcu = memory[resultPtr + 11];

        const ecuId = bytes4ToString(Array.from(memory.slice(resultPtr + 12, resultPtr + 16)));
        const appId = bytes4ToString(Array.from(memory.slice(resultPtr + 16, resultPtr + 20)));
        const ctxId = bytes4ToString(Array.from(memory.slice(resultPtr + 20, resultPtr + 24)));
        
        // Extract payload
        let payload = '';
        if (payloadLen > 0) {
            if (wasmModule.format_verbose_payload) {
                const payloadFormatLen = wasmModule.format_verbose_payload(
                    packetPtr,
                    packet.length,
                    payloadOffset,
                    payloadLen
                );
                
                if (payloadFormatLen > 0 && wasmModule.get_formatted_payload_ptr) {
                    const formattedPtr = wasmModule.get_formatted_payload_ptr();
                    if (formattedPtr !== 0) {
                        // Get fresh buffer reference after WASM call
                        const freshBuffer = wasmModule.memory.buffer;
                        const freshMemory = new Uint8Array(freshBuffer);
                        const formatted = freshMemory.slice(formattedPtr, formattedPtr + payloadFormatLen);
                        payload = new TextDecoder().decode(formatted);
                    }
                } else {
                    // Fallback: raw payload decode (payloadOffset is relative to message start)
                    const payloadBytes = memory.slice(packetPtr + payloadOffset, packetPtr + payloadOffset + payloadLen);
                    payload = new TextDecoder('utf-8', { fatal: false }).decode(payloadBytes);
                }
            } else {
                // No format_verbose_payload available — decode raw bytes
                const payloadBytes = memory.slice(packetPtr + payloadOffset, packetPtr + payloadOffset + payloadLen);
                payload = new TextDecoder('utf-8', { fatal: false }).decode(payloadBytes);
            }
        }
        
        wasmModule.deallocate(packetPtr);
        wasmModule.deallocate(resultPtr);
        
        return {
            timestamp: Date.now(),
            ecuId: ecuId,
            appId: appId,
            ctxId: ctxId,
            logLevel: getLogLevelString(logLevel),
            logLevelNum: logLevel,
            msgType: `0x${msgType.toString(16).padStart(2, '0')}`,
            totalLen: totalLen,
            headerLen: headerLen,
            payloadLen: payloadLen,
            payload: payload || '(empty)',
            hasSerial: hasSerial === 1,
            hasEcu: hasEcu === 1
        };
    } catch (error) {
        console.error('❌ WASM parsing error:', error);
        return null;
    }
}

function parseDltPacketFallback(packet) {
    if (packet.length < 4) return null;
    
    const packetLength = (packet[2] << 8) | packet[3];
    if (packet.length !== packetLength) return null;
    
    const htyp = packet[0];
    const mcnt = packet[1];
    
    const hexDump = Array.from(packet.slice(0, Math.min(32, packet.length)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    return {
        timestamp: Date.now(),
        ecuId: 'UNKNOWN',
        appId: 'UNKNOWN',
        ctxId: 'UNKNOWN',
        logLevel: 'INFO',
        logLevelNum: 4,
        msgType: `0x${htyp.toString(16).padStart(2, '0')}`,
        totalLen: packetLength,
        headerLen: 0,
        payloadLen: 0,
        payload: `Fallback: HTYP=0x${htyp.toString(16)}, MCNT=${mcnt}, LEN=${packetLength}, Hex: ${hexDump}${packet.length > 32 ? '...' : ''}`,
        hasSerial: false,
        hasEcu: false
    };
}

function bytes4ToString(bytes) {
    return String.fromCharCode(...bytes).replace(/\0/g, '').trim();
}

function getLogLevelString(level) {
    const levels = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'VERBOSE'];
    return levels[level] || `LEVEL_${level}`;
}

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

export function displayDltMessage(msg) {
    const logList = document.getElementById('logList');
    if (!logList) return;
    
    const emptyMsg = logList.querySelector('.log-empty');
    if (emptyMsg) {
        emptyMsg.remove();
    }
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-level-${msg.logLevel.toLowerCase()}`;
    
    let levelColor = '#007acc';
    switch (msg.logLevelNum) {
        case 0: levelColor = '#d14'; break;
        case 1: levelColor = '#f14c4c'; break;
        case 2: levelColor = '#f9a825'; break;
        case 3: levelColor = '#4ec9b0'; break;
        case 4: levelColor = '#608b4e'; break;
        case 5: levelColor = '#858585'; break;
    }
    
    logEntry.innerHTML = `
        <div class="log-header" style="border-left: 3px solid ${levelColor}; padding-left: 8px;">
            <span class="log-time">${new Date().toLocaleTimeString()}.${Date.now() % 1000}</span>
            <span class="log-level" style="color: ${levelColor}; font-weight: bold;">${msg.logLevel}</span>
            <span class="log-ecu">[${msg.ecuId || 'N/A'}]</span>
            <span class="log-app">${msg.appId || 'N/A'}</span>
            <span class="log-ctx">:${msg.ctxId || 'N/A'}</span>
        </div>
        <div class="log-payload">${escapeHtml(msg.payload)}</div>
        <div class="log-meta" style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 4px;">
            Packet: ${msg.totalLen}B (Hdr: ${msg.headerLen}B, Payload: ${msg.payloadLen}B) | ${msg.hasSerial ? '📡 Serial' : ''} ${msg.hasEcu ? '🔧 ECU' : ''}
        </div>
    `;
    
    logList.appendChild(logEntry);
    logList.scrollTop = logList.scrollHeight;
    
    const entries = logList.querySelectorAll('.log-entry');
    if (entries.length > 1000) {
        entries[0].remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function getDltStats() {
    return { dltMessagesReceived, dltMessagesIncorrect };
}

export function resetDltStats() {
    dltPacketBuffer = new Uint8Array(0);
    dltMessagesReceived = 0;
    dltMessagesIncorrect = 0;
    updateDltStats();
    return { dltPacketBuffer, dltMessagesReceived, dltMessagesIncorrect };
}
