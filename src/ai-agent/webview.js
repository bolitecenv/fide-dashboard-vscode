const vscode = acquireVsCodeApi();
let isThinking = false;

// DOM is ready since script is at bottom of body
(function init() {
    const textarea = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');

    // Auto-resize textarea
    if (textarea) {
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });

        textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', function () {
            sendMessage();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            isThinking = false;
            setThinking(false);
            vscode.postMessage({ command: 'clearChat' });
        });
    }

    // Suggestion chips — force-send even if isThinking is stale
    document.addEventListener('click', function (e) {
        const chip = e.target.closest('.suggestion-chip');
        if (chip && chip.dataset.prompt) {
            // Reset stale thinking state so chips always work
            isThinking = false;
            sendMessage(chip.dataset.prompt);
        }
    });
})();

function sendMessage(text) {
    const input = document.getElementById('messageInput');
    if (!input) return;

    const messageText = (typeof text === 'string') ? text : input.value.trim();
    if (!messageText || isThinking) return;

    vscode.postMessage({ command: 'sendMessage', text: messageText });

    input.value = '';
    input.style.height = 'auto';
}

// --- Markdown rendering ---
function renderMarkdown(text) {
    if (!text) return '';

    let html = text;

    // Escape HTML first
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Fenced code blocks: ```lang\ncode\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
        const langLabel = lang ? '<span class="code-lang">' + lang + '</span>' : '';
        return '<div class="code-block">' + langLabel + '<pre><code>' + code.trimEnd() + '</code></pre></div>';
    });

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // Unordered lists
    html = html.replace(/^(\s*)[*-] (.+)$/gm, '<li>$2</li>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs: split by double newlines
    const parts = html.split(/\n\n+/);
    html = parts.map(function (p) {
        p = p.trim();
        if (!p) return '';
        if (p.match(/^<(ul|ol|pre|div|h[1-6]|li)/)) return p;
        // Convert single newlines to <br> within paragraphs
        return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    return html;
}

// --- Message rendering ---
function createMessageWrapper(role) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'message-icon ' + role;
    if (role === 'user') {
        iconDiv.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-3.31 0-6 1.79-6 4v1h12v-1c0-2.21-2.69-4-6-4z"/></svg>';
    } else {
        iconDiv.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L9.5 5.5L14 6L10.5 9L11.5 14L8 11.5L4.5 14L5.5 9L2 6L6.5 5.5L8 1Z"/></svg>';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    wrapper.appendChild(iconDiv);
    wrapper.appendChild(contentDiv);

    return { wrapper: wrapper, content: contentDiv };
}

function removeEmptyState() {
    const container = document.getElementById('chatContainer');
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
}

function addMessage(role, content) {
    removeEmptyState();
    const container = document.getElementById('chatContainer');

    const msg = createMessageWrapper(role);
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role;

    if (role === 'assistant') {
        messageDiv.innerHTML = renderMarkdown(content);
    } else {
        messageDiv.textContent = content;
    }

    msg.content.appendChild(messageDiv);
    container.appendChild(msg.wrapper);
    container.scrollTop = container.scrollHeight;
}

function addErrorMessage(content) {
    removeEmptyState();
    const container = document.getElementById('chatContainer');

    const msg = createMessageWrapper('assistant');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error';
    errorDiv.textContent = content;

    msg.content.appendChild(errorDiv);
    container.appendChild(msg.wrapper);
    container.scrollTop = container.scrollHeight;
}

function addToolExecution(toolName, input) {
    const container = document.getElementById('chatContainer');

    const detailsEl = document.createElement('details');
    detailsEl.className = 'tool-details';

    const summaryEl = document.createElement('summary');
    summaryEl.className = 'tool-summary';

    const spinner = document.createElement('span');
    spinner.className = 'tool-spinner';

    const label = document.createElement('span');
    label.textContent = formatToolLabel(toolName, input);

    summaryEl.appendChild(spinner);
    summaryEl.appendChild(label);
    detailsEl.appendChild(summaryEl);

    const paramsDiv = document.createElement('div');
    paramsDiv.className = 'tool-params';
    paramsDiv.textContent = JSON.stringify(input, null, 2);
    detailsEl.appendChild(paramsDiv);

    container.appendChild(detailsEl);
    container.scrollTop = container.scrollHeight;
}

function formatToolLabel(toolName, input) {
    switch (toolName) {
        case 'search_files': return 'Searching for "' + (input.pattern || '') + '"';
        case 'read_file': return 'Reading ' + (input.path || '');
        case 'write_file': return 'Writing ' + (input.path || '');
        case 'execute_command': return 'Running `' + (input.command || '') + '`';
        case 'list_directory': return 'Listing ' + (input.path || '.');
        case 'build_project': return 'Building project' + (input.command ? ': ' + input.command : '');
        case 'run_project': return 'Flashing & monitoring RTT' + (input.command ? ': ' + input.command : '');
        case 'start_gdb': return 'Starting GDB session';
        case 'send_gdb_command': return 'GDB: ' + (input.command || '');
        case 'stop_process': return 'Stopping ' + (input.process || 'process');
        case 'get_build_config': return 'Reading build config';
        case 'save_build_config': return 'Saving build config';
        case 'get_diagnostics': return 'Getting diagnostics' + (input.path ? ' for ' + input.path : '');
        case 'get_rtt_output': return 'Reading RTT log buffer';
        default: return toolName;
    }
}

function addToolResult(toolName, result, fullResult) {
    const container = document.getElementById('chatContainer');

    // Find the last tool-details and update it
    const allDetails = container.querySelectorAll('.tool-details');
    const lastDetails = allDetails[allDetails.length - 1];
    if (lastDetails) {
        // Replace spinner with checkmark
        const spinner = lastDetails.querySelector('.tool-spinner');
        if (spinner) {
            spinner.className = 'tool-check';
            spinner.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.27 10.87l-2.3-2.3-.94.94 3.24 3.24 6.97-6.97-.94-.94z"/></svg>';
        }

        const resultDiv = document.createElement('div');
        resultDiv.className = 'tool-result-content';
        resultDiv.textContent = fullResult;
        lastDetails.appendChild(resultDiv);
    }
}

function setThinking(thinking) {
    isThinking = thinking;
    const sendBtn = document.getElementById('sendBtn');
    const container = document.getElementById('chatContainer');

    if (sendBtn) sendBtn.disabled = thinking;

    let existing = container.querySelector('.thinking-wrapper');

    if (thinking && !existing) {
        const wrapper = document.createElement('div');
        wrapper.className = 'thinking-wrapper';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'message-icon assistant';
        iconDiv.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L9.5 5.5L14 6L10.5 9L11.5 14L8 11.5L4.5 14L5.5 9L2 6L6.5 5.5L8 1Z"/></svg>';

        const content = document.createElement('div');
        content.className = 'message-content';

        const thinkDiv = document.createElement('div');
        thinkDiv.className = 'thinking';
        thinkDiv.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';

        content.appendChild(thinkDiv);
        wrapper.appendChild(iconDiv);
        wrapper.appendChild(content);
        container.appendChild(wrapper);
        container.scrollTop = container.scrollHeight;
    } else if (!thinking && existing) {
        existing.remove();
    }
}

function clearMessages() {
    const container = document.getElementById('chatContainer');
    container.innerHTML = '<div class="empty-state">'
        + '<div class="empty-state-icon"><svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L9.5 5.5L14 6L10.5 9L11.5 14L8 11.5L4.5 14L5.5 9L2 6L6.5 5.5L8 1Z"/></svg></div>'
        + '<h2>Code, Build, Flash &amp; Fix</h2>'
        + '<p class="empty-state-description">I can write code, build, flash via probe-rs, monitor RTT logs, debug with GDB, and auto-fix issues.</p>'
        + '<div class="empty-suggestions" id="emptySuggestions">'
        + '<button class="suggestion-chip" data-prompt="Build the project and fix any errors automatically">&#x1F528; Build &amp; auto-fix errors</button>'
        + '<button class="suggestion-chip" data-prompt="Build the project, flash it via probe-rs, and monitor RTT output. Check for \'#AI working\' marker to confirm it runs.">&#x1F4E1; Build, flash &amp; monitor RTT</button>'
        + '<button class="suggestion-chip" data-prompt="Build, flash, and validate the firmware runs. If \'#AI working\' is not seen, analyze the hang and fix the code, then retry.">&#x1F504; Auto build-flash-fix loop</button>'
        + '<button class="suggestion-chip" data-prompt="Show the current build configuration">&#x2699;&#xFE0F; Show build config</button>'
        + '<button class="suggestion-chip" data-prompt="Analyze all compiler errors and warnings, then fix them">&#x1F41B; Fix all diagnostics</button>'
        + '<button class="suggestion-chip" data-prompt="Show me the project structure">&#x1F4C1; Show project structure</button>'
        + '</div></div>';
}

// --- Message handler ---
window.addEventListener('message', function (event) {
    var message = event.data;
    switch (message.command) {
        case 'addMessage':
            if (message.role === 'error') {
                addErrorMessage(message.content);
            } else {
                addMessage(message.role, message.content);
            }
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
        case 'addBuildStatus':
            addBuildStatusBanner(message.status, message.cmd, message.exitCode);
            break;
    }
});

function addBuildStatusBanner(status, cmd, exitCode) {
    var container = document.getElementById('chatContainer');
    if (!container) return;

    // Remove previous status banner if exists
    var prev = container.querySelector('.build-status-banner');
    if (prev) prev.remove();

    var banner = document.createElement('div');
    banner.className = 'build-status-banner';

    var icons = {
        'building': '&#x1F528;',
        'running': '&#x25B6;&#xFE0F;',
        'success': '&#x2705;',
        'failed': '&#x274C;',
        'error': '&#x274C;',
        'stopped': '&#x23F9;&#xFE0F;',
        'timeout': '&#x23F3;',
        'rtt-ok': '&#x2705;',
        'rtt-timeout': '&#x26A0;&#xFE0F;',
        'rtt-panic': '&#x1F4A5;',
        'probe-error': '&#x1F50C;',
        'gdb-connecting': '&#x1F41B;',
        'gdb-connected': '&#x1F7E2;',
        'gdb-error': '&#x274C;'
    };
    var labels = {
        'building': 'Building...',
        'running': 'Flashing & monitoring RTT...',
        'success': 'Build succeeded',
        'failed': 'Build failed (exit ' + exitCode + ')',
        'error': 'Process error',
        'stopped': 'Process stopped (exit ' + exitCode + ')',
        'timeout': 'Process timed out',
        'rtt-ok': '#AI working detected — target running!',
        'rtt-timeout': 'RTT marker not seen — MCU may be hung',
        'rtt-panic': 'Panic/fault detected in RTT!',
        'probe-error': 'Probe/USB connection failed — reconnect debugger',
        'gdb-connecting': 'GDB connecting...',
        'gdb-connected': 'GDB connected',
        'gdb-error': 'GDB error'
    };

    var isActive = (status === 'building' || status === 'running' || status === 'gdb-connecting');
    var isError = (status === 'failed' || status === 'error' || status === 'gdb-error' || status === 'rtt-panic' || status === 'probe-error');
    var isSuccess = (status === 'success' || status === 'gdb-connected' || status === 'rtt-ok');
    var isWarn = (status === 'rtt-timeout');

    banner.className = 'build-status-banner' + (isActive ? ' active' : '') + (isError ? ' error' : '') + (isSuccess ? ' success' : '') + (isWarn ? ' warn' : '');
    banner.innerHTML = '<span class="build-status-icon">' + (icons[status] || '') + '</span> '
        + '<span class="build-status-label">' + (labels[status] || status) + '</span>'
        + (cmd ? ' <span class="build-status-cmd">' + cmd + '</span>' : '');

    container.appendChild(banner);
    container.scrollTop = container.scrollHeight;
}
