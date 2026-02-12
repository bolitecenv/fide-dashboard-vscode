import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { exec } from 'child_process';

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
    private _isProcessing = false;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.loadAiConfig();
    }

    private loadAiConfig() {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'ai-config.json');
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
                    case 'stopGeneration':
                        this._isProcessing = false;
                        this.postMessage({ command: 'setThinking', thinking: false });
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

    private postMessage(message: any) {
        this._panel?.webview.postMessage(message);
    }

    private async handleUserMessage(userMessage: string) {
        if (!this._aiConfig) {
            this.postMessage({
                command: 'addMessage',
                role: 'error',
                content: 'AI configuration not loaded. Please check ai-config.json'
            });
            return;
        }

        if (this._isProcessing) {
            return;
        }

        this._isProcessing = true;

        // Show user message
        this._messages.push({ role: 'user', content: userMessage });
        this.postMessage({ command: 'addMessage', role: 'user', content: userMessage });

        // Show thinking indicator
        this.postMessage({ command: 'setThinking', thinking: true });

        try {
            await this.callAI();
        } catch (error) {
            console.error('AI call error:', error);
            this.postMessage({
                command: 'addMessage',
                role: 'error',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        } finally {
            this._isProcessing = false;
            this.postMessage({ command: 'setThinking', thinking: false });
        }
    }

    private async callAI(): Promise<void> {
        if (!this._aiConfig) {
            throw new Error('AI configuration not loaded');
        }

        const tools: Tool[] = [
            {
                name: "search_files",
                description: "Search for files in the workspace by glob pattern. Returns matching file paths.",
                input_schema: {
                    type: "object",
                    properties: {
                        pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.rs')" }
                    },
                    required: ["pattern"]
                }
            },
            {
                name: "read_file",
                description: "Read the contents of a file in the workspace",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path from workspace root" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "write_file",
                description: "Write or update a file. Creates directories if needed.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path from workspace root" },
                        content: { type: "string", description: "File content" }
                    },
                    required: ["path", "content"]
                }
            },
            {
                name: "execute_command",
                description: "Execute a shell command and return stdout/stderr output",
                input_schema: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Shell command to execute" }
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
                        path: { type: "string", description: "Relative path ('.' for root)" }
                    },
                    required: ["path"]
                }
            }
        ];

        const systemPrompt = `You are an AI coding assistant for embedded development projects in VS Code. You have access to workspace tools.

Current workspace: ${this._workspaceRoot || 'Not set'}

Guidelines:
- Be concise and direct in responses
- Use tools to gather information before answering
- Format responses with markdown (code blocks, lists, bold)
- When writing code, use fenced code blocks with language identifiers
- Explain what you're doing briefly when using tools`;

        let continueLoop = true;
        const maxIterations = 15;
        let iteration = 0;

        while (continueLoop && this._isProcessing && iteration < maxIterations) {
            iteration++;

            let response;
            try {
                response = await axios.post(this._aiConfig.apiUrl, {
                    model: this._aiConfig.model,
                    max_tokens: 4096,
                    system: systemPrompt,
                    messages: this._messages,
                    tools: tools
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this._aiConfig.apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    timeout: 60000
                });
            } catch (err: any) {
                if (err.response) {
                    throw new Error(`API error ${err.response.status}: ${JSON.stringify(err.response.data?.error?.message || err.response.data)}`);
                }
                throw err;
            }

            const data = response.data;

            if (data.stop_reason === 'end_turn') {
                for (const block of data.content) {
                    if (block.type === 'text' && block.text) {
                        this._messages.push({ role: 'assistant', content: data.content });
                        this.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: block.text
                        });
                    }
                }
                continueLoop = false;

            } else if (data.stop_reason === 'tool_use') {
                // Show any intermediate text
                for (const block of data.content) {
                    if (block.type === 'text' && block.text) {
                        this.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: block.text
                        });
                    }
                }

                // Execute all tools in this turn
                const toolResults: any[] = [];
                for (const block of data.content) {
                    if (block.type === 'tool_use') {
                        this.postMessage({
                            command: 'addToolExecution',
                            toolName: block.name,
                            input: block.input
                        });

                        const result = await this.executeTool(block.name, block.input);
                        const preview = result.length > 300
                            ? result.substring(0, 300) + '...'
                            : result;

                        this.postMessage({
                            command: 'addToolResult',
                            toolName: block.name,
                            result: preview,
                            fullResult: result
                        });

                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: result
                        });
                    }
                }

                this._messages.push({ role: 'assistant', content: data.content });
                this._messages.push({ role: 'user', content: toolResults });

            } else {
                continueLoop = false;
            }
        }

        if (iteration >= maxIterations) {
            this.postMessage({
                command: 'addMessage',
                role: 'error',
                content: 'Reached maximum iterations. Try a simpler request.'
            });
        }
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
            return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async searchFiles(pattern: string): Promise<string> {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
        if (files.length === 0) {
            return 'No files found matching: ' + pattern;
        }
        return files.map(f => vscode.workspace.asRelativePath(f)).join('\n');
    }

    private async readFile(filePath: string): Promise<string> {
        if (!this._workspaceRoot) { return 'No workspace open'; }
        const fullPath = path.join(this._workspaceRoot, filePath);
        try {
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            if (content.length > 50000) {
                return content.substring(0, 50000) + '\n\n... [truncated]';
            }
            return content;
        } catch {
            return `File not found: ${filePath}`;
        }
    }

    private async writeFile(filePath: string, content: string): Promise<string> {
        if (!this._workspaceRoot) { return 'No workspace open'; }
        const fullPath = path.join(this._workspaceRoot, filePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content, 'utf-8');
        return `File written: ${filePath}`;
    }

    private async executeCommand(command: string): Promise<string> {
        if (!this._workspaceRoot) { return 'No workspace open'; }
        return new Promise((resolve) => {
            exec(command, {
                cwd: this._workspaceRoot,
                timeout: 30000,
                maxBuffer: 1024 * 1024
            }, (error, stdout, stderr) => {
                let output = '';
                if (stdout) { output += stdout; }
                if (stderr) { output += (output ? '\n' : '') + stderr; }
                if (error && !output) { output = `Command failed: ${error.message}`; }
                if (output.length > 10000) {
                    output = output.substring(0, 10000) + '\n... [truncated]';
                }
                resolve(output || 'Command completed with no output.');
            });
        });
    }

    private async listDirectory(dirPath: string): Promise<string> {
        if (!this._workspaceRoot) { return 'No workspace open'; }
        const fullPath = path.join(this._workspaceRoot, dirPath);
        try {
            const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
            if (entries.length === 0) { return 'Empty directory'; }
            return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).sort().join('\n');
        } catch {
            return `Directory not found: ${dirPath}`;
        }
    }

    private clearChat() {
        this._messages = [];
        this._isProcessing = false;
        this.postMessage({ command: 'clearMessages' });
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
        <div class="header-left">
            <div class="header-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L9.5 5.5L14 6L10.5 9L11.5 14L8 11.5L4.5 14L5.5 9L2 6L6.5 5.5L8 1Z"/></svg>
            </div>
            <h1>Copilot</h1>
        </div>
        <div class="header-actions">
            <button id="clearBtn" title="New conversation">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1v10H5.41l-.71.71L3 13.41V11H1V1h13zm1-1H0v12h3v4l4-4h8V0z"/></svg>
            </button>
        </div>
    </div>

    <div class="chat-container" id="chatContainer">
        <div class="empty-state">
            <div class="empty-state-icon">
                <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L9.5 5.5L14 6L10.5 9L11.5 14L8 11.5L4.5 14L5.5 9L2 6L6.5 5.5L8 1Z"/></svg>
            </div>
            <h2>How can I help you?</h2>
            <p class="empty-state-description">I can answer questions about your embedded project, search files, write code, and run commands.</p>
            <div class="empty-suggestions" id="emptySuggestions">
                <button class="suggestion-chip" data-prompt="Show me the project structure">Show project structure</button>
                <button class="suggestion-chip" data-prompt="List all source files in the project">List source files</button>
                <button class="suggestion-chip" data-prompt="Explain the main entry point of this project">Explain main entry point</button>
                <button class="suggestion-chip" data-prompt="What build system does this project use?">Identify build system</button>
            </div>
        </div>
    </div>

    <div class="input-container">
        <div class="input-wrapper">
            <textarea id="messageInput" placeholder="Ask Copilot or type / for commands" rows="1"></textarea>
            <button id="sendBtn" title="Send message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1.91L1.78 1.5L15 8L1.78 14.5L1 14.09L3.56 8L1 1.91ZM3.41 8.75L1.87 13.26L13.3 8L1.87 2.74L3.4 7.25H8V8.75H3.41Z"/></svg>
            </button>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
