import * as path from "node:path";
import * as vscode from "vscode";
import {
  AnnotationDraft,
  AnnotationEntry,
  AnnotationTreeProvider,
  AnnotationType,
  appendAnnotation,
  ensureAnnotationsDocument,
  formatAnnotationLocation,
  getAnnotationTypeOptions,
  isAnnotationsDocument,
} from "./annotations";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const treeProvider = new AnnotationTreeProvider(resolveActiveWorkspaceFolder);
  const treeView = vscode.window.createTreeView("codeAnnotations.annotations", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeProvider,
    treeView,
    vscode.commands.registerCommand(
      "codeAnnotations.addAnnotation",
      async () => {
        await addAnnotation(treeProvider);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.openAnnotationsSidebar",
      async () => {
        treeProvider.refresh();
        await vscode.commands.executeCommand(
          "codeAnnotations.annotations.focus",
        );
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.openAnnotationsDocument",
      async () => {
        await openAnnotationsDocument();
      },
    ),
    vscode.commands.registerCommand("codeAnnotations.refresh", () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "codeAnnotations.openSourceLocation",
      async (entry: AnnotationEntry) => {
        await openSourceLocation(entry);
      },
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const workspaceFolder = resolveActiveWorkspaceFolder(document.uri);
      if (
        workspaceFolder &&
        isAnnotationsDocument(document.uri, workspaceFolder)
      ) {
        treeProvider.refresh();
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const file of event.files) {
        const workspaceFolder = resolveActiveWorkspaceFolder(file);
        if (workspaceFolder && isAnnotationsDocument(file, workspaceFolder)) {
          treeProvider.refresh();
          break;
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codeAnnotations.documentPath")) {
        treeProvider.refresh();
      }
    }),
  );
}

async function addAnnotation(
  treeProvider: AnnotationTreeProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showWarningMessage(
      "Open a workspace file and select code before adding an annotation.",
    );
    return;
  }

  const workspaceFolder = resolveActiveWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace folder before adding annotations.",
    );
    return;
  }

  const selectionDraft = buildSelectionDraft(editor, workspaceFolder);
  if (!selectionDraft) {
    vscode.window.showWarningMessage(
      "Select one or more lines of code before adding an annotation.",
    );
    return;
  }

  const type = await pickAnnotationType(selectionDraft);
  if (!type) {
    return;
  }

  const comment = await promptForComment(selectionDraft);
  if (!comment) {
    return;
  }

  const entry = await appendAnnotation(workspaceFolder, {
    ...selectionDraft,
    type,
    comment,
  });

  treeProvider.refresh();
  vscode.window.setStatusBarMessage(
    `Saved annotation for ${formatAnnotationLocation(entry)}`,
    3000,
  );
}

async function openAnnotationsDocument(): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace folder before opening the annotations document.",
    );
    return;
  }

  const documentUri = await ensureAnnotationsDocument(workspaceFolder);
  const document = await vscode.workspace.openTextDocument(documentUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function openSourceLocation(entry: AnnotationEntry): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const fileUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...entry.relativePath.split("/"),
  );
  const document = await vscode.workspace.openTextDocument(fileUri);
  const startLine = clampLine(document, entry.startLine - 1);
  const endLine = clampLine(document, entry.endLine - 1);
  const selection = new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, document.lineAt(endLine).range.end.character),
  );
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    selection,
  });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

function buildSelectionDraft(
  editor: vscode.TextEditor,
  workspaceFolder: vscode.WorkspaceFolder,
): Omit<AnnotationDraft, "type" | "comment"> | undefined {
  const selection = editor.selection;
  if (selection.isEmpty) {
    return undefined;
  }

  const code = editor.document.getText(selection).trimEnd();
  if (!code.trim()) {
    return undefined;
  }

  const relativePath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath),
  );
  const startLine = selection.start.line + 1;
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line
      : selection.end.line + 1;

  return {
    relativePath,
    startLine,
    endLine,
    code,
    language:
      editor.document.languageId && editor.document.languageId !== "plaintext"
        ? editor.document.languageId
        : undefined,
  };
}

async function pickAnnotationType(
  draft: Omit<AnnotationDraft, "type" | "comment">,
): Promise<AnnotationType | undefined> {
  const picked = await vscode.window.showQuickPick(
    getAnnotationTypeOptions().map((option) => ({
      label: option.label,
      description: option.description,
      detail: `${formatAnnotationLocation({
        relativePath: draft.relativePath,
        startLine: draft.startLine,
        endLine: draft.endLine,
      })} • ${truncateForUi(draft.code, 120)}`,
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

async function promptForComment(
  draft: Omit<AnnotationDraft, "type" | "comment">,
): Promise<string | undefined> {
  const location = formatAnnotationLocation({
    relativePath: draft.relativePath,
    startLine: draft.startLine,
    endLine: draft.endLine,
  });
  const comment = await vscode.window.showInputBox({
    title: `Comment on ${location}`,
    prompt: truncateForUi(draft.code, 180),
    placeHolder: "Describe the change, issue, or follow-up for this code",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length > 0 ? undefined : "Comment is required.",
  });

  return comment?.trim() || undefined;
}

function resolveActiveWorkspaceFolder(
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

function truncateForUi(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}...`;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function clampLine(document: vscode.TextDocument, index: number): number {
  return Math.min(Math.max(index, 0), Math.max(document.lineCount - 1, 0));
}
