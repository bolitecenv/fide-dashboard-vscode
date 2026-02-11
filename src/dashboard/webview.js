const vscode = acquireVsCodeApi();

let boards = [];
let selectedBoard = null;

// Load boards on startup
loadBoards();

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'boardsLoaded':
            displayBoards(message.boards);
            break;
        case 'projectCreated':
            handleProjectCreated(message);
            break;
        case 'logsUpdated':
            displayLogs(message.logs);
            break;
        case 'logAdded':
            addLogEntry(message.log);
            break;
    }
});

function switchTab(tabName, element) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    if (element) {
        element.classList.add('active');
    }

    // Update pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    // Refresh logs when switching to logs tab
    if (tabName === 'logs') {
        refreshLogs();
    }
}

function openDltViewer() {
    vscode.postMessage({ command: 'openDltViewer' });
}

function openAiAgent() {
    vscode.postMessage({ command: 'openAiAgent' });
}

function loadBoards() {
    vscode.postMessage({ command: 'getBoards' });
}

function refreshLogs() {
    vscode.postMessage({ command: 'getLogs' });
}

function displayBoards(boardList) {
    boards = boardList;
    const grid = document.getElementById('boardsGrid');
    const loading = document.getElementById('boardsLoading');
    
    loading.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    boardList.forEach(board => {
        const card = document.createElement('div');
        card.className = 'board-card';
        card.onclick = () => selectBoard(board.id);
        card.innerHTML = `
            <h3>${board.name}</h3>
            <p><strong>MCU:</strong> ${board.mcu}</p>
            <p><strong>Architecture:</strong> ${board.architecture}</p>
            <div class="board-specs">
                <div class="spec">
                    <span class="spec-label">RAM</span>
                    <span class="spec-value">${board.ram_kb} KB</span>
                </div>
                <div class="spec">
                    <span class="spec-label">Flash</span>
                    <span class="spec-value">${board.flash_kb} KB</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function selectBoard(boardId) {
    selectedBoard = boardId;
    
    // Update UI
    document.querySelectorAll('.board-card').forEach((card, index) => {
        if (boards[index].id === boardId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    document.getElementById('createButtonContainer').style.display = 'block';
}

function createProject() {
    const projectName = document.getElementById('projectName').value.trim();
    
    if (!projectName) {
        alert('Please enter a project name');
        return;
    }

    if (!selectedBoard) {
        alert('Please select a board');
        return;
    }

    const btn = document.getElementById('createProjectBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    vscode.postMessage({
        command: 'createProject',
        projectName: projectName,
        boardId: selectedBoard
    });
}

function handleProjectCreated(message) {
    const btn = document.getElementById('createProjectBtn');
    btn.disabled = false;
    btn.textContent = 'Create Project';

    if (message.success) {
        document.getElementById('projectName').value = '';
        selectedBoard = null;
        document.querySelectorAll('.board-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.getElementById('createButtonContainer').style.display = 'none';
    }
}

function clearLogs() {
    vscode.postMessage({ command: 'clearLogs' });
}

function displayLogs(logs) {
    const container = document.getElementById('logContainer');
    
    if (logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p>No logs yet</p>
            </div>
        `;
        return;
    }

    container.innerHTML = logs.map(log => createLogHTML(log)).join('');
    container.scrollTop = container.scrollHeight;
}

function addLogEntry(log) {
    const container = document.getElementById('logContainer');
    const emptyState = container.querySelector('.empty-state');
    
    if (emptyState) {
        container.innerHTML = '';
    }

    const logElement = document.createElement('div');
    logElement.innerHTML = createLogHTML(log);
    container.appendChild(logElement.firstChild);
    container.scrollTop = container.scrollHeight;
}

function createLogHTML(log) {
    const time = new Date(log.timestamp).toLocaleTimeString();
    return `
        <div class="log-entry ${log.level}">
            <span class="log-timestamp">${time}</span>
            <span class="log-level ${log.level}">${log.level}</span>
            <span class="log-message">${log.message}</span>
        </div>
    `;
}
