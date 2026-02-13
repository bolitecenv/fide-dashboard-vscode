// ============================================================================
// FIDE PROJECT WIZARD - Webview Script
// ============================================================================

const vscode = acquireVsCodeApi();

// State
let currentStep = 'describe';
let analysisData = null;
let selectedChipIndex = 0;
let diagramCode = '';
let generatedCode = [];
let selectedFolder = '';

// ============================================================================
// DOM Setup
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('projectDescription');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn');
    const chooseFolderBtn = document.getElementById('chooseFolderBtn');
    const projectNameInput = document.getElementById('projectNameInput');

    // Update full path preview
    function updatePathPreview() {
        const preview = document.getElementById('folderPreview');
        const fullPath = document.getElementById('fullProjectPath');
        const name = projectNameInput.value.trim() || 'my-embedded-project';
        if (selectedFolder) {
            preview.style.display = 'flex';
            fullPath.textContent = selectedFolder + '/' + name;
        } else {
            preview.style.display = 'none';
        }
        validateForm();
    }

    // Validate form: need folder + description
    function validateForm() {
        const hasDesc = textarea.value.trim().length >= 10;
        const hasFolder = selectedFolder.length > 0;
        analyzeBtn.disabled = !(hasDesc && hasFolder);
    }

    // Enable/disable analyze button
    textarea.addEventListener('input', validateForm);
    projectNameInput.addEventListener('input', updatePathPreview);

    // Choose folder button
    chooseFolderBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'chooseFolder' });
    });

    // Analyze button
    analyzeBtn.addEventListener('click', () => {
        const desc = textarea.value.trim();
        const name = projectNameInput.value.trim() || 'my-embedded-project';
        if (desc.length >= 10 && selectedFolder) {
            vscode.postMessage({ command: 'submitDescription', description: desc, projectName: name });
        }
    });

    // Example chips
    document.querySelectorAll('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            textarea.value = chip.getAttribute('data-text');
            textarea.dispatchEvent(new Event('input'));
        });
    });

    // Reset button
    resetBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'reset' });
    });

    // Enter to submit (Ctrl+Enter)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            analyzeBtn.click();
        }
    });

    // Settings panel
    const settingsBtn = document.getElementById('settingsBtn');
    const configPanel = document.getElementById('configPanel');
    const configBackdrop = document.getElementById('configBackdrop');
    const configCloseBtn = document.getElementById('configCloseBtn');
    const configCancelBtn = document.getElementById('configCancelBtn');
    const configSaveBtn = document.getElementById('configSaveBtn');
    const toggleKeyBtn = document.getElementById('toggleKeyBtn');

    function openConfig() {
        vscode.postMessage({ command: 'getAiConfig' });
        configPanel.classList.add('open');
        configBackdrop.classList.add('open');
    }

    function closeConfig() {
        configPanel.classList.remove('open');
        configBackdrop.classList.remove('open');
        document.getElementById('configStatus').textContent = '';
    }

    settingsBtn.addEventListener('click', openConfig);
    configCloseBtn.addEventListener('click', closeConfig);
    configCancelBtn.addEventListener('click', closeConfig);
    configBackdrop.addEventListener('click', closeConfig);

    toggleKeyBtn.addEventListener('click', () => {
        const keyInput = document.getElementById('cfgApiKey');
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });

    configSaveBtn.addEventListener('click', () => {
        const config = {
            apiUrl: document.getElementById('cfgApiUrl').value.trim(),
            apiKey: document.getElementById('cfgApiKey').value.trim(),
            model: document.getElementById('cfgModel').value.trim(),
            authType: document.getElementById('cfgAuthType').value
        };
        if (!config.apiUrl || !config.apiKey || !config.model) {
            document.getElementById('configStatus').textContent = '⚠️ All fields are required';
            document.getElementById('configStatus').className = 'config-status error';
            return;
        }
        vscode.postMessage({ command: 'saveAiConfig', config });
    });

    // Auto-select URL when auth type changes
    document.getElementById('cfgAuthType').addEventListener('change', (e) => {
        const urlInput = document.getElementById('cfgApiUrl');
        if (e.target.value === 'anthropic' && (!urlInput.value || urlInput.value.includes('openai'))) {
            urlInput.value = 'https://api.anthropic.com/v1/messages';
        } else if (e.target.value === 'bearer' && (!urlInput.value || urlInput.value.includes('anthropic'))) {
            urlInput.value = 'https://api.openai.com/v1/chat/completions';
        }
    });
});

// ============================================================================
// Message Handler
// ============================================================================

window.addEventListener('message', (event) => {
    const msg = event.data;

    switch (msg.command) {
        case 'folderSelected':
            selectedFolder = msg.folderPath;
            document.getElementById('folderPath').textContent = msg.folderPath;
            document.getElementById('folderPath').classList.add('has-folder');
            // Update preview
            const nameInput = document.getElementById('projectNameInput');
            const name = nameInput ? (nameInput.value.trim() || 'my-embedded-project') : 'my-embedded-project';
            const preview = document.getElementById('folderPreview');
            const fullPath = document.getElementById('fullProjectPath');
            preview.style.display = 'flex';
            fullPath.textContent = selectedFolder + '/' + name;
            // Re-validate
            const textarea = document.getElementById('projectDescription');
            const analyzeBtn = document.getElementById('analyzeBtn');
            analyzeBtn.disabled = !(textarea.value.trim().length >= 10 && selectedFolder.length > 0);
            break;

        case 'setProcessing':
            setProcessing(msg.processing, msg.step);
            break;

        case 'analysisComplete':
            analysisData = msg.analysis;
            renderAnalysis(msg.analysis);
            goToStep('analyze');
            break;

        case 'diagramComplete':
            diagramCode = msg.diagram;
            renderDiagram(msg.diagram, msg.selectedChip);
            goToStep('diagram');
            break;

        case 'codeComplete':
            generatedCode = msg.code;
            renderCode(msg.code);
            goToStep('code');
            break;

        case 'projectCreated':
            renderDone(msg.projectPath, msg.projectName);
            goToStep('done');
            break;

        case 'error':
            showError(msg.message);
            break;

        case 'aiConfigLoaded':
            document.getElementById('cfgApiUrl').value = msg.config.apiUrl || '';
            document.getElementById('cfgApiKey').value = msg.config.apiKey || '';
            document.getElementById('cfgModel').value = msg.config.model || '';
            document.getElementById('cfgAuthType').value = msg.config.authType || 'anthropic';
            break;

        case 'aiConfigSaved':
            if (msg.success) {
                const status = document.getElementById('configStatus');
                status.textContent = '✅ Configuration saved!';
                status.className = 'config-status success';
                setTimeout(() => {
                    document.getElementById('configPanel').classList.remove('open');
                    document.getElementById('configBackdrop').classList.remove('open');
                    status.textContent = '';
                }, 1200);
            } else {
                const status = document.getElementById('configStatus');
                status.textContent = '⚠️ ' + (msg.message || 'Save failed');
                status.className = 'config-status error';
            }
            break;

        case 'reset':
            resetUI();
            break;
    }
});

// ============================================================================
// Step Navigation
// ============================================================================

function goToStep(step) {
    currentStep = step;

    // Update step panels
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`step-${step}`);
    if (panel) {
        panel.classList.add('active');
    }

    // Update progress bar
    const steps = ['describe', 'analyze', 'diagram', 'code', 'done'];
    const stepIndex = steps.indexOf(step);

    document.querySelectorAll('.progress-step').forEach((el, i) => {
        el.classList.remove('active', 'completed');
        if (i < stepIndex) {
            el.classList.add('completed');
        } else if (i === stepIndex) {
            el.classList.add('active');
        }
    });

    document.querySelectorAll('.progress-connector').forEach((el, i) => {
        el.classList.toggle('completed', i < stepIndex);
    });
}

// ============================================================================
// Processing Overlay
// ============================================================================

function setProcessing(processing, step) {
    const overlay = document.getElementById('processingOverlay');
    const text = document.getElementById('processingText');
    const sub = document.getElementById('processingSub');

    if (processing) {
        overlay.classList.add('active');
        switch (step) {
            case 'analyze':
                text.textContent = '🔬 Analyzing Requirements...';
                sub.textContent = 'AI is evaluating your project and selecting the best chips';
                break;
            case 'diagram':
                text.textContent = '📐 Generating Block Diagram...';
                sub.textContent = 'Designing the system architecture';
                break;
            case 'code':
                text.textContent = '⚡ Generating Rust Code...';
                sub.textContent = 'Writing simulation firmware code';
                break;
            case 'done':
                text.textContent = '📁 Creating Project...';
                sub.textContent = 'Writing files to disk';
                break;
        }
    } else {
        overlay.classList.remove('active');
    }
}

// ============================================================================
// Step 2: Render Analysis
// ============================================================================

function renderAnalysis(analysis) {
    const container = document.getElementById('analysisResults');

    // Summary section
    let html = `
        <div class="analysis-section">
            <h2>📋 Project Analysis</h2>
            <div class="summary-card">
                <p>${escapeHtml(analysis.summary)}</p>
                <div class="complexity-badge complexity-${analysis.estimatedComplexity}">
                    Complexity: ${analysis.estimatedComplexity.toUpperCase()}
                </div>
            </div>
        </div>

        <div class="analysis-section">
            <h3>🔧 Required Peripherals</h3>
            <div class="tag-list">
                ${analysis.peripherals.map(p => `<span class="tag tag-peripheral">${escapeHtml(p)}</span>`).join('')}
            </div>
        </div>

        <div class="analysis-section">
            <h3>🔗 Communication Interfaces</h3>
            <div class="tag-list">
                ${analysis.interfaces.map(i => `<span class="tag tag-interface">${escapeHtml(i)}</span>`).join('')}
            </div>
        </div>

        <div class="analysis-section">
            <h3>🏆 Recommended Chip</h3>
            ${renderChipCard(analysis.recommendedChip, 0, true)}
        </div>

        <div class="analysis-section">
            <h3>🔄 Alternatives</h3>
            <div class="chip-alternatives">
                ${analysis.alternativeChips.map((chip, i) => renderChipCard(chip, i + 1, false)).join('')}
            </div>
        </div>

        <div class="analysis-section">
            <h3>💭 Reasoning</h3>
            <div class="reasoning-card">
                <p>${escapeHtml(analysis.reasoning)}</p>
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Attach chip selection handlers
    container.querySelectorAll('.chip-card').forEach(card => {
        card.addEventListener('click', () => {
            container.querySelectorAll('.chip-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedChipIndex = parseInt(card.dataset.index);
        });
    });
}

function renderChipCard(chip, index, isRecommended) {
    return `
        <div class="chip-card ${isRecommended ? 'recommended selected' : ''}" data-index="${index}">
            ${isRecommended ? '<div class="chip-badge">⭐ Recommended</div>' : ''}
            <div class="chip-header">
                <h4>${escapeHtml(chip.name)}</h4>
                <span class="chip-manufacturer">${escapeHtml(chip.manufacturer)}</span>
            </div>
            <div class="chip-specs">
                <div class="spec-item">
                    <span class="spec-label">Core</span>
                    <span class="spec-value">${escapeHtml(chip.core)}</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">Flash</span>
                    <span class="spec-value">${escapeHtml(chip.flash)}</span>
                </div>
                <div class="spec-item">
                    <span class="spec-label">RAM</span>
                    <span class="spec-value">${escapeHtml(chip.ram)}</span>
                </div>
            </div>
            <div class="chip-features">
                ${chip.features.map(f => `<span class="tag tag-feature">${escapeHtml(f)}</span>`).join('')}
            </div>
            <p class="chip-reasoning">${escapeHtml(chip.reasoning)}</p>
            <button class="select-chip-btn" onclick="selectChip(${index})">
                ${isRecommended ? '✅ Select & Generate Diagram' : '🔄 Select This Chip'}
            </button>
        </div>
    `;
}

function selectChip(index) {
    selectedChipIndex = index;
    vscode.postMessage({ command: 'selectChip', chipIndex: index });
}
window.selectChip = selectChip;

// ============================================================================
// Step 3: Render Block Diagram
// ============================================================================

function renderDiagram(diagram, selectedChip) {
    const container = document.getElementById('diagramContainer');

    container.innerHTML = `
        <div class="diagram-header">
            <h2>📐 System Block Diagram</h2>
            <div class="chip-summary">
                <span class="chip-name">${escapeHtml(selectedChip.name)}</span>
                <span class="chip-core">${escapeHtml(selectedChip.core)}</span>
            </div>
        </div>

        <div class="diagram-display">
            <div class="diagram-code">
                <div class="code-header">
                    <span>Mermaid Diagram</span>
                    <button class="copy-btn" onclick="copyToClipboard('diagramSource')">📋 Copy</button>
                </div>
                <pre id="diagramSource"><code>${escapeHtml(diagram)}</code></pre>
            </div>
            <div class="diagram-note">
                <p>📌 This Mermaid diagram is saved as <strong>DESIGN.md</strong> in your project. 
                You can preview it in VS Code with the Mermaid extension, or paste it into 
                <a href="https://mermaid.live" style="color: var(--vscode-textLink-foreground);">mermaid.live</a> to visualize.</p>
            </div>
        </div>

        <div class="step-actions">
            <button class="secondary-btn" onclick="goBack('analyze')">← Back to Analysis</button>
            <button class="primary-btn" onclick="generateCode()">
                <span class="btn-icon">⚡</span> Generate Rust Simulation Code
            </button>
        </div>
    `;
}

function generateCode() {
    vscode.postMessage({ command: 'generateCode' });
}
window.generateCode = generateCode;

function goBack(step) {
    goToStep(step);
}
window.goBack = goBack;

function copyToClipboard(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        const text = el.textContent;
        navigator.clipboard.writeText(text).catch(() => {
            // Fallback
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('copy');
        });
    }
}
window.copyToClipboard = copyToClipboard;

// ============================================================================
// Step 4: Render Generated Code
// ============================================================================

function renderCode(code) {
    const container = document.getElementById('codeContainer');

    let html = `
        <div class="code-header-section">
            <h2>⚡ Generated Simulation Code</h2>
            <p class="code-subtitle">${code.length} files generated. Review and create your project.</p>
        </div>
        <div class="code-files">
    `;

    code.forEach((file, i) => {
        const lang = getLanguage(file.path);
        html += `
            <div class="code-file">
                <div class="file-header" onclick="toggleFile(${i})">
                    <span class="file-icon">${getFileIcon(file.path)}</span>
                    <span class="file-path">${escapeHtml(file.path)}</span>
                    <span class="file-desc">${escapeHtml(file.description)}</span>
                    <span class="file-toggle" id="toggle-${i}">▶</span>
                </div>
                <div class="file-content" id="file-${i}" style="display: none;">
                    <div class="code-actions">
                        <button class="copy-btn" onclick="copyToClipboard('code-${i}')">📋 Copy</button>
                    </div>
                    <pre id="code-${i}"><code class="language-${lang}">${escapeHtml(file.content)}</code></pre>
                </div>
            </div>
        `;
    });

    html += `
        </div>
        <div class="step-actions">
            <button class="secondary-btn" onclick="goBack('diagram')">← Back to Diagram</button>
            <div class="create-project-group">
                <button class="primary-btn create-btn" onclick="createProject()">
                    <span class="btn-icon">📁</span> Create Project
                </button>
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Auto-expand first file
    toggleFile(0);
}

function toggleFile(index) {
    const content = document.getElementById(`file-${index}`);
    const toggle = document.getElementById(`toggle-${index}`);
    if (content.style.display === 'none') {
        content.style.display = 'block';
        toggle.textContent = '▼';
    } else {
        content.style.display = 'none';
        toggle.textContent = '▶';
    }
}
window.toggleFile = toggleFile;

function createProject() {
    vscode.postMessage({ command: 'createProject' });
}
window.createProject = createProject;

function getFileIcon(path) {
    if (path.endsWith('.rs')) return '🦀';
    if (path.endsWith('.toml')) return '📦';
    if (path.endsWith('.md')) return '📄';
    if (path.endsWith('.json')) return '📋';
    return '📄';
}

function getLanguage(path) {
    if (path.endsWith('.rs')) return 'rust';
    if (path.endsWith('.toml')) return 'toml';
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.json')) return 'json';
    return 'text';
}

// ============================================================================
// Step 5: Done
// ============================================================================

function renderDone(projectPath, projectName) {
    const container = document.getElementById('doneContainer');

    container.innerHTML = `
        <div class="done-hero">
            <div class="done-icon">🎉</div>
            <h2>Project Created!</h2>
            <p class="done-path">${escapeHtml(projectPath)}</p>
        </div>
        <div class="done-summary">
            <div class="done-card">
                <h3>📁 ${escapeHtml(projectName)}</h3>
                <div class="done-items">
                    <div class="done-item">✅ Rust simulation code generated</div>
                    <div class="done-item">✅ Block diagram saved (DESIGN.md)</div>
                    <div class="done-item">✅ Board configuration saved (board.json)</div>
                    <div class="done-item">✅ VS Code workspace file created</div>
                </div>
            </div>
            <div class="next-steps">
                <h3>🚀 Next Steps</h3>
                <ol>
                    <li>Open the project workspace</li>
                    <li>Run <code>cargo build</code> to compile the simulation</li>
                    <li>Run <code>cargo run</code> to execute the simulation</li>
                    <li>Review DESIGN.md for the system block diagram</li>
                    <li>Design your PCB based on the block diagram</li>
                    <li>Flash the firmware to your real board</li>
                </ol>
            </div>
        </div>
        <div class="step-actions">
            <button class="primary-btn" onclick="startNew()">
                <span class="btn-icon">🔄</span> Design Another Project
            </button>
        </div>
    `;
}

function startNew() {
    vscode.postMessage({ command: 'reset' });
}
window.startNew = startNew;

// ============================================================================
// Error & Reset
// ============================================================================

function showError(message) {
    // Create floating error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-toast';
    errorDiv.innerHTML = `
        <span class="error-icon">⚠️</span>
        <span class="error-text">${escapeHtml(message)}</span>
        <button class="error-close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.body.appendChild(errorDiv);

    // Auto-remove after 8 seconds
    setTimeout(() => errorDiv.remove(), 8000);
}

function resetUI() {
    currentStep = 'describe';
    analysisData = null;
    selectedChipIndex = 0;
    diagramCode = '';
    generatedCode = [];
    selectedFolder = '';

    goToStep('describe');

    const textarea = document.getElementById('projectDescription');
    textarea.value = '';
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('projectNameInput').value = 'my-embedded-project';
    document.getElementById('folderPath').textContent = 'No folder selected';
    document.getElementById('folderPath').classList.remove('has-folder');
    document.getElementById('folderPreview').style.display = 'none';
    document.getElementById('analysisResults').innerHTML = '';
    document.getElementById('diagramContainer').innerHTML = '';
    document.getElementById('codeContainer').innerHTML = '';
    document.getElementById('doneContainer').innerHTML = '';
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
