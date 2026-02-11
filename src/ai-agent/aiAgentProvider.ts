import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

interface Message {
    role: 'user' | 'assistant';
    content: string | any[];
}

interface Tool {
    name: string;
    description: string;
    input_schema: any;
}

interface AiConfig {
    apiUrl: string;
    apiKey: string;
    model: string;
}

export class AiAgentProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _messages: Message[] = [];
    private _workspaceRoot: string | undefined;
    private _aiConfig: AiConfig | undefined;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.loadAiConfig();
    }

    private loadAiConfig() {
        try {
            const configPath = path.join(path.dirname(this._extensionUri.fsPath), 'ai-config.json');
            const configData = fs.readFileSync(configPath, 'utf-8');
            this._aiConfig = JSON.parse(configData);
        } catch (error) {
            console.error('Failed to load ai-config.json:', error);
            vscode.window.showErrorMessage('AI Config file not found. Please create ai-config.json from ai-config.sample.json');
        }
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
            'fideAiAgent',
            'AI Agent',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out', 'ai-agent')]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                    case 'clearChat':
                        this.clearChat();
                        break;
                }
            },
            undefined,
            []
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);
    }

    private async handleUserMessage(userMessage: string) {
        if (!this._aiConfig) {
            this._panel?.webview.postMessage({
                command: 'addMessage',
                role: 'error',
                content: 'AI configuration not loaded. Please check ai-config.json'
            });
            return;
        }

        this._messages.push({ role: 'user', content: userMessage });
        
        this._panel?.webview.postMessage({
            command: 'addMessage',
            role: 'user',
            content: userMessage
        });

        // Planning phase
        this._panel?.webview.postMessage({
            command: 'addPlanningMessage',
            content: 'Analyzing request and creating task plan...'
        });

        try {
            const response = await this.callAI();
            
            if (response) {
                this._messages.push({ role: 'assistant', content: response });
                this._panel?.webview.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: response
                });
            }
        } catch (error) {
        if (!this._aiConfig) {
            throw new Error('AI configuration not loaded');
        }

            this._panel?.webview.postMessage({
                command: 'addMessage',
                role: 'error',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private async callAI(): Promise<string> {
        const tools: Tool[] = [
            {
                name: "search_files",
                description: "Search for files in the workspace by name pattern",
                input_schema: {
                    type: "object",
                    properties: {
                        pattern: {
                            type: "string",
                            description: "Glob pattern to search for files (e.g., '**/*.ts', 'src/**')"
                        }
                    },
                    required: ["pattern"]
                }
            },
            {
                name: "read_file",
                description: "Read the contents of a file",
                input_schema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Relative path to the file from workspace root"
                        }
                    },
                    required: ["path"]
                }
            },
            {
                name: "write_file",
                description: "Write or update a file",
                input_schema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Relative path to the file from workspace root"
                        },
                        content: {
                            type: "string",
                            description: "Content to write to the file"
                        }
                    },
                    required: ["path", "content"]
                }
            },
            {
                name: "execute_command",
                description: "Execute a shell command in the workspace (e.g., 'cargo run', 'make', 'npm build')",
                input_schema: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "Shell command to execute"
                        }
                    },
                    required: ["command"]
                }
            },
            {
                name: "list_directory",
                description: "List contents of a directory",
                input_schema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Relative path to the directory from workspace root"
                        }
                    },
                    required: ["path"]
                }
            }
        ];

        const systemPrompt = `You are an AI assistant helping with embedded development projects. You have access to the workspace and can:
- Search for files
- Read and write files
- Execute build commands (cargo run, make, cmake, etc.)
- List directory contents

Current workspace: ${this._workspaceRoot || 'Not set'}

When you receive a request:
1. First, briefly analyze what the user wants to accomplish
2. Create a mental task list of steps needed
3. Execute the tasks using available tools
4. Provide clear, concise responses

When using tools, explain what you're doing in a brief summary before executing.`;

        let continueLoop = true;
        let assistantResponse = '';

        while (continueLoop) {
            const requestBody = {
                model: this._aiConfig!.model,
                max_tokens: 4096,
                system: systemPrompt,
                messages: this._messages,
                tools: tools
            };

            const response = await axios.post(this._aiConfig!.apiUrl, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this._aiConfig!.apiKey,
                    'anthropic-version': '2023-06-01'
                }
            });

            const data = response.data;

            if (data.stop_reason === 'end_turn') {
                // AI finished with text response
                for (const block of data.content) {
                    if (block.type === 'text') {
                        assistantResponse += block.text;
                    }
                }
                continueLoop = false;
            } else if (data.stop_reason === 'tool_use') {
                // AI wants to use tools
                const toolResults: any[] = [];

                for (const block of data.content) {
                    if (block.type === 'text') {
                        assistantResponse += block.text;
                    } else if (block.type === 'tool_use') {
                        // Show tool execution in UI only for execute_command
                        if (block.name === 'execute_command') {
                            this._panel?.webview.postMessage({
                                command: 'addToolExecution',
                                toolName: block.name,
                                input: block.input
                            });
                        }

                        const result = await this.executeTool(block.name, block.input);
                        
                        // Show tool result in UI only for execute_command
                        if (block.name === 'execute_command') {
                            this._panel?.webview.postMessage({
                                command: 'addToolResult',
                                toolName: block.name,
                                result: result.substring(0, 200) + (result.length > 200 ? '...' : ''),
                                fullResult: result
                            });
                        }

                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: result
                        });
                    }
                }

                // Add assistant's tool use to messages
                this._messages.push({ role: 'assistant', content: data.content });
                // Add tool results
                this._messages.push({ role: 'user', content: toolResults });
            } else {
                continueLoop = false;
            }
        }

        return assistantResponse;
    }

    private async executeTool(toolName: string, input: any): Promise<string> {
        try {
            switch (toolName) {
                case 'search_files':
                    return await this.searchFiles(input.pattern);
                
                case 'read_file':
                    return await this.readFile(input.path);
                
                case 'write_file':
                    return await this.writeFile(input.path, input.content);
                
                case 'execute_command':
                    return await this.executeCommand(input.command);
                
                case 'list_directory':
                    return await this.listDirectory(input.path);
                
                default:
                    return `Unknown tool: ${toolName}`;
            }
        } catch (error) {
            return `Error executing ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async searchFiles(pattern: string): Promise<string> {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
        if (files.length === 0) {
            return 'No files found';
        }
        return files.map(f => vscode.workspace.asRelativePath(f)).join('\n');
    }

    private async readFile(filePath: string): Promise<string> {
        if (!this._workspaceRoot) {
            return 'No workspace open';
        }
        const fullPath = path.join(this._workspaceRoot, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        return content;
    }

    private async writeFile(filePath: string, content: string): Promise<string> {
        if (!this._workspaceRoot) {
            return 'No workspace open';
        }
        const fullPath = path.join(this._workspaceRoot, filePath);
        
        // Create directory if it doesn't exist
        const dir = path.dirname(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        await fs.promises.writeFile(fullPath, content, 'utf-8');
        return `File written: ${filePath}`;
    }

    private async executeCommand(command: string): Promise<string> {
        return new Promise((resolve) => {
            const terminal = vscode.window.createTerminal({
                name: 'AI Agent',
                cwd: this._workspaceRoot
            });
            
            terminal.show();
            terminal.sendText(command);
            
            // Note: We can't easily capture terminal output, so we just confirm execution
            resolve(`Command executed in terminal: ${command}\nCheck the terminal for output.`);
        });
    }

    private async listDirectory(dirPath: string): Promise<string> {
        if (!this._workspaceRoot) {
            return 'No workspace open';
        }
        const fullPath = path.join(this._workspaceRoot, dirPath);
        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        
        const formatted = entries.map(entry => {
            const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
            return `${type} ${entry.name}`;
        }).join('\n');
        
        return formatted || 'Empty directory';
    }

    private clearChat() {
        this._messages = [];
        this._panel?.webview.postMessage({
            command: 'clearMessages'
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'ai-agent', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'ai-agent', 'webview.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Agent</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div class="header">
        <h1>🤖 AI Agent</h1>
        <button onclick="clearChat()">Clear Chat</button>
    </div>

    <div class="chat-container" id="chatContainer">
        <div class="empty-state">
            <div class="empty-state-icon">🤖</div>
            <h2>AI Agent Ready</h2>
            <p>I can help you with:</p>
            <p>• Searching and reading files</p>
            <p>• Editing code</p>
            <p>• Running build commands (cargo, make, npm, etc.)</p>
            <p>• Understanding your project structure</p>
        </div>
    </div>

    <div class="input-container">
        <textarea 
            id="messageInput" 
            placeholder="Ask me to help with your project..."
            rows="1"
        ></textarea>
        <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
