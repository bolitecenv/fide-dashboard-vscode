// ============================================================================
// CHART VIEW MODULE
// ============================================================================

/**
 * Chart View Module
 * Handles chart creation, rendering, and data visualization
 */

// Import shared state (will be provided by main webview.js)
let charts, chartDataSeries, nextChartId, selectedRegion, vscode;

export function initChartView(state) {
    charts = state.charts;
    chartDataSeries = state.chartDataSeries;
    nextChartId = state.nextChartId;
    selectedRegion = state.selectedRegion;
    vscode = state.vscode;
    return { charts, chartDataSeries, nextChartId };
}

export function handleChartData(name, timestamp, value) {
    // Find or create chart series
    chartDataSeries.forEach((seriesMap, chartId) => {
        const chart = charts.find(c => c.id === chartId);
        if (!chart) return;

        chart.series.forEach(seriesName => {
            if (name === seriesName) {
                if (!seriesMap.has(name)) {
                    seriesMap.set(name, []);
                }
                seriesMap.get(name).push({ x: timestamp, y: value });

                // Update min/max
                if (chart.autoScale) {
                    const allValues = seriesMap.get(name).map(p => p.y);
                    chart.yMin = Math.min(...allValues);
                    chart.yMax = Math.max(...allValues);
                }

                renderChart(chart);
            }
        });
    });
}

export function addChart() {
    const chartId = nextChartId++;
    const chart = {
        id: chartId,
        title: `Chart ${chartId}`,
        series: [],
        yMin: 0,
        yMax: 100,
        autoScale: true,
        color: '#007acc'
    };
    
    charts.push(chart);
    chartDataSeries.set(chartId, new Map());
    
    renderAllCharts();
    return { nextChartId, chart };
}

export function removeChart(chartId) {
    const index = charts.findIndex(c => c.id === chartId);
    if (index !== -1) {
        charts.splice(index, 1);
        chartDataSeries.delete(chartId);
        renderAllCharts();
    }
}

export function updateChartConfig(chartId, field, value) {
    const chart = charts.find(c => c.id === chartId);
    if (chart) {
        chart[field] = value;
        if (field === 'series' || field === 'autoScale') {
            renderAllCharts();
        } else {
            renderChart(chart);
        }
    }
}

export function renderAllCharts() {
    const chartList = document.getElementById('chartList');
    if (!chartList) return;

    if (charts.length === 0) {
        chartList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <h3>No charts configured</h3>
                <p>Click "Add Chart" to create a new chart</p>
                <p class="hint">Charts display data in format: NAME:timestamp:value</p>
            </div>
        `;
        return;
    }

    chartList.innerHTML = '';
    charts.forEach(chart => {
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-container';
        chartContainer.id = `chart-${chart.id}`;

        const configHtml = `
            <div class="chart-header">
                <input type="text" class="chart-title-input" value="${chart.title}" 
                    onchange="window.chartView.updateChartConfig(${chart.id}, 'title', this.value)">
                <button onclick="window.chartView.removeChart(${chart.id})" class="secondary">✖️</button>
            </div>
            <div class="chart-config">
                <label>Series (comma-separated):</label>
                <input type="text" class="chart-series-input" value="${chart.series.join(', ')}" 
                    onchange="window.chartView.updateChartConfig(${chart.id}, 'series', this.value.split(',').map(s => s.trim()))">
                
                <div class="chart-scale-config">
                    <label><input type="checkbox" ${chart.autoScale ? 'checked' : ''} 
                        onchange="window.chartView.updateChartConfig(${chart.id}, 'autoScale', this.checked)"> Auto Scale</label>
                    
                    ${!chart.autoScale ? `
                        <label>Y Min: <input type="number" value="${chart.yMin}" 
                            onchange="window.chartView.updateChartConfig(${chart.id}, 'yMin', parseFloat(this.value))"></label>
                        <label>Y Max: <input type="number" value="${chart.yMax}" 
                            onchange="window.chartView.updateChartConfig(${chart.id}, 'yMax', parseFloat(this.value))"></label>
                    ` : ''}
                </div>
            </div>
            <canvas class="chart-canvas" id="chart-canvas-${chart.id}" width="800" height="300"></canvas>
        `;

        chartContainer.innerHTML = configHtml;
        chartList.appendChild(chartContainer);

        renderChart(chart);
    });
}

export function renderChart(chart) {
    const canvas = document.getElementById(`chart-canvas-${chart.id}`);
    if (!canvas) return;

    // Match canvas buffer to display size for crisp rendering
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get chart data
    const seriesMap = chartDataSeries.get(chart.id);
    if (!seriesMap || seriesMap.size === 0) {
        ctx.fillStyle = '#999';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet...', width / 2, height / 2);
        return;
    }

    // Find data range
    let xMin = Infinity, xMax = -Infinity;
    let yMin = chart.autoScale ? Infinity : chart.yMin;
    let yMax = chart.autoScale ? -Infinity : chart.yMax;

    seriesMap.forEach((points, name) => {
        if (chart.series.includes(name)) {
            points.forEach(p => {
                xMin = Math.min(xMin, p.x);
                xMax = Math.max(xMax, p.x);
                if (chart.autoScale) {
                    yMin = Math.min(yMin, p.y);
                    yMax = Math.max(yMax, p.y);
                }
            });
        }
    });

    if (xMin === Infinity || xMax === -Infinity) return;

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    // Draw axes
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (plotHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // Y axis labels
        const value = yMax - (yRange / 5) * i;
        ctx.fillStyle = '#999';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(2), padding.left - 5, y + 3);
    }

    // Draw data series
    const colors = ['#007acc', '#d14', '#4ec9b0', '#f9a825', '#6a1b9a'];
    let colorIndex = 0;

    seriesMap.forEach((points, name) => {
        if (!chart.series.includes(name)) return;

        const color = colors[colorIndex % colors.length];
        colorIndex++;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let first = true;
        points.forEach(p => {
            const x = padding.left + ((p.x - xMin) / xRange) * plotWidth;
            const y = height - padding.bottom - ((p.y - yMin) / yRange) * plotHeight;

            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw legend
        const legendY = padding.top + colorIndex * 15;
        ctx.fillStyle = color;
        ctx.fillRect(width - padding.right - 100, legendY - 8, 12, 12);
        ctx.fillStyle = '#ccc';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(name, width - padding.right - 85, legendY + 2);
    });

    // X axis label
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Time (${xMin.toFixed(1)} - ${xMax.toFixed(1)} ms)`, width / 2, height - 10);
}

export function exportChartsData() {
    const timestamp = new Date().toISOString();
    let logContent = `# Chart Data Export\n`;
    logContent += `# Generated: ${timestamp}\n`;
    if (selectedRegion) {
        logContent += `# Region: ${selectedRegion.startTime.toFixed(2)}ms - ${selectedRegion.endTime.toFixed(2)}ms\n`;
    }
    logContent += `\n`;

    charts.forEach(chart => {
        logContent += `## Chart: ${chart.title}\n`;
        logContent += `Series: ${chart.series.join(', ')}\n`;
        logContent += `Y Range: ${chart.yMin} - ${chart.yMax} ${chart.autoScale ? '(auto)' : ''}\n\n`;

        const chartData = chartDataSeries.get(chart.id);
        if (chartData) {
            chart.series.forEach(seriesName => {
                const dataPoints = chartData.get(seriesName) || [];
                
                // Filter by region if selected
                let filteredPoints = dataPoints;
                if (selectedRegion) {
                    filteredPoints = dataPoints.filter(p => 
                        p.x >= selectedRegion.startTime && p.x <= selectedRegion.endTime
                    );
                }

                if (filteredPoints.length > 0) {
                    chartData.set(seriesName, filteredPoints);
                }
            });

            chartData.forEach((points, seriesName) => {
                logContent += `### Series: ${seriesName} (${points.length} points)\n`;
                points.forEach((point, idx) => {
                    logContent += `${idx + 1}. [${point.x.toFixed(2)}ms] ${point.y.toFixed(4)}\n`;
                });
                logContent += `\n`;
            });
        }
    });

    vscode.postMessage({
        command: 'exportView',
        viewName: 'charts',
        content: logContent
    });
}
