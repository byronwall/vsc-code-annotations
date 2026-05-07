import * as path from "node:path";
import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationList,
  AnnotationLocationResolution,
  loadAnnotationLists,
  loadAnnotations,
  resolveAnnotationLocation,
} from "./annotations";
import { toPosix } from "./annotations/utils";

export interface ResolvedAnnotation {
  list: AnnotationList;
  entry: AnnotationEntry;
  resolution: AnnotationLocationResolution;
}

export function resolveActiveWorkspaceFolder(
  uri?: vscode.Uri,
): vscode.WorkspaceFolder | undefined {
  if (uri) {
    return (
      vscode.workspace.getWorkspaceFolder(uri) ??
      vscode.workspace.workspaceFolders?.[0]
    );
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    return (
      vscode.workspace.getWorkspaceFolder(activeUri) ??
      vscode.workspace.workspaceFolders?.[0]
    );
  }

  return vscode.workspace.workspaceFolders?.[0];
}

export async function loadResolvedAnnotationsForDocument(
  workspaceFolder: vscode.WorkspaceFolder,
  documentUri: vscode.Uri,
): Promise<ResolvedAnnotation[]> {
  const relativePath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath),
  );
  const lists = await loadAnnotationLists(workspaceFolder);
  const matches = await Promise.all(
    lists.map(async (list) => {
      const entries = (
        await loadAnnotations(workspaceFolder, list.documentUri)
      ).filter((entry) => entry.relativePath === relativePath);

      return Promise.all(
        entries.map(async (entry) => ({
          list,
          entry,
          resolution: await resolveAnnotationLocation(workspaceFolder, entry),
        })),
      );
    }),
  );

  return matches
    .flat()
    .sort((left, right) =>
      right.entry.addedAt.localeCompare(left.entry.addedAt),
    );
}
