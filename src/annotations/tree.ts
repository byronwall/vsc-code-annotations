import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationLocationResolution,
  resolveTypeIcon,
} from "./model";
import {
  buildTooltip,
  buildTreeItemDescription,
  resolveTreeItemContextValue,
  summarizeComment,
} from "./presentation";
import { resolveAnnotationLocation } from "./resolution";
import { getAnnotationsDocumentPath, loadAnnotations } from "./storage";

export class AnnotationTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined
  >();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly resolveWorkspaceFolder: () =>
      | vscode.WorkspaceFolder
      | undefined,
  ) {}

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: vscode.TreeItem,
  ): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [
        new MessageTreeItem("Open a workspace folder to store annotations."),
      ];
    }

    const entries = await loadAnnotations(workspaceFolder);
    if (entries.length === 0) {
      return [
        new MessageTreeItem(
          `No annotations found in ${getAnnotationsDocumentPath()} yet.`,
        ),
      ];
    }

    return Promise.all(
      entries.map(async (entry) => {
        const resolution = await resolveAnnotationLocation(
          workspaceFolder,
          entry,
        );
        return new AnnotationTreeItem(entry, resolution);
      }),
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

export class AnnotationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: AnnotationEntry,
    public readonly resolution: AnnotationLocationResolution,
  ) {
    super(summarizeComment(entry), vscode.TreeItemCollapsibleState.None);
    this.contextValue = resolveTreeItemContextValue(resolution.status);
    this.description = buildTreeItemDescription(entry, resolution);
    this.iconPath = new vscode.ThemeIcon(resolveTypeIcon(entry.type));
    this.command = {
      command: "codeAnnotations.openSourceLocation",
      title: "Open Source Location",
      arguments: [this],
    };
    this.tooltip = buildTooltip(entry, resolution);
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "annotationMessage";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}
