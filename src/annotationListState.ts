import * as vscode from "vscode";

import { AnnotationList, loadAnnotationLists } from "./annotations";

export class AnnotationListState {
  constructor(private readonly workspaceState: vscode.Memento) {}

  public async resolveActiveList(
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<AnnotationList> {
    const lists = await loadAnnotationLists(workspaceFolder);
    const storedPath = this.workspaceState.get<string>(
      this.getWorkspaceKey(workspaceFolder),
    );

    return lists.find((list) => list.relativePath === storedPath) ?? lists[0];
  }

  public async setActiveList(
    workspaceFolder: vscode.WorkspaceFolder,
    list: AnnotationList,
  ): Promise<void> {
    await this.workspaceState.update(
      this.getWorkspaceKey(workspaceFolder),
      list.relativePath,
    );
  }

  private getWorkspaceKey(workspaceFolder: vscode.WorkspaceFolder): string {
    return `codeAnnotations.activeList:${workspaceFolder.uri.toString()}`;
  }
}
