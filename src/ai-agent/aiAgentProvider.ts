import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { exec, spawn, ChildProcess } from 'child_process';

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
    authType?: 'anthropic' | 'bearer';
}

interface BuildConfig {
    buildCmd: string;
    runCmd: string;
    gdbCmd: string;
    gdbTarget: string;
    elfPath: string;
    gdbInitCmds: string;
}

export class AiAgentProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _messages: Message[] = [];
    private _workspaceRoot: string | undefined;
    private _aiConfig: AiConfig | undefined;
    private _isProcessing = false;

    // Build/Run/Debug process management
    private _buildProcess: ChildProcess | undefined;
    private _runProcess: ChildProcess | undefined;
    private _gdbProcess: ChildProcess | undefined;
    private _buildOutput: string[] = [];
    private _runOutput: string[] = [];
    private _gdbOutput: string[] = [];
    private _buildConfig: BuildConfig = {
        buildCmd: 'cargo build',
        runCmd: 'cargo run',
        gdbCmd: 'arm-none-eabi-gdb',
        gdbTarget: 'localhost:3333',
        elfPath: 'target/thumbv7em-none-eabihf/debug/firmware',
        gdbInitCmds: 'target remote localhost:3333\nmonitor reset halt\nload\ncontinue'
    };

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.loadAiConfig();
        this.loadBuildConfig();
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
                    case 'quickAction':
                        await this.handleUserMessage(message.text);
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
            // === Coding Tools ===
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
                description: "Execute a shell command and return stdout/stderr output. Use for quick commands. For build, use build_project instead.",
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
            },
            // === Build/Debug Tools ===
            {
                name: "build_project",
                description: "Build the project using the configured build command. Returns build output (stdout+stderr) and exit code. Use this to compile and check for errors.",
                input_schema: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Optional override build command. If not provided, uses configured build command." }
                    },
                    required: []
                }
            },
            {
                name: "run_project",
                description: "Run the project using the configured run command. Returns output and exit code. Useful for testing after a successful build.",
                input_schema: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "Optional override run command. If not provided, uses configured run command." },
                        timeout: { type: "number", description: "Timeout in ms (default 30000). Use shorter timeouts for quick tests." }
                    },
                    required: []
                }
            },
            {
                name: "start_gdb",
                description: "Start a GDB debug session with the configured ELF file and target. Sends init commands and returns initial GDB output.",
                input_schema: {
                    type: "object",
                    properties: {
                        elfPath: { type: "string", description: "Optional ELF path override" },
                        initCommands: { type: "string", description: "Optional init commands (newline-separated) override" }
                    },
                    required: []
                }
            },
            {
                name: "send_gdb_command",
                description: "Send a command to the running GDB session and return output. GDB must be started first with start_gdb.",
                input_schema: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "GDB command to send (e.g., 'bt', 'info registers', 'print var')" }
                    },
                    required: ["command"]
                }
            },
            {
                name: "stop_process",
                description: "Stop a running process (build, run, or gdb)",
                input_schema: {
                    type: "object",
                    properties: {
                        process: { type: "string", description: "Which process to stop: 'build', 'run', or 'gdb'" }
                    },
                    required: ["process"]
                }
            },
            {
                name: "get_build_config",
                description: "Get the current build/run/debug configuration (build command, run command, GDB settings, ELF path)",
                input_schema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "save_build_config",
                description: "Update the build/run/debug configuration",
                input_schema: {
                    type: "object",
                    properties: {
                        buildCmd: { type: "string", description: "Build command (e.g. 'cargo build', 'make')" },
                        runCmd: { type: "string", description: "Run command (e.g. 'cargo run')" },
                        gdbCmd: { type: "string", description: "GDB executable (e.g. 'arm-none-eabi-gdb')" },
                        gdbTarget: { type: "string", description: "GDB target (e.g. 'localhost:3333')" },
                        elfPath: { type: "string", description: "Path to ELF binary" },
                        gdbInitCmds: { type: "string", description: "GDB init commands (newline-separated)" }
                    },
                    required: []
                }
            },
            {
                name: "get_diagnostics",
                description: "Get VS Code diagnostic errors and warnings for a specific file or all files. Useful for finding compiler errors, lint warnings, and type errors.",
                input_schema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Optional relative file path. If omitted, returns all workspace diagnostics." }
                    },
                    required: []
                }
            }
        ];

        const systemPrompt = `You are an AI-powered coding and debugging agent for embedded development projects in VS Code. You can write code, build, run, debug with GDB, and automatically fix errors.

Current workspace: ${this._workspaceRoot || 'Not set'}
Build config: ${JSON.stringify(this._buildConfig)}

Capabilities:
- **Code**: Search, read, write files in the workspace
- **Build**: Build the project and analyze compiler errors
- **Run**: Execute the project and capture output
- **Debug**: Start GDB sessions, set breakpoints, inspect variables
- **Auto-fix**: Build → analyze errors → fix code → rebuild (iterate until success)

Auto Build-Fix workflow:
1. Use build_project to compile
2. If build fails, analyze the error output
3. Use read_file to see the problematic code
4. Use write_file to fix the code
5. Use build_project again to verify the fix
6. Repeat until build succeeds

Guidelines:
- Be concise and direct in responses
- Use tools to gather information before answering
- Format responses with markdown (code blocks, lists, bold)
- When writing code, use fenced code blocks with language identifiers
- When asked to build and fix, use the iterative auto-fix loop
- When debugging, start GDB, get backtrace, read relevant source, then explain
- Always show what you found and what you changed`;

        let continueLoop = true;
        const maxIterations = 15;
        let iteration = 0;

        while (continueLoop && this._isProcessing && iteration < maxIterations) {
            iteration++;

            let response;
            try {
                const authType = this._aiConfig.authType || 'anthropic';
                const headers: any = {
                    'Content-Type': 'application/json'
                };

                let requestBody: any;

                if (authType === 'bearer') {
                    // OpenAI-compatible API (Bearer token)
                    headers['Authorization'] = `Bearer ${this._aiConfig.apiKey}`;
                    requestBody = {
                        model: this._aiConfig.model,
                        max_tokens: 4096,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...this._messages
                        ],
                        tools: tools.map(t => ({
                            type: 'function',
                            function: {
                                name: t.name,
                                description: t.description,
                                parameters: t.input_schema
                            }
                        }))
                    };
                } else {
                    // Anthropic API (x-api-key)
                    headers['x-api-key'] = this._aiConfig.apiKey;
                    headers['anthropic-version'] = '2023-06-01';
                    requestBody = {
                        model: this._aiConfig.model,
                        max_tokens: 4096,
                        system: systemPrompt,
                        messages: this._messages,
                        tools: tools
                    };
                }

                response = await axios.post(this._aiConfig.apiUrl, requestBody, {
                    headers: headers,
                    timeout: 60000
                });
            } catch (err: any) {
                if (err.response) {
                    throw new Error(`API error ${err.response.status}: ${JSON.stringify(err.response.data?.error?.message || err.response.data)}`);
                }
                throw err;
            }

            const data = response.data;
            const authType = this._aiConfig.authType || 'anthropic';

            // Handle response based on API type
            if (authType === 'bearer') {
                // OpenAI-compatible response handling
                const choice = data.choices?.[0];
                if (!choice) {
                    continueLoop = false;
                    continue;
                }

                const finishReason = choice.finish_reason;
                const message = choice.message;

                if (finishReason === 'stop' || finishReason === 'end_turn') {
                    if (message?.content) {
                        this._messages.push({ role: 'assistant', content: message.content });
                        this.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: message.content
                        });
                    }
                    continueLoop = false;

                } else if (finishReason === 'tool_calls' && message?.tool_calls) {
                    // Show any intermediate text
                    if (message.content) {
                        this.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: message.content
                        });
                    }

                    // Execute tools
                    const toolResults: any[] = [];
                    for (const toolCall of message.tool_calls) {
                        if (toolCall.type === 'function') {
                            const functionName = toolCall.function.name;
                            const functionArgs = JSON.parse(toolCall.function.arguments);

                            this.postMessage({
                                command: 'addToolExecution',
                                toolName: functionName,
                                input: functionArgs
                            });

                            const result = await this.executeTool(functionName, functionArgs);
                            const preview = result.length > 300 ? result.substring(0, 300) + '...' : result;

                            this.postMessage({
                                command: 'addToolResult',
                                toolName: functionName,
                                result: preview,
                                fullResult: result
                            });

                            toolResults.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                name: functionName,
                                content: result
                            });
                        }
                    }

                    // Add assistant message and tool results to history
                    this._messages.push({ role: 'assistant', content: message });
                    this._messages.push(...toolResults as any);

                } else {
                    continueLoop = false;
                }

            } else if (data.stop_reason === 'end_turn') {
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
                // Unknown stop reason (Anthropic)
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
                // Coding tools
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
                // Build/Debug tools
                case 'build_project':
                    return await this.buildProject(input.command);
                case 'run_project':
                    return await this.runProject(input.command, input.timeout);
                case 'start_gdb':
                    return await this.startGdb(input.elfPath, input.initCommands);
                case 'send_gdb_command':
                    return await this.sendGdbCommand(input.command);
                case 'stop_process':
                    return this.stopProcess(input.process);
                case 'get_build_config':
                    return JSON.stringify(this._buildConfig, null, 2);
                case 'save_build_config':
                    return this.saveBuildConfig(input);
                case 'get_diagnostics':
                    return await this.getDiagnostics(input.path);
                default:
                    return `Unknown tool: ${toolName}`;
            }
        } catch (error) {
            return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    // ========================================================================
    // CODING TOOLS
    // ========================================================================

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

    private async getDiagnostics(filePath?: string): Promise<string> {
        let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];
        
        if (filePath && this._workspaceRoot) {
            const uri = vscode.Uri.file(path.join(this._workspaceRoot, filePath));
            const fileDiags = vscode.languages.getDiagnostics(uri);
            diagnostics = [[uri, fileDiags]];
        } else {
            diagnostics = vscode.languages.getDiagnostics() as [vscode.Uri, readonly vscode.Diagnostic[]][];
        }

        const results: string[] = [];
        for (const [uri, diags] of diagnostics) {
            const filteredDiags = diags.filter(d => 
                d.severity === vscode.DiagnosticSeverity.Error || 
                d.severity === vscode.DiagnosticSeverity.Warning
            );
            if (filteredDiags.length === 0) { continue; }
            
            const relPath = vscode.workspace.asRelativePath(uri);
            for (const d of filteredDiags) {
                const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
                results.push(`${relPath}:${d.range.start.line + 1}:${d.range.start.character + 1} [${severity}] ${d.message}`);
            }
        }

        if (results.length === 0) {
            return 'No errors or warnings found.';
        }
        return results.join('\n');
    }

    // ========================================================================
    // BUILD / RUN / DEBUG TOOLS
    // ========================================================================

    private async buildProject(command?: string): Promise<string> {
        const cwd = this._workspaceRoot || process.cwd();
        const cmd = command || this._buildConfig.buildCmd;
        
        // Kill any existing build
        this._killProcess(this._buildProcess);
        this._buildOutput = [];

        this.postMessage({ command: 'addBuildStatus', status: 'building', cmd });

        return new Promise((resolve) => {
            const parts = cmd.split(/\s+/);
            this._buildProcess = spawn(parts[0], parts.slice(1), {
                cwd,
                shell: true,
                env: { ...process.env }
            });

            this._buildProcess.stdout?.on('data', (data: Buffer) => {
                this._buildOutput.push(data.toString());
            });

            this._buildProcess.stderr?.on('data', (data: Buffer) => {
                this._buildOutput.push(data.toString());
            });

            this._buildProcess.on('close', (code: number | null) => {
                const exitCode = code ?? -1;
                const output = this._buildOutput.join('');
                const status = exitCode === 0 ? 'success' : 'failed';
                this.postMessage({ command: 'addBuildStatus', status, exitCode });
                
                let result = `Build ${status} (exit code ${exitCode})`;
                if (output) {
                    result += '\n\n' + (output.length > 8000 ? output.substring(0, 8000) + '\n... [truncated]' : output);
                }
                resolve(result);
            });

            this._buildProcess.on('error', (err: Error) => {
                this.postMessage({ command: 'addBuildStatus', status: 'error' });
                resolve(`Build error: ${err.message}`);
            });
        });
    }

    private async runProject(command?: string, timeout?: number): Promise<string> {
        const cwd = this._workspaceRoot || process.cwd();
        const cmd = command || this._buildConfig.runCmd;
        const timeoutMs = timeout || 30000;

        this._killProcess(this._runProcess);
        this._runOutput = [];

        this.postMessage({ command: 'addBuildStatus', status: 'running', cmd });

        return new Promise((resolve) => {
            const parts = cmd.split(/\s+/);
            this._runProcess = spawn(parts[0], parts.slice(1), {
                cwd,
                shell: true,
                env: { ...process.env }
            });

            const timer = setTimeout(() => {
                this._killProcess(this._runProcess);
                const output = this._runOutput.join('');
                this.postMessage({ command: 'addBuildStatus', status: 'timeout' });
                resolve(`Run timed out after ${timeoutMs}ms\n\nOutput:\n${output}`);
            }, timeoutMs);

            this._runProcess.stdout?.on('data', (data: Buffer) => {
                this._runOutput.push(data.toString());
            });

            this._runProcess.stderr?.on('data', (data: Buffer) => {
                this._runOutput.push(data.toString());
            });

            this._runProcess.on('close', (code: number | null) => {
                clearTimeout(timer);
                const exitCode = code ?? -1;
                const output = this._runOutput.join('');
                const status = exitCode === 0 ? 'stopped' : 'error';
                this.postMessage({ command: 'addBuildStatus', status, exitCode });
                
                let result = `Process exited (code ${exitCode})`;
                if (output) {
                    result += '\n\n' + (output.length > 8000 ? output.substring(0, 8000) + '\n... [truncated]' : output);
                }
                resolve(result);
            });

            this._runProcess.on('error', (err: Error) => {
                clearTimeout(timer);
                this.postMessage({ command: 'addBuildStatus', status: 'error' });
                resolve(`Run error: ${err.message}`);
            });
        });
    }

    private async startGdb(elfPath?: string, initCommands?: string): Promise<string> {
        const cwd = this._workspaceRoot || process.cwd();
        const elf = elfPath || this._buildConfig.elfPath;
        const initCmds = (initCommands || this._buildConfig.gdbInitCmds).split('\\n');
        
        this._killProcess(this._gdbProcess);
        this._gdbOutput = [];

        this.postMessage({ command: 'addBuildStatus', status: 'gdb-connecting' });

        return new Promise((resolve) => {
            this._gdbProcess = spawn(this._buildConfig.gdbCmd, [elf], {
                cwd,
                shell: true,
                env: { ...process.env }
            });

            this._gdbProcess.stdout?.on('data', (data: Buffer) => {
                this._gdbOutput.push(data.toString());
            });

            this._gdbProcess.stderr?.on('data', (data: Buffer) => {
                this._gdbOutput.push(data.toString());
            });

            this._gdbProcess.on('error', (err: Error) => {
                this.postMessage({ command: 'addBuildStatus', status: 'gdb-error' });
                resolve(`GDB error: ${err.message}`);
            });

            // Send init commands after brief delay
            setTimeout(() => {
                if (this._gdbProcess && this._gdbProcess.stdin) {
                    initCmds.forEach((cmd, i) => {
                        setTimeout(() => {
                            this._gdbProcess?.stdin?.write(cmd.trim() + '\n');
                        }, i * 300);
                    });
                }

                // Collect output after init commands
                setTimeout(() => {
                    const output = this._gdbOutput.join('');
                    this.postMessage({ command: 'addBuildStatus', status: 'gdb-connected' });
                    resolve(`GDB session started\nInit commands sent: ${initCmds.join(', ')}\n\nOutput:\n${output}`);
                }, initCmds.length * 300 + 500);
            }, 500);
        });
    }

    private async sendGdbCommand(command: string): Promise<string> {
        if (!this._gdbProcess || !this._gdbProcess.stdin) {
            return 'GDB is not running. Use start_gdb first.';
        }

        const prevLen = this._gdbOutput.length;
        this._gdbProcess.stdin.write(command + '\n');

        // Wait for output
        return new Promise((resolve) => {
            setTimeout(() => {
                const newOutput = this._gdbOutput.slice(prevLen).join('');
                resolve(newOutput || `(gdb) ${command}\n(no output)`);
            }, 1500);
        });
    }

    private stopProcess(processName: string): string {
        switch (processName) {
            case 'build':
                this._killProcess(this._buildProcess);
                this._buildProcess = undefined;
                return 'Build process stopped.';
            case 'run':
                this._killProcess(this._runProcess);
                this._runProcess = undefined;
                return 'Run process stopped.';
            case 'gdb':
                if (this._gdbProcess?.stdin) {
                    this._gdbProcess.stdin.write('quit\n');
                }
                setTimeout(() => {
                    this._killProcess(this._gdbProcess);
                    this._gdbProcess = undefined;
                }, 500);
                return 'GDB session terminated.';
            default:
                return `Unknown process: ${processName}. Use 'build', 'run', or 'gdb'.`;
        }
    }

    private _killProcess(proc: ChildProcess | undefined): void {
        if (proc && !proc.killed) {
            try {
                proc.kill('SIGTERM');
                setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill('SIGKILL');
                    }
                }, 1000);
            } catch {
                // Process may already be dead
            }
        }
    }

    // ========================================================================
    // BUILD CONFIG MANAGEMENT
    // ========================================================================

    private loadBuildConfig(): void {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'debug-config.json');
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf-8');
                this._buildConfig = { ...this._buildConfig, ...JSON.parse(data) };
            }
        } catch (error) {
            console.error('Failed to load debug-config.json:', error);
        }
    }

    private saveBuildConfig(input: any): string {
        if (input.buildCmd) { this._buildConfig.buildCmd = input.buildCmd; }
        if (input.runCmd) { this._buildConfig.runCmd = input.runCmd; }
        if (input.gdbCmd) { this._buildConfig.gdbCmd = input.gdbCmd; }
        if (input.gdbTarget) { this._buildConfig.gdbTarget = input.gdbTarget; }
        if (input.elfPath) { this._buildConfig.elfPath = input.elfPath; }
        if (input.gdbInitCmds) { this._buildConfig.gdbInitCmds = input.gdbInitCmds; }

        try {
            const configPath = path.join(this._extensionUri.fsPath, 'debug-config.json');
            fs.writeFileSync(configPath, JSON.stringify(this._buildConfig, null, 2));
            return `Build config saved:\n${JSON.stringify(this._buildConfig, null, 2)}`;
        } catch (error) {
            return `Config updated in memory but save failed: ${error}`;
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
            <h2>Code, Build, Debug & Fix</h2>
            <p class="empty-state-description">I can write code, build your project, debug with GDB, analyze errors, and auto-fix issues — all in one agent.</p>
            <div class="empty-suggestions" id="emptySuggestions">
                <button class="suggestion-chip" data-prompt="Build the project and fix any errors automatically">&#x1F528; Build &amp; auto-fix errors</button>
                <button class="suggestion-chip" data-prompt="Show the current build configuration">&#x2699;&#xFE0F; Show build config</button>
                <button class="suggestion-chip" data-prompt="Build the project, run it, and report the output">&#x25B6;&#xFE0F; Build &amp; run</button>
                <button class="suggestion-chip" data-prompt="Analyze all compiler errors and warnings, then fix them">&#x1F41B; Fix all diagnostics</button>
                <button class="suggestion-chip" data-prompt="Show me the project structure">&#x1F4C1; Show project structure</button>
                <button class="suggestion-chip" data-prompt="Explain the main entry point of this project">&#x1F4D6; Explain entry point</button>
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
