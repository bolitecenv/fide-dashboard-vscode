import * as vscode from 'vscode';
import { DashboardViewProvider } from './dashboardViewProvider';
import { DltViewerProvider } from './dlt-viewer/dltViewerProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('FIDE Embedded Dashboard extension is now active');

    // Register the dashboard view provider
    const dashboardProvider = new DashboardViewProvider(context.extensionUri);

    // Register the DLT viewer provider
    const dltViewerProvider = new DltViewerProvider(context.extensionUri);

    // Register command to open dashboard
    const dashboardDisposable = vscode.commands.registerCommand('fide.openDashboard', () => {
        dashboardProvider.show();
    });

    // Register command to open DLT viewer
    const dltViewerDisposable = vscode.commands.registerCommand('fide.openDltViewer', () => {
        dltViewerProvider.show();
    });

    context.subscriptions.push(dashboardDisposable, dltViewerDisposable);
}

export function deactivate() {
    console.log('FIDE Embedded Dashboard extension is now deactivated');
}
