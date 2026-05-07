import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationLocationResolution,
  AnnotationTreeItem,
  formatAnnotationLocation,
  resolveAnnotationLocation,
} from "./annotations";
import { resolveActiveWorkspaceFolder } from "./annotationWorkspace";

export async function openSourceLocation(
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const resolvedTarget = await resolveAnnotationTarget(workspaceFolder, target);
  if (!resolvedTarget) {
    return;
  }

  const { entry, resolution } = resolvedTarget;
  const codeRef = resolution.status === "missing" ? entry : resolution;
  const fileUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...codeRef.relativePath.split("/"),
  );

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(fileUri);
  } catch {
    vscode.window.showWarningMessage(
      `Unable to open ${codeRef.relativePath} for this annotation.`,
    );
    return;
  }

  const selection = buildSelectionRange(document, codeRef);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    selection,
  });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

async function resolveAnnotationTarget(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<
  | {
      entry: AnnotationEntry;
      resolution: AnnotationLocationResolution;
    }
  | undefined
> {
  const entry = target instanceof AnnotationTreeItem ? target.entry : target;
  if (!entry) {
    return undefined;
  }

  return {
    entry,
    resolution:
      target instanceof AnnotationTreeItem
        ? target.resolution
        : await resolveAnnotationLocation(workspaceFolder, entry),
  };
}

function buildSelectionRange(
  document: vscode.TextDocument,
  target: Pick<
    AnnotationEntry | AnnotationLocationResolution,
    "startLine" | "endLine"
  > & {
    startCharacter?: number;
    endCharacter?: number;
  },
): vscode.Range {
  const startLine = clampLine(document, target.startLine - 1);
  const endLine = clampLine(document, target.endLine - 1);

  if (
    target.startCharacter === undefined ||
    target.endCharacter === undefined
  ) {
    return new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(
        endLine,
        document.lineAt(endLine).range.end.character,
      ),
    );
  }

  const startCharacter = clampCharacter(
    document,
    startLine,
    target.startCharacter,
  );
  const endCharacter = clampCharacter(document, endLine, target.endCharacter);
  const start = new vscode.Position(startLine, startCharacter);
  const end =
    endLine > startLine || endCharacter > startCharacter
      ? new vscode.Position(endLine, endCharacter)
      : new vscode.Position(
          endLine,
          document.lineAt(endLine).range.end.character,
        );

  return new vscode.Range(start, end);
}

function clampLine(document: vscode.TextDocument, index: number): number {
  return Math.min(Math.max(index, 0), Math.max(document.lineCount - 1, 0));
}

function clampCharacter(
  document: vscode.TextDocument,
  line: number,
  character: number,
): number {
  return Math.min(
    Math.max(character, 0),
    document.lineAt(line).range.end.character,
  );
}
