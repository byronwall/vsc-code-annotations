import * as path from "node:path";
import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationLocationResolution,
  loadAnnotations,
  resolveAnnotationLocation,
} from "./annotations";
import { toPosix } from "./annotations/utils";

export interface ResolvedAnnotation {
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
  const entries = (await loadAnnotations(workspaceFolder)).filter(
    (entry) => entry.relativePath === relativePath,
  );

  return Promise.all(
    entries.map(async (entry) => ({
      entry,
      resolution: await resolveAnnotationLocation(workspaceFolder, entry),
    })),
  );
}
