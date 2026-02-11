const vscode = acquireVsCodeApi();
let isThinking = false;

// Auto-resize textarea
const textarea = document.getElementById('messageInput');
textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// Send on Enter (Shift+Enter for new line)
textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || isThinking) return;
    
    vscode.postMessage({
        command: 'sendMessage',
        text: text
    });
    
    input.value = '';
    input.style.height = 'auto';
}

function clearChat() {
    vscode.postMessage({ command: 'clearChat' });
}

function addMessage(role, content) {
    const container = document.getElementById('chatContainer');
    
    // Remove empty state
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.textContent = content;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function addPlanningMessage(content) {
    const container = document.getElementById('chatContainer');
    
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    const planningDiv = document.createElement('div');
    planningDiv.className = 'message planning';
    planningDiv.innerHTML = `<strong>📋 Planning:</strong> ${content}`;
    
    container.appendChild(planningDiv);
    container.scrollTop = container.scrollHeight;
}

function addToolExecution(toolName, input) {
    const container = document.getElementById('chatContainer');
    
    const toolDiv = document.createElement('div');
    toolDiv.className = 'message tool-execution';
    toolDiv.innerHTML = `
        <div class="tool-header">
            <strong>🔧 ${toolName}</strong>
        </div>
        <div class="tool-params">${JSON.stringify(input, null, 2)}</div>
    `;
    
    container.appendChild(toolDiv);
    container.scrollTop = container.scrollHeight;
}

function addToolResult(toolName, result, fullResult) {
    const container = document.getElementById('chatContainer');
    
    const resultDiv = document.createElement('div');
    resultDiv.className = 'message tool-result collapsed';
    resultDiv.innerHTML = `
        <div class="tool-result-header" onclick="toggleToolResult(this)">
            <strong>✅ Result</strong>
            <span class="expand-icon">▼</span>
        </div>
        <div class="tool-result-preview">${result}</div>
        <div class="tool-result-full" style="display: none;">${fullResult}</div>
    `;
    resultDiv.dataset.fullResult = fullResult;
    
    container.appendChild(resultDiv);
    container.scrollTop = container.scrollHeight;
}

function toggleToolResult(header) {
    const resultDiv = header.closest('.tool-result');
    const preview = resultDiv.querySelector('.tool-result-preview');
    const full = resultDiv.querySelector('.tool-result-full');
    const icon = resultDiv.querySelector('.expand-icon');
    
    if (resultDiv.classList.contains('collapsed')) {
        resultDiv.classList.remove('collapsed');
        preview.style.display = 'none';
        full.style.display = 'block';
        icon.textContent = '▲';
    } else {
        resultDiv.classList.add('collapsed');
        preview.style.display = 'block';
        full.style.display = 'none';
        icon.textContent = '▼';
    }
}

function setThinking(thinking) {
    isThinking = thinking;
    const container = document.getElementById('chatContainer');
    const sendBtn = document.getElementById('sendBtn');
    
    sendBtn.disabled = thinking;
    
    let thinkingDiv = container.querySelector('.thinking');
    
    if (thinking && !thinkingDiv) {
        thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking';
        thinkingDiv.innerHTML = '<span class="dots">Thinking</span>';
        container.appendChild(thinkingDiv);
        container.scrollTop = container.scrollHeight;
    } else if (!thinking && thinkingDiv) {
        thinkingDiv.remove();
    }
}

function clearMessages() {
    const container = document.getElementById('chatContainer');
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">🤖</div>
            <h2>AI Agent Ready</h2>
            <p>I can help you with:</p>
            <p>• Searching and reading files</p>
            <p>• Editing code</p>
            <p>• Running build commands (cargo, make, npm, etc.)</p>
            <p>• Understanding your project structure</p>
        </div>
    `;
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'addMessage':
            addMessage(message.role, message.content);
            break;
        case 'addPlanningMessage':
            addPlanningMessage(message.content);
            break;
        case 'addToolExecution':
            addToolExecution(message.toolName, message.input);
            break;
        case 'addToolResult':
            addToolResult(message.toolName, message.result, message.fullResult);
            break;
        case 'setThinking':
            setThinking(message.thinking);
            break;
        case 'clearMessages':
            clearMessages();
            break;
    }
});
