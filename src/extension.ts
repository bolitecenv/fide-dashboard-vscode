import * as vscode from 'vscode';
import { DashboardViewProvider } from './dashboardViewProvider';
import { DltViewerProvider } from './dlt-viewer/dltViewerProvider';
import { AiAgentProvider } from './ai-agent/aiAgentProvider';
import { ProjectWizardProvider } from './project-wizard/projectWizardProvider';
import { DashboardViewProvider as DashboardTreeProvider, DltViewProvider as DltTreeProvider, AiAgentViewProvider as AiAgentTreeProvider, ProjectWizardViewProvider as ProjectWizardTreeProvider } from './viewProviders';

export function activate(context: vscode.ExtensionContext) {
    console.log('FIDE Embedded Dashboard extension is now active');

    // Register the dashboard view provider
    const dashboardProvider = new DashboardViewProvider(context.extensionUri);

    // Register the DLT viewer provider
    const dltViewerProvider = new DltViewerProvider(context.extensionUri);

    // Register the AI agent provider
    const aiAgentProvider = new AiAgentProvider(context.extensionUri);

    // Register the Project Wizard provider
    const projectWizardProvider = new ProjectWizardProvider(context.extensionUri);

    // Register tree view providers for Activity Bar
    const dashboardTreeProvider = new DashboardTreeProvider();
    const dltTreeProvider = new DltTreeProvider();
    const aiAgentTreeProvider = new AiAgentTreeProvider();
    const projectWizardTreeProvider = new ProjectWizardTreeProvider();

    vscode.window.registerTreeDataProvider('fide.dashboardView', dashboardTreeProvider);
    vscode.window.registerTreeDataProvider('fide.dltViewerView', dltTreeProvider);
    vscode.window.registerTreeDataProvider('fide.aiAgentView', aiAgentTreeProvider);
    vscode.window.registerTreeDataProvider('fide.projectWizardView', projectWizardTreeProvider);

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

    // Register command to open Project Wizard
    const projectWizardDisposable = vscode.commands.registerCommand('fide.openProjectWizard', () => {
        projectWizardProvider.show();
    });

    context.subscriptions.push(dashboardDisposable, dltViewerDisposable, aiAgentDisposable, projectWizardDisposable);
}

export function deactivate() {
    console.log('FIDE Embedded Dashboard extension is now deactivated');
}
