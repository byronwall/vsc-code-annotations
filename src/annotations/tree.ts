import * as vscode from "vscode";

import { AnnotationListState } from "../annotationListState";
import {
  AnnotationEntry,
  AnnotationLocationResolution,
  resolveTypeIcon,
} from "./model";
import { AnnotationList, loadAnnotationLists } from "./lists";
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
    private readonly listState: AnnotationListState,
  ) {}

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: vscode.TreeItem,
  ): Promise<vscode.TreeItem[]> {
    if (element instanceof AnnotationListTreeItem) {
      return this.getListChildren(element);
    }

    if (element) {
      return [];
    }

    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [
        new MessageTreeItem("Open a workspace folder to store annotations."),
      ];
    }

    const activeList = await this.listState.resolveActiveList(workspaceFolder);
    const lists = await loadAnnotationLists(workspaceFolder);
    return lists.map(
      (list) =>
        new AnnotationListTreeItem(
          list,
          list.relativePath === activeList.relativePath,
        ),
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private async getListChildren(
    element: AnnotationListTreeItem,
  ): Promise<vscode.TreeItem[]> {
    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [];
    }

    const entries = await loadAnnotations(
      workspaceFolder,
      element.list.documentUri,
    );
    if (entries.length === 0) {
      const documentPath = element.list.isDefault
        ? getAnnotationsDocumentPath()
        : element.list.relativePath;
      return [
        new MessageTreeItem(`No annotations found in ${documentPath} yet.`),
      ];
    }

    return Promise.all(
      entries.map(async (entry) => {
        const resolution = await resolveAnnotationLocation(
          workspaceFolder,
          entry,
        );
        return new AnnotationTreeItem(element.list, entry, resolution);
      }),
    );
  }
}

export class AnnotationListTreeItem extends vscode.TreeItem {
  constructor(
    public readonly list: AnnotationList,
    public readonly isActive: boolean,
  ) {
    super(
      list.name,
      isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = isActive
      ? "annotationListActive"
      : "annotationListInactive";
    this.description = isActive ? "Active" : undefined;
    this.iconPath = new vscode.ThemeIcon(isActive ? "star-full" : "list-tree");
    this.tooltip = `${list.name}\n${list.relativePath}`;
  }
}

export class AnnotationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly list: AnnotationList,
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
