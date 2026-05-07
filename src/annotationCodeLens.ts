import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationLocationResolution,
  isAnnotationsDocument,
} from "./annotations";
import {
  buildAnnotationLensTitle,
  buildAnnotationLensTooltip,
  buildFileSummaryTitle,
} from "./annotations/presentation";
import { FILE_ANNOTATION_SUMMARY_COMMAND } from "./annotationCommands";
import {
  loadResolvedAnnotationsForDocument,
  resolveActiveWorkspaceFolder,
} from "./annotationWorkspace";

export class AnnotationCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly onDidChangeCodeLensesEmitter =
    new vscode.EventEmitter<void>();

  public readonly onDidChangeCodeLenses =
    this.onDidChangeCodeLensesEmitter.event;

  constructor(
    private readonly resolveWorkspaceFolder: (
      uri?: vscode.Uri,
    ) => vscode.WorkspaceFolder | undefined = resolveActiveWorkspaceFolder,
  ) {}

  public async provideCodeLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const workspaceFolder = this.resolveWorkspaceFolder(document.uri);
    if (
      !workspaceFolder ||
      document.uri.scheme !== "file" ||
      isAnnotationsDocument(document.uri, workspaceFolder)
    ) {
      return [];
    }

    const fileAnnotations = await loadResolvedAnnotationsForDocument(
      workspaceFolder,
      document.uri,
    );
    if (fileAnnotations.length === 0) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: buildFileSummaryTitle(fileAnnotations.length),
        command: FILE_ANNOTATION_SUMMARY_COMMAND,
        arguments: [document.uri],
        tooltip:
          fileAnnotations.length === 1
            ? "Jump to the annotated line"
            : "Choose an annotation in this file",
      }),
    ];

    for (const { entry, resolution } of fileAnnotations) {
      const line = clampLine(document, entry.startLine - 1);
      codeLenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: buildAnnotationLensTitle(entry, resolution),
          command: "codeAnnotations.openSourceLocation",
          arguments: [entry],
          tooltip: buildAnnotationLensTooltip(entry, resolution),
        }),
      );
    }

    return codeLenses;
  }

  public refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public dispose(): void {
    this.onDidChangeCodeLensesEmitter.dispose();
  }
}

function clampLine(document: vscode.TextDocument, index: number): number {
  return Math.min(Math.max(index, 0), Math.max(document.lineCount - 1, 0));
}
