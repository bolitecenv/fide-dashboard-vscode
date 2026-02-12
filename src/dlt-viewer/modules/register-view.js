// ============================================================================
// REGISTER VIEW MODULE
// ============================================================================

/**
 * Register View Module
 * Handles register display and updates
 */

// Import shared state
let registers, selectedRegion, vscode;

export function initRegisterView(state) {
    registers = state.registers;
    selectedRegion = state.selectedRegion;
    vscode = state.vscode;
}

export function updateRegister(name, value, timestamp) {
    registers.set(name, { name, value, timestamp });
    renderRegisters();
}

export function renderRegisters() {
    const registerList = document.getElementById('registerList');
    const registerCount = document.getElementById('registerCount');
    
    if (!registerList) return;

    if (registers.size === 0) {
        registerList.innerHTML = `
            <div class="empty-message">
                <p>No registers received</p>
                <p class="hint">Format: REG:&lt;name&gt;:&lt;value&gt;</p>
            </div>
        `;
        if (registerCount) {
            registerCount.textContent = '0';
        }
        return;
    }

    registerList.innerHTML = '';
    
    // Convert to array and sort by name
    const regArray = Array.from(registers.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
    );

    regArray.forEach(reg => {
        const regItem = document.createElement('div');
        regItem.className = 'register-item';
        
        const hexValue = isNaN(parseInt(reg.value)) ? reg.value : 
            '0x' + parseInt(reg.value).toString(16).toUpperCase().padStart(8, '0');
        
        regItem.innerHTML = `
            <div class="register-name">${reg.name}</div>
            <div class="register-value">${reg.value}</div>
            <div class="register-hex">${hexValue}</div>
        `;
        
        registerList.appendChild(regItem);
    });

    if (registerCount) {
        registerCount.textContent = registers.size.toString();
    }
}

export function exportRegisters() {
    const timestamp = new Date().toISOString();
    let logContent = `# Register Snapshot\n`;
    logContent += `# Generated: ${timestamp}\n`;
    logContent += `# Total Registers: ${registers.size}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    const regArray = Array.from(registers.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
    );

    regArray.forEach(reg => {
        const hexValue = isNaN(parseInt(reg.value)) ? reg.value : 
            '0x' + parseInt(reg.value).toString(16).toUpperCase().padStart(8, '0');
        logContent += `${reg.name.padEnd(20)} = ${reg.value.toString().padEnd(15)} (${hexValue})\n`;
    });

    vscode.postMessage({
        command: 'exportRegisters',
        content: logContent
    });
}

export function clearRegisters() {
    registers.clear();
    renderRegisters();
}
