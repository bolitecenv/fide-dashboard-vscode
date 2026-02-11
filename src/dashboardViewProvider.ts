import * as vscode from 'vscode';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs';

interface BoardConfig {
    id: string;
    name: string;
    mcu: string;
    architecture: string;
    ram_kb: number;
    flash_kb: number;
    template_path: string;
}

interface CreateProjectRequest {
    project_name: string;
    board_id: string;
}

interface FileNode {
    name: string;
    path: string;
    is_directory: boolean;
    children?: FileNode[];
}

interface CreateProjectResponse {
    project_id: string;
    container_id: string;
    file_tree: FileNode[];
    workspace_url: string;
}

interface LogMessage {
    timestamp: string;
    level: string;
    message: string;
    project_id?: string;
}

export class DashboardViewProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _logs: LogMessage[] = [];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public show() {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this._panel) {
            this._panel.reveal(column);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'fideDashboard',
            'FIDE Embedded Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    case 'getBoards':
                        await this.fetchBoards();
                        break;
                    case 'createProject':
                        await this.createProject(message.projectName, message.boardId);
                        break;
                    case 'getLogs':
                        this.sendLogs();
                        break;
                    case 'clearLogs':
                        this.clearLogs();
                        break;
                    case 'openDltViewer':
                        vscode.commands.executeCommand('fide.openDltViewer');
                        break;
                }
            },
            undefined,
            []
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);

        // Add initial log
        this.addLog('info', 'Dashboard initialized');
    }

    private async fetchBoards() {
        try {
            const config = vscode.workspace.getConfiguration('fide');
            const backendUrl = config.get<string>('backendUrl', 'http://localhost:3000');
            
            this.addLog('info', `Fetching boards from ${backendUrl}/api/boards`);
            
            const response = await axios.get<BoardConfig[]>(`${backendUrl}/api/boards`);
            
            this.addLog('info', `Retrieved ${response.data.length} boards`);
            
            this._panel?.webview.postMessage({
                command: 'boardsLoaded',
                boards: response.data
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.addLog('error', `Failed to fetch boards: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to fetch boards: ${errorMessage}`);
        }
    }

    private async createProject(projectName: string, boardId: string) {
        try {
            const config = vscode.workspace.getConfiguration('fide');
            const backendUrl = config.get<string>('backendUrl', 'http://localhost:3000');
            
            this.addLog('info', `Creating project "${projectName}" with board ${boardId}`);
            
            const payload: CreateProjectRequest = {
                project_name: projectName,
                board_id: boardId
            };
            
            const response = await axios.post<CreateProjectResponse>(
                `${backendUrl}/api/projects`,
                payload
            );
            
            this.addLog('info', `Project created: ${response.data.project_id}`);
            
            // Ask user where to save the project
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Project Location'
            });
            
            if (!folderUri || folderUri.length === 0) {
                this.addLog('warning', 'Project creation cancelled by user');
                return;
            }
            
            const projectPath = path.join(folderUri[0].fsPath, projectName);
            
            // Create project directory
            if (!fs.existsSync(projectPath)) {
                fs.mkdirSync(projectPath, { recursive: true });
            }
            
            // Download and create project files
            await this.createProjectFiles(
                projectPath,
                response.data.project_id,
                response.data.file_tree,
                backendUrl
            );
            
            this.addLog('info', `Project files created at ${projectPath}`);
            
            // Create workspace file
            const workspaceFile = path.join(projectPath, `${projectName}.code-workspace`);
            const workspaceConfig = {
                folders: [
                    {
                        path: "."
                    }
                ],
                settings: {
                    "fide.projectId": response.data.project_id,
                    "fide.containerId": response.data.container_id,
                    "fide.boardId": boardId
                }
            };
            
            fs.writeFileSync(workspaceFile, JSON.stringify(workspaceConfig, null, 2));
            
            this.addLog('info', 'Workspace file created');
            
            // Ask user if they want to open the workspace
            const openWorkspace = await vscode.window.showInformationMessage(
                `Project "${projectName}" created successfully!`,
                'Open Workspace',
                'Cancel'
            );
            
            if (openWorkspace === 'Open Workspace') {
                await vscode.commands.executeCommand(
                    'vscode.openFolder',
                    vscode.Uri.file(projectPath),
                    true
                );
            }
            
            this._panel?.webview.postMessage({
                command: 'projectCreated',
                success: true,
                projectId: response.data.project_id
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.addLog('error', `Failed to create project: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to create project: ${errorMessage}`);
            
            this._panel?.webview.postMessage({
                command: 'projectCreated',
                success: false,
                error: errorMessage
            });
        }
    }

    private async createProjectFiles(
        projectPath: string,
        projectId: string,
        fileTree: FileNode[],
        backendUrl: string
    ) {
        for (const node of fileTree) {
            const nodePath = path.join(projectPath, node.path);
            
            if (node.is_directory) {
                if (!fs.existsSync(nodePath)) {
                    fs.mkdirSync(nodePath, { recursive: true });
                }
                if (node.children) {
                    await this.createProjectFiles(projectPath, projectId, node.children, backendUrl);
                }
            } else {
                try {
                    const response = await axios.get(
                        `${backendUrl}/api/projects/${projectId}/files/${node.path}`
                    );
                    
                    const dir = path.dirname(nodePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    
                    fs.writeFileSync(nodePath, response.data);
                    this.addLog('info', `Created file: ${node.path}`);
                } catch (error) {
                    this.addLog('warning', `Failed to create file ${node.path}`);
                }
            }
        }
    }

    private addLog(level: string, message: string, projectId?: string) {
        const log: LogMessage = {
            timestamp: new Date().toISOString(),
            level,
            message,
            project_id: projectId
        };
        
        this._logs.push(log);
        
        // Keep only last 100 logs
        if (this._logs.length > 100) {
            this._logs.shift();
        }
        
        // Send to webview if it's open
        this._panel?.webview.postMessage({
            command: 'logAdded',
            log
        });
    }

    private sendLogs() {
        this._panel?.webview.postMessage({
            command: 'logsUpdated',
            logs: this._logs
        });
    }

    private clearLogs() {
        this._logs = [];
        this.addLog('info', 'Logs cleared');
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FIDE Embedded Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: hidden;
            height: 100vh;
        }

        .dashboard-layout {
            display: flex;
            height: 100vh;
        }

        .sidebar {
            width: 250px;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
        }

        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .sidebar-header h1 {
            font-size: 18px;
            color: var(--vscode-foreground);
            margin: 0;
        }

        .sidebar-header .subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }

        .nav-items {
            flex: 1;
            padding: 10px 0;
        }

        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 20px;
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            transition: all 0.2s;
            width: 100%;
            text-align: left;
            border-left: 3px solid transparent;
            font-family: var(--vscode-font-family);
            font-size: 14px;
        }

        .nav-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .nav-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            border-left-color: var(--vscode-focusBorder);
            color: var(--vscode-focusBorder);
        }

        .nav-item-icon {
            margin-right: 10px;
            font-size: 16px;
        }

        .main-content {
            flex: 1;
            overflow-y: auto;
            padding: 30px;
        }

        h2 {
            color: var(--vscode-foreground);
            margin-bottom: 20px;
            font-size: 24px;
        }

        h3 {
            color: var(--vscode-foreground);
            margin-bottom: 15px;
            font-size: 18px;
        }

        .page {
            display: none;
        }

        .page.active {
            display: block;
        }

        .board-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .board-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.3s;
        }

        .board-card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }

        .board-card.selected {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-activeSelectionBackground);
        }

        .board-card h3 {
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }

        .board-card p {
            margin: 5px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .board-specs {
            display: flex;
            gap: 15px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .spec {
            display: flex;
            flex-direction: column;
        }

        .spec-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }

        .spec-value {
            font-size: 14px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        input[type="text"] {
            width: 100%;
            padding: 10px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
        }

        input[type="text"]:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        button {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: 14px;
            transition: background 0.3s;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .log-container {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            height: 500px;
            overflow-y: auto;
            padding: 15px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }

        .log-entry {
            padding: 8px;
            margin-bottom: 5px;
            border-left: 3px solid transparent;
            display: flex;
            gap: 10px;
        }

        .log-entry.info {
            border-left-color: var(--vscode-charts-blue);
        }

        .log-entry.warning {
            border-left-color: var(--vscode-charts-yellow);
        }

        .log-entry.error {
            border-left-color: var(--vscode-charts-red);
        }

        .log-timestamp {
            color: var(--vscode-descriptionForeground);
            flex-shrink: 0;
        }

        .log-level {
            font-weight: 600;
            text-transform: uppercase;
            width: 60px;
            flex-shrink: 0;
        }

        .log-level.info {
            color: var(--vscode-charts-blue);
        }

        .log-level.warning {
            color: var(--vscode-charts-yellow);
        }

        .log-level.error {
            color: var(--vscode-charts-red);
        }

        .log-message {
            color: var(--vscode-foreground);
            flex-grow: 1;
        }

        .log-controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            border: 3px solid var(--vscode-panel-border);
            border-top: 3px solid var(--vscode-focusBorder);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 15px;
            opacity: 0.5;
        }

        .status-message {
            padding: 10px;
            margin: 10px 0;
            border-radius: 4px;
            background: var(--vscode-inputValidation-infoBackground);
            border-left: 3px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div class="dashboard-layout">
        <!-- Left Sidebar Navigator -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>FIDE Dashboard</h1>
                <div class="subtitle">Embedded Development</div>
            </div>
            
            <div class="nav-items">
                <button class="nav-item active" onclick="switchTab('new-project')">
                    <span class="nav-item-icon">🚀</span>
                    <span>New Project</span>
                </button>
                <button class="nav-item" onclick="switchTab('logs')">
                    <span class="nav-item-icon">📋</span>
                    <span>Log Viewer</span>
                </button>
                <button class="nav-item" onclick="openDltViewer()">
                    <span class="nav-item-icon">📡</span>
                    <span>DLT Timeline</span>
                </button>
            </div>
        </div>

        <!-- Main Content Area -->
        <div class="main-content">
            <!-- New Project Page -->
            <div id="new-project" class="page active">
                <h2>Create New Project</h2>
            
            <div class="form-group">
                <label for="projectName">Project Name</label>
                <input type="text" id="projectName" placeholder="Enter project name" />
            </div>

            <h2>Select Development Board</h2>
            <div id="boardsLoading" class="loading">
                <div class="spinner"></div>
                <p>Loading boards...</p>
            </div>
            <div id="boardsGrid" class="board-grid" style="display: none;"></div>

            <div id="createButtonContainer" style="margin-top: 20px; display: none;">
                <button id="createProjectBtn" onclick="createProject()">Create Project</button>
            </div>
        </div>

        <!-- Log Viewer Page -->
        <div id="logs" class="page">
            <h2>Activity Logs</h2>
            <div class="log-controls">
                <button onclick="refreshLogs()">Refresh</button>
                <button onclick="clearLogs()">Clear Logs</button>
            </div>
            <div id="logContainer" class="log-container">
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <p>No logs yet</p>
                </div>
            </div>
        </div>
    </div>
</div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedBoard = null;
        let boards = [];

        // Initialize
        window.addEventListener('load', () => {
            loadBoards();
            refreshLogs();
        });

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

        function switchTab(tabName) {
            // Update nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            event.target.classList.add('active');

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

        function loadBoards() {
            vscode.postMessage({ command: 'getBoards' });
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
                card.innerHTML = \`
                    <h3>\${board.name}</h3>
                    <p><strong>MCU:</strong> \${board.mcu}</p>
                    <p><strong>Architecture:</strong> \${board.architecture}</p>
                    <div class="board-specs">
                        <div class="spec">
                            <span class="spec-label">RAM</span>
                            <span class="spec-value">\${board.ram_kb} KB</span>
                        </div>
                        <div class="spec">
                            <span class="spec-label">Flash</span>
                            <span class="spec-value">\${board.flash_kb} KB</span>
                        </div>
                    </div>
                \`;
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

        function refreshLogs() {
            vscode.postMessage({ command: 'getLogs' });
        }

        function clearLogs() {
            vscode.postMessage({ command: 'clearLogs' });
        }

        function displayLogs(logs) {
            const container = document.getElementById('logContainer');
            
            if (logs.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📋</div>
                        <p>No logs yet</p>
                    </div>
                \`;
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
            return \`
                <div class="log-entry \${log.level}">
                    <span class="log-timestamp">\${time}</span>
                    <span class="log-level \${log.level}">\${log.level}</span>
                    <span class="log-message">\${log.message}</span>
                </div>
            \`;
        }
    </script>
</body>
</html>`;
    }
}
