import * as path from "node:path";
import * as vscode from "vscode";

import {
  AnnotationDraft,
  AnnotationType,
  formatAnnotationLocation,
  getAnnotationTypeOptions,
} from "./annotations";
import { toPosix } from "./annotations/utils";

export type AnnotationSelectionDraft = Omit<
  AnnotationDraft,
  "type" | "comment"
>;

export function buildSelectionDraft(
  editor: vscode.TextEditor,
  workspaceFolder: vscode.WorkspaceFolder,
): AnnotationSelectionDraft | undefined {
  const selection = editor.selection;
  const scope = selection.isEmpty ? "file" : "selection";
  const code =
    scope === "file" ? "" : editor.document.getText(selection).trimEnd();
  if (scope === "selection" && !code.trim()) {
    return undefined;
  }

  const relativePath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath),
  );
  const startLine = scope === "file" ? 1 : selection.start.line + 1;
  const endLine =
    scope === "file"
      ? Math.max(editor.document.lineCount, 1)
      : selection.end.character === 0 &&
          selection.end.line > selection.start.line
        ? selection.end.line
        : selection.end.line + 1;

  return {
    relativePath,
    startLine,
    endLine,
    scope,
    code,
    language:
      editor.document.languageId && editor.document.languageId !== "plaintext"
        ? editor.document.languageId
        : undefined,
  };
}

export async function pickAnnotationType(
  draft: AnnotationSelectionDraft,
): Promise<AnnotationType | undefined> {
  const picked = await vscode.window.showQuickPick(
    getAnnotationTypeOptions().map((option) => ({
      label: option.label,
      description: option.description,
      detail: `${formatAnnotationLocation({
        relativePath: draft.relativePath,
        startLine: draft.startLine,
        endLine: draft.endLine,
      })} • ${describeDraftTarget(draft, 120)}`,
      value: option.value,
    })),
    {
      title: "Add annotation",
      placeHolder: "Choose the annotation type",
      ignoreFocusOut: true,
    },
  );

  return picked?.value;
}

export async function promptForComment(
  draft: AnnotationSelectionDraft,
): Promise<string | undefined> {
  const location = formatAnnotationLocation({
    relativePath: draft.relativePath,
    startLine: draft.startLine,
    endLine: draft.endLine,
  });
  const comment = await vscode.window.showInputBox({
    title:
      draft.scope === "file"
        ? `Comment on ${draft.relativePath} (whole file)`
        : `Comment on ${location}`,
    prompt: describeDraftTarget(draft, 180),
    placeHolder:
      "Add a short note now; you can expand it with full markdown in the annotations document",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length > 0 ? undefined : "Comment is required.",
  });

  return comment?.trim() || undefined;
}

function truncateForUi(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}...`;
}

function describeDraftTarget(
  draft: AnnotationSelectionDraft,
  limit: number,
): string {
  if (draft.scope === "file") {
    return `whole file (${draft.relativePath})`;
  }

  return truncateForUi(draft.code, limit);
}
