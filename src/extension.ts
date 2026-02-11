import * as vscode from 'vscode';
import { DashboardViewProvider } from './dashboardViewProvider';
import { DltViewerProvider } from './dlt-viewer/dltViewerProvider';
import { AiAgentProvider } from './ai-agent/aiAgentProvider';
import { DashboardViewProvider as DashboardTreeProvider, DltViewProvider as DltTreeProvider, AiAgentViewProvider as AiAgentTreeProvider } from './viewProviders';

export function activate(context: vscode.ExtensionContext) {
    console.log('FIDE Embedded Dashboard extension is now active');

    // Register the dashboard view provider
    const dashboardProvider = new DashboardViewProvider(context.extensionUri);

    // Register the DLT viewer provider
    const dltViewerProvider = new DltViewerProvider(context.extensionUri);

    // Register the AI agent provider
    const aiAgentProvider = new AiAgentProvider(context.extensionUri);

    // Register tree view providers for Activity Bar
    const dashboardTreeProvider = new DashboardTreeProvider();
    const dltTreeProvider = new DltTreeProvider();
    const aiAgentTreeProvider = new AiAgentTreeProvider();

    vscode.window.registerTreeDataProvider('fide.dashboardView', dashboardTreeProvider);
    vscode.window.registerTreeDataProvider('fide.dltViewerView', dltTreeProvider);
    vscode.window.registerTreeDataProvider('fide.aiAgentView', aiAgentTreeProvider);

    // Register command to open dashboard
    const dashboardDisposable = vscode.commands.registerCommand('fide.openDashboard', () => {
        dashboardProvider.show();
    });

    // Register command to open DLT viewer
    const dltViewerDisposable = vscode.commands.registerCommand('fide.openDltViewer', () => {
        dltViewerProvider.show();
    });

    // Register command to open AI agent
    const aiAgentDisposable = vscode.commands.registerCommand('fide.openAiAgent', () => {
        aiAgentProvider.show();
    });

    context.subscriptions.push(dashboardDisposable, dltViewerDisposable, aiAgentDisposable);
}

export function deactivate() {
    console.log('FIDE Embedded Dashboard extension is now deactivated');
}
