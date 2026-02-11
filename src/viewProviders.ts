import * as vscode from 'vscode';

export class FideViewProvider implements vscode.TreeDataProvider<FideViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FideViewItem | undefined | null | void> = new vscode.EventEmitter<FideViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FideViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FideViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FideViewItem): Thenable<FideViewItem[]> {
        if (!element) {
            // Root level items
            return Promise.resolve([]);
        }
        return Promise.resolve([]);
    }
}

export class DashboardViewProvider implements vscode.TreeDataProvider<FideViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FideViewItem | undefined | null | void> = new vscode.EventEmitter<FideViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FideViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: FideViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FideViewItem): Thenable<FideViewItem[]> {
        if (!element) {
            return Promise.resolve([
                new FideViewItem('Open Dashboard', vscode.TreeItemCollapsibleState.None, {
                    command: 'fide.openDashboard',
                    title: 'Open Dashboard'
                })
            ]);
        }
        return Promise.resolve([]);
    }
}

export class DltViewProvider implements vscode.TreeDataProvider<FideViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FideViewItem | undefined | null | void> = new vscode.EventEmitter<FideViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FideViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: FideViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FideViewItem): Thenable<FideViewItem[]> {
        if (!element) {
            return Promise.resolve([
                new FideViewItem('Open DLT Viewer', vscode.TreeItemCollapsibleState.None, {
                    command: 'fide.openDltViewer',
                    title: 'Open DLT Viewer'
                })
            ]);
        }
        return Promise.resolve([]);
    }
}

export class AiAgentViewProvider implements vscode.TreeDataProvider<FideViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FideViewItem | undefined | null | void> = new vscode.EventEmitter<FideViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FideViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: FideViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FideViewItem): Thenable<FideViewItem[]> {
        if (!element) {
            return Promise.resolve([
                new FideViewItem('Open AI Agent', vscode.TreeItemCollapsibleState.None, {
                    command: 'fide.openAiAgent',
                    title: 'Open AI Agent'
                })
            ]);
        }
        return Promise.resolve([]);
    }
}

class FideViewItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = label;
    }
}
