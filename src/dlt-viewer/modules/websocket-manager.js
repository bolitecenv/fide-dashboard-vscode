// ============================================================================
// WEBSOCKET MANAGER MODULE
// ============================================================================

/**
 * WebSocket Manager Module
 * Handles WebSocket connection and message routing
 */

let ws = null;
let wsConnected = false;
let wsPort = 8083;
let packetType = 'text'; // 'text' or 'dlt'

// Message handlers (injected from main)
let textMessageHandler = null;
let binaryMessageHandler = null;

export function initWebSocketManager(config) {
    wsPort = config.wsPort || 8083;
    packetType = config.packetType || 'text';
    textMessageHandler = config.textMessageHandler;
    binaryMessageHandler = config.binaryMessageHandler;
    
    return { wsPort, packetType };
}

export function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        return;
    }

    const wsUrl = `ws://localhost:${wsPort}`;
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        wsConnected = true;
        updateConnectionStatus();
        console.log(`✅ Connected to ${wsUrl}`);
    };

    ws.onmessage = (event) => {
        if (packetType === 'text') {
            if (textMessageHandler) {
                textMessageHandler(event.data);
            }
        } else {
            if (binaryMessageHandler) {
                binaryMessageHandler(event.data);
            }
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
    
    return wsConnected;
}

export function updateConnectionStatus() {
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

export function applyConfig() {
    const newPort = parseInt(document.getElementById('wsPort').value);
    const newPacketType = document.getElementById('packetType').value;
    
    wsPort = newPort;
    packetType = newPacketType;
    
    toggleConfig();
    
    // Reconnect with new settings
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    setTimeout(() => connectWebSocket(), 100);
    
    return { wsPort, packetType };
}

export function toggleConfig() {
    const configPanel = document.getElementById('configPanel');
    configPanel.style.display = configPanel.style.display === 'none' ? 'block' : 'none';
}

export function getConnectionInfo() {
    return { wsConnected, wsPort, packetType };
}

export function sendBinary(bytes) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected, cannot send');
        return false;
    }
    try {
        ws.send(bytes.buffer || bytes);
        return true;
    } catch (e) {
        console.error('WebSocket send error:', e);
        return false;
    }
}

export function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected, cannot send');
        return false;
    }
    try {
        ws.send(text);
        return true;
    } catch (e) {
        console.error('WebSocket send error:', e);
        return false;
    }
}
