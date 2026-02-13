import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

// ============================================================================
// Interfaces
// ============================================================================

interface AiConfig {
    apiUrl: string;
    apiKey: string;
    model: string;
    authType?: 'anthropic' | 'bearer';
}

interface WizardState {
    step: 'describe' | 'analyze' | 'diagram' | 'code' | 'done';
    description: string;
    analysis: ChipAnalysis | null;
    diagram: string;
    code: GeneratedCode[];
    projectName: string;
    projectPath: string;
}

interface ChipAnalysis {
    summary: string;
    recommendedChip: ChipRecommendation;
    alternativeChips: ChipRecommendation[];
    peripherals: string[];
    interfaces: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
    reasoning: string;
}

interface ChipRecommendation {
    name: string;
    manufacturer: string;
    core: string;
    flash: string;
    ram: string;
    features: string[];
    reasoning: string;
}

interface GeneratedCode {
    path: string;
    content: string;
    description: string;
}

// ============================================================================
// Provider
// ============================================================================

export class ProjectWizardProvider {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _aiConfig: AiConfig | undefined;
    private _state: WizardState;
    private _isProcessing = false;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._state = this._defaultState();
        this.loadAiConfig();
    }

    private _defaultState(): WizardState {
        return {
            step: 'describe',
            description: '',
            analysis: null,
            diagram: '',
            code: [],
            projectName: '',
            projectPath: ''
        };
    }

    private loadAiConfig() {
        try {
            const configPath = path.join(this._extensionUri.fsPath, 'ai-config.json');
            const configData = fs.readFileSync(configPath, 'utf-8');
            this._aiConfig = JSON.parse(configData);
        } catch (error) {
            console.error('Failed to load ai-config.json:', error);
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
            'fideProjectWizard',
            'FIDE Project Designer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'out', 'project-wizard')
                ]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    case 'chooseFolder':
                        await this.handleChooseFolder();
                        break;
                    case 'submitDescription':
                        await this.handleDescription(message.description, message.projectName);
                        break;
                    case 'selectChip':
                        await this.handleChipSelection(message.chipIndex);
                        break;
                    case 'generateCode':
                        await this.handleGenerateCode();
                        break;
                    case 'createProject':
                        await this.handleCreateProject();
                        break;
                    case 'reset':
                        this.resetWizard();
                        break;
                    case 'goToStep':
                        this.postMessage({ command: 'setStep', step: message.step });
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

    private resetWizard() {
        this._state = this._defaultState();
        this._isProcessing = false;
        this.postMessage({ command: 'reset' });
    }

    // ========================================================================
    // Step 0: Choose project folder
    // ========================================================================

    private async handleChooseFolder() {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        });

        if (folderUri && folderUri.length > 0) {
            this._state.projectPath = folderUri[0].fsPath;
            this.postMessage({
                command: 'folderSelected',
                folderPath: folderUri[0].fsPath
            });
        }
    }

    // ========================================================================
    // Step 1: Analyze project description
    // ========================================================================

    private async handleDescription(description: string, projectName: string) {
        if (!this._aiConfig) {
            this.postMessage({ command: 'error', message: 'AI configuration not loaded. Check ai-config.json' });
            return;
        }

        if (!this._state.projectPath) {
            this.postMessage({ command: 'error', message: 'Please select a project folder first.' });
            return;
        }

        this._state.description = description;
        this._state.projectName = projectName || 'fide-project';
        this._isProcessing = true;
        this.postMessage({ command: 'setProcessing', processing: true, step: 'analyze' });

        try {
            const analysis = await this.analyzeProject(description);
            this._state.analysis = analysis;
            this._state.step = 'analyze';

            this.postMessage({
                command: 'analysisComplete',
                analysis: analysis
            });
        } catch (error) {
            this.postMessage({
                command: 'error',
                message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        } finally {
            this._isProcessing = false;
            this.postMessage({ command: 'setProcessing', processing: false, step: 'analyze' });
        }
    }

    private async analyzeProject(description: string): Promise<ChipAnalysis> {
        const prompt = `You are an embedded systems architect. A user describes a project they want to build. Analyze their requirements and recommend microcontrollers/SoCs.

User's project description:
"${description}"

Respond with ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "summary": "Brief summary of the project requirements",
  "recommendedChip": {
    "name": "e.g. STM32F407VG",
    "manufacturer": "e.g. STMicroelectronics",
    "core": "e.g. ARM Cortex-M4",
    "flash": "e.g. 1MB",
    "ram": "e.g. 192KB",
    "features": ["feature1", "feature2"],
    "reasoning": "Why this chip is recommended"
  },
  "alternativeChips": [
    {
      "name": "alternative chip name",
      "manufacturer": "manufacturer",
      "core": "core type",
      "flash": "flash size",
      "ram": "ram size",
      "features": ["feature1"],
      "reasoning": "Why this is an alternative"
    }
  ],
  "peripherals": ["GPIO", "SPI", "I2C", "UART", "PWM", "ADC", "DAC", "Timer", "Ethernet", "USB"],
  "interfaces": ["communication interfaces needed"],
  "estimatedComplexity": "low|medium|high",
  "reasoning": "Overall reasoning for the recommendation"
}

Provide 2-3 alternative chips. Be specific with real chip part numbers. Consider the peripherals needed for the described project.`;

        const response = await this.callAI(prompt);
        let cleaned = response.trim();

        // Strip code fences
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        // Try direct parse
        try { return JSON.parse(cleaned); } catch { /* fallback */ }

        // Extract JSON object by brace matching
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const extracted = cleaned.substring(firstBrace, lastBrace + 1);
            try { return JSON.parse(extracted); } catch { /* fallback */ }

            // Fix trailing commas
            const fixed = extracted.replace(/,\s*([\]\}])/g, '$1');
            try { return JSON.parse(fixed); } catch { /* give up */ }
        }

        console.error('[ProjectWizard] Could not parse analysis. First 500 chars:', response.substring(0, 500));
        throw new Error('Failed to parse AI analysis response. Please try again.');
    }

    // ========================================================================
    // Step 2: Generate block diagram
    // ========================================================================

    private async handleChipSelection(chipIndex: number) {
        if (!this._aiConfig || !this._state.analysis) { return; }

        const selectedChip = chipIndex === 0
            ? this._state.analysis.recommendedChip
            : this._state.analysis.alternativeChips[chipIndex - 1];

        this._isProcessing = true;
        this.postMessage({ command: 'setProcessing', processing: true, step: 'diagram' });

        try {
            const diagram = await this.generateBlockDiagram(selectedChip);
            this._state.diagram = diagram;
            this._state.step = 'diagram';

            // Save DESIGN.md immediately to the project folder
            await this.saveDiagramToProject();

            this.postMessage({
                command: 'diagramComplete',
                diagram: diagram,
                selectedChip: selectedChip
            });
        } catch (error) {
            this.postMessage({
                command: 'error',
                message: `Diagram generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        } finally {
            this._isProcessing = false;
            this.postMessage({ command: 'setProcessing', processing: false, step: 'diagram' });
        }
    }

    private async generateBlockDiagram(chip: ChipRecommendation): Promise<string> {
        const prompt = `You are an embedded systems architect. Generate a Mermaid block diagram for this project.

Project: "${this._state.description}"
Selected Chip: ${chip.name} (${chip.core}, ${chip.flash} Flash, ${chip.ram} RAM)
Required Peripherals: ${this._state.analysis?.peripherals.join(', ')}
Interfaces: ${this._state.analysis?.interfaces.join(', ')}

Generate a Mermaid diagram that shows:
1. The main MCU/SoC at the center
2. All peripheral connections (sensors, actuators, communication modules)
3. Power supply chain
4. Communication buses (SPI, I2C, UART, Ethernet, etc.)
5. External components (motors, displays, connectors, etc.)

Respond with ONLY the Mermaid diagram code (no code fences, no explanation).
Use the "graph TD" or "graph LR" format.
Make it detailed but readable.
Use descriptive labels on connections showing the protocol (SPI, I2C, UART, PWM, etc.).`;

        const response = await this.callAI(prompt);
        // Clean up response
        let diagram = response.trim();
        if (diagram.startsWith('```')) {
            diagram = diagram.replace(/^```(?:mermaid)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        return diagram;
    }

    // ========================================================================
    // Step 3: Generate Rust simulation code
    // ========================================================================

    private async handleGenerateCode() {
        if (!this._aiConfig || !this._state.analysis) { return; }

        this._isProcessing = true;
        this.postMessage({ command: 'setProcessing', processing: true, step: 'code' });

        try {
            const code = await this.generateSimulationCode();
            this._state.code = code;
            this._state.step = 'code';

            this.postMessage({
                command: 'codeComplete',
                code: code
            });
        } catch (error) {
            this.postMessage({
                command: 'error',
                message: `Code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        } finally {
            this._isProcessing = false;
            this.postMessage({ command: 'setProcessing', processing: false, step: 'code' });
        }
    }

    private async generateSimulationCode(): Promise<GeneratedCode[]> {
        const chip = this._state.analysis!.recommendedChip;
        const prompt = `You are an embedded Rust developer. Generate a complete Rust simulation project for this embedded system.

Project: "${this._state.description}"
Chip: ${chip.name} (${chip.core})
Peripherals: ${this._state.analysis!.peripherals.join(', ')}
Interfaces: ${this._state.analysis!.interfaces.join(', ')}
Block Diagram:
${this._state.diagram}

Generate a desktop simulation of the embedded firmware in Rust. The simulation should:
1. Simulate the hardware peripherals (motors, sensors, communication)
2. Implement the control logic as it would run on the real MCU
3. Use structs to represent hardware peripherals
4. Print state changes to stdout (like a trace/log)
5. Simulate timing with std::thread::sleep where appropriate
6. Include a main loop that simulates the firmware execution cycle
7. Be compilable and runnable with "cargo run"

Respond with ONLY valid JSON (no markdown, no code fences) as an array of file objects:
[
  {
    "path": "Cargo.toml",
    "content": "file content here",
    "description": "Project manifest"
  },
  {
    "path": "src/main.rs",
    "content": "file content here",
    "description": "Main entry point with simulation loop"
  },
  {
    "path": "src/peripherals.rs",
    "content": "file content here",
    "description": "Hardware peripheral simulation structs"
  },
  {
    "path": "src/control.rs",
    "content": "file content here", 
    "description": "Control logic implementation"
  },
  {
    "path": "README.md",
    "content": "file content here",
    "description": "Project documentation"
  }
]

Make the code well-documented with comments explaining how each simulation component maps to real hardware. Include a USAGE.md explaining how to run the simulation and what to expect.`;

        const response = await this.callAI(prompt);
        return this.parseCodeResponse(response);
    }

    /**
     * Robustly parse the AI code generation response.
     * Handles: code fences, extra text before/after JSON, escaped chars, etc.
     */
    private parseCodeResponse(response: string): GeneratedCode[] {
        let cleaned = response.trim();

        // Strategy 1: Strip markdown code fences
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        // Strategy 2: Direct parse
        try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) { return parsed; }
        } catch { /* continue to fallbacks */ }

        // Strategy 3: Find JSON array by bracket matching
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
            const extracted = cleaned.substring(firstBracket, lastBracket + 1);
            try {
                const parsed = JSON.parse(extracted);
                if (Array.isArray(parsed)) { return parsed; }
            } catch { /* continue */ }
        }

        // Strategy 4: Fix common JSON issues (trailing commas, control chars)
        if (firstBracket !== -1 && lastBracket > firstBracket) {
            let fixable = cleaned.substring(firstBracket, lastBracket + 1);
            // Remove trailing commas before ] or }
            fixable = fixable.replace(/,\s*([\]\}])/g, '$1');
            // Escape unescaped newlines inside strings
            fixable = fixable.replace(/(?<=":.*?)\n(?=.*?")/g, '\\n');
            try {
                const parsed = JSON.parse(fixable);
                if (Array.isArray(parsed)) { return parsed; }
            } catch { /* continue */ }
        }

        // Strategy 5: Try to manually extract file objects using regex
        try {
            const files: GeneratedCode[] = [];
            const fileRegex = /\{[^{}]*"path"\s*:\s*"([^"]+)"[^{}]*"content"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"description"\s*:\s*"([^"]+)"[^{}]*\}/gs;
            let match;
            while ((match = fileRegex.exec(cleaned)) !== null) {
                files.push({
                    path: match[1],
                    content: match[2].replace(/\\n/g, '\n').replace(/\\\\/g, '\\').replace(/\\"/g, '"'),
                    description: match[3]
                });
            }
            if (files.length > 0) { return files; }
        } catch { /* continue */ }

        // Log the raw response for debugging
        console.error('[ProjectWizard] Could not parse AI code response. Raw length:', response.length);
        console.error('[ProjectWizard] First 500 chars:', response.substring(0, 500));
        throw new Error('Failed to parse generated code. Check the Output panel for details and try again.');
    }

    // ========================================================================
    // Save DESIGN.md to project folder (called after diagram generation)
    // ========================================================================

    private async saveDiagramToProject() {
        const projectDir = path.join(this._state.projectPath, this._state.projectName);
        await fs.promises.mkdir(projectDir, { recursive: true });

        const chip = this._state.analysis!.recommendedChip;
        const diagramMd = `# System Block Diagram\n\n## Project Description\n${this._state.description}\n\n## Selected Chip\n**${chip.name}** (${chip.core})\n- Flash: ${chip.flash}\n- RAM: ${chip.ram}\n\n## Block Diagram\n\n\`\`\`mermaid\n${this._state.diagram}\n\`\`\`\n\n## Required Peripherals\n${this._state.analysis!.peripherals.map(p => `- ${p}`).join('\n')}\n\n## Communication Interfaces\n${this._state.analysis!.interfaces.map(i => `- ${i}`).join('\n')}\n`;
        await fs.promises.writeFile(path.join(projectDir, 'DESIGN.md'), diagramMd, 'utf-8');
    }

    // ========================================================================
    // Step 4: Create project on disk
    // ========================================================================

    private async handleCreateProject() {
        if (!this._state.projectPath) {
            this.postMessage({ command: 'error', message: 'No project folder selected.' });
            return;
        }

        const projectDir = path.join(this._state.projectPath, this._state.projectName);

        this.postMessage({ command: 'setProcessing', processing: true, step: 'done' });

        try {
            // Create project directory
            await fs.promises.mkdir(projectDir, { recursive: true });

            // Write all generated files
            for (const file of this._state.code) {
                const filePath = path.join(projectDir, file.path);
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, file.content, 'utf-8');
            }

            // Update DESIGN.md (may already exist from diagram step)
            await this.saveDiagramToProject();

            // Write board.json metadata
            const boardJson = {
                project: this._state.projectName,
                description: this._state.description,
                chip: this._state.analysis!.recommendedChip,
                peripherals: this._state.analysis!.peripherals,
                interfaces: this._state.analysis!.interfaces,
                complexity: this._state.analysis!.estimatedComplexity,
                generatedAt: new Date().toISOString()
            };
            await fs.promises.writeFile(
                path.join(projectDir, 'board.json'),
                JSON.stringify(boardJson, null, 2),
                'utf-8'
            );

            // Create .code-workspace file
            const workspace = {
                folders: [{ path: '.' }],
                settings: {
                    'fide.projectId': this._state.projectName,
                    'fide.boardId': this._state.analysis!.recommendedChip.name,
                    'fide.projectType': 'simulation'
                }
            };
            await fs.promises.writeFile(
                path.join(projectDir, `${this._state.projectName}.code-workspace`),
                JSON.stringify(workspace, null, 2),
                'utf-8'
            );

            this._state.step = 'done';

            // Dismiss processing overlay and update UI FIRST
            this.postMessage({ command: 'setProcessing', processing: false, step: 'done' });
            this.postMessage({
                command: 'projectCreated',
                projectPath: projectDir,
                projectName: this._state.projectName
            });

        } catch (error) {
            this.postMessage({
                command: 'error',
                message: `Project creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            this.postMessage({ command: 'setProcessing', processing: false, step: 'done' });
            return;
        }

        // --- Workspace operations (after UI is updated, outside try/finally) ---
        // These may cause extension reload, so webview must already be in final state.
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            const alreadyOpen = workspaceFolders.some(f => f.uri.fsPath === projectDir);
            if (!alreadyOpen) {
                vscode.workspace.updateWorkspaceFolders(
                    workspaceFolders.length,
                    0,
                    { uri: vscode.Uri.file(projectDir), name: this._state.projectName }
                );
            }

            // Open a key file so the user sees the project
            const mainFile = this._state.code.find(f => f.path.endsWith('main.rs'))
                || this._state.code[0];
            if (mainFile) {
                const fileUri = vscode.Uri.file(path.join(projectDir, mainFile.path));
                await vscode.window.showTextDocument(fileUri, { preview: false });
            }
        } catch (err) {
            console.error('[ProjectWizard] Failed to open project in workspace:', err);
        }
    }

    // ========================================================================
    // AI API Call
    // ========================================================================

    private async callAI(prompt: string): Promise<string> {
        if (!this._aiConfig) {
            throw new Error('AI configuration not loaded');
        }

        const authType = this._aiConfig.authType || 'anthropic';
        const headers: any = { 'Content-Type': 'application/json' };

        let requestBody: any;

        if (authType === 'bearer') {
            headers['Authorization'] = `Bearer ${this._aiConfig.apiKey}`;
            requestBody = {
                model: this._aiConfig.model,
                max_tokens: 8192,
                messages: [
                    { role: 'user', content: prompt }
                ]
            };
        } else {
            headers['x-api-key'] = this._aiConfig.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            requestBody = {
                model: this._aiConfig.model,
                max_tokens: 8192,
                messages: [
                    { role: 'user', content: prompt }
                ]
            };
        }

        const response = await axios.post(this._aiConfig.apiUrl, requestBody, {
            headers,
            timeout: 120000 // 2 min timeout for large code generation
        });

        const data = response.data;

        if (authType === 'bearer') {
            return data.choices?.[0]?.message?.content || '';
        } else {
            // Anthropic response
            for (const block of data.content) {
                if (block.type === 'text') {
                    return block.text;
                }
            }
            return '';
        }
    }

    // ========================================================================
    // HTML
    // ========================================================================

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'project-wizard', 'webview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'project-wizard', 'webview.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FIDE Project Designer</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <!-- Header -->
    <div class="wizard-header">
        <div class="header-title">
            <span class="header-icon">🛠️</span>
            <h1>FIDE Project Designer</h1>
        </div>
        <div class="header-actions">
            <button id="resetBtn" class="icon-btn" title="Start over">🔄 New</button>
        </div>
    </div>

    <!-- Progress Steps -->
    <div class="progress-bar">
        <div class="progress-step active" data-step="describe">
            <div class="step-number">1</div>
            <div class="step-label">Describe</div>
        </div>
        <div class="progress-connector"></div>
        <div class="progress-step" data-step="analyze">
            <div class="step-number">2</div>
            <div class="step-label">Analyze</div>
        </div>
        <div class="progress-connector"></div>
        <div class="progress-step" data-step="diagram">
            <div class="step-number">3</div>
            <div class="step-label">Design</div>
        </div>
        <div class="progress-connector"></div>
        <div class="progress-step" data-step="code">
            <div class="step-number">4</div>
            <div class="step-label">Code</div>
        </div>
        <div class="progress-connector"></div>
        <div class="progress-step" data-step="done">
            <div class="step-number">5</div>
            <div class="step-label">Create</div>
        </div>
    </div>

    <!-- Content Area -->
    <div class="wizard-content" id="wizardContent">

        <!-- Step 1: Describe -->
        <div class="step-panel active" id="step-describe">
            <div class="step-hero">
                <div class="hero-icon">💡</div>
                <h2>What do you want to build?</h2>
                <p class="hero-subtitle">Set up your project location, then describe your embedded project in natural language.</p>
            </div>

            <div class="project-setup">
                <div class="setup-row">
                    <div class="setup-field">
                        <label for="projectNameInput">Project Name</label>
                        <input type="text" id="projectNameInput" placeholder="my-embedded-project" value="my-embedded-project" class="project-name-input">
                    </div>
                    <div class="setup-field setup-field-folder">
                        <label>Project Folder</label>
                        <div class="folder-picker">
                            <span class="folder-path" id="folderPath">No folder selected</span>
                            <button class="folder-btn" id="chooseFolderBtn">📂 Choose Folder</button>
                        </div>
                    </div>
                </div>
                <div class="folder-preview" id="folderPreview" style="display:none">
                    <span class="preview-icon">📁</span>
                    <span class="preview-text" id="fullProjectPath"></span>
                </div>
            </div>

            <div class="input-area">
                <textarea id="projectDescription" placeholder="Example: I want to make a robot hand with 3 axis, controlled via Ethernet. It needs 3 servo motors with position feedback, an Ethernet interface for remote control, and a local OLED display showing joint angles. The system should support real-time control at 1kHz update rate." rows="6"></textarea>
            </div>
            <div class="example-chips">
                <span class="example-label">Try these:</span>
                <button class="example-chip" data-text="Robot hand with 3 axis servo motors, controlled via Ethernet, with position feedback and OLED display">🦾 Robot Hand</button>
                <button class="example-chip" data-text="Weather station with temperature, humidity, pressure sensors. Battery powered with solar charging. Data sent via LoRa to a gateway every 5 minutes">🌤️ Weather Station</button>
                <button class="example-chip" data-text="Motor controller for BLDC motor with FOC control, CAN bus interface for automotive use, current sensing, and encoder feedback at 20kHz PWM">⚡ Motor Controller</button>
                <button class="example-chip" data-text="IoT gateway collecting data from 10 BLE sensors, processing locally, and forwarding to cloud via WiFi. Needs local storage on SD card and a small LCD for status">📡 IoT Gateway</button>
            </div>
            <div class="step-actions">
                <button id="analyzeBtn" class="primary-btn" disabled>
                    <span class="btn-icon">🔬</span> Analyze Requirements
                </button>
            </div>
        </div>

        <!-- Step 2: Analysis Results -->
        <div class="step-panel" id="step-analyze">
            <div class="analysis-results" id="analysisResults">
                <!-- Populated by JS -->
            </div>
        </div>

        <!-- Step 3: Block Diagram -->
        <div class="step-panel" id="step-diagram">
            <div class="diagram-container" id="diagramContainer">
                <!-- Populated by JS -->
            </div>
        </div>

        <!-- Step 4: Generated Code -->
        <div class="step-panel" id="step-code">
            <div class="code-container" id="codeContainer">
                <!-- Populated by JS -->
            </div>
        </div>

        <!-- Step 5: Create Project -->
        <div class="step-panel" id="step-done">
            <div class="done-container" id="doneContainer">
                <!-- Populated by JS -->
            </div>
        </div>
    </div>

    <!-- Processing Overlay -->
    <div class="processing-overlay" id="processingOverlay">
        <div class="processing-content">
            <div class="spinner"></div>
            <div class="processing-text" id="processingText">Analyzing...</div>
            <div class="processing-sub" id="processingSub">This may take a moment</div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
