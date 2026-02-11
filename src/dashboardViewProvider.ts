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
                    case 'openAiAgent':
                        vscode.commands.executeCommand('fide.openAiAgent');
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
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'dashboard', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'dashboard', 'webview.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FIDE Embedded Dashboard</title>
    <link rel="stylesheet" href="${styleUri}">
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
                <button class="nav-item active" onclick="switchTab('new-project', this)">
                    <span class="nav-item-icon">🚀</span>
                    <span>New Project</span>
                </button>
                <button class="nav-item" onclick="switchTab('logs', this)">
                    <span class="nav-item-icon">📋</span>
                    <span>Log Viewer</span>
                </button>
                <button class="nav-item" onclick="openDltViewer()">
                    <span class="nav-item-icon">📡</span>
                    <span>DLT Timeline</span>
                </button>
                <button class="nav-item" onclick="openAiAgent()">
                    <span class="nav-item-icon">🤖</span>
                    <span>AI Agent</span>
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

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
