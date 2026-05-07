import * as path from "node:path";
import * as vscode from "vscode";
import {
  AnnotationDraft,
  AnnotationEntry,
  AnnotationLocationResolution,
  AnnotationTreeItem,
  AnnotationTreeProvider,
  AnnotationType,
  appendAnnotation,
  canFixAnnotationLocation,
  ensureAnnotationsDocument,
  formatAnnotationLocation,
  getAnnotationTypeOptions,
  isAnnotationsDocument,
  loadAnnotations,
  resolveAnnotationLocation,
  updateAnnotationCodeRef,
} from "./annotations";

const FILE_ANNOTATION_SUMMARY_COMMAND = "codeAnnotations.openFileAnnotations";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const treeProvider = new AnnotationTreeProvider(resolveActiveWorkspaceFolder);
  const codeLensProvider = new AnnotationCodeLensProvider(
    resolveActiveWorkspaceFolder,
  );
  const treeView = vscode.window.createTreeView("codeAnnotations.annotations", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeProvider,
    codeLensProvider,
    treeView,
    vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }],
      codeLensProvider,
    ),
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
      async (target: AnnotationTreeItem | AnnotationEntry) => {
        await openSourceLocation(target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.fixAnnotationLocation",
      async (target: AnnotationTreeItem | AnnotationEntry) => {
        await fixAnnotationLocation(treeProvider, target);
      },
    ),
    vscode.commands.registerCommand(
      FILE_ANNOTATION_SUMMARY_COMMAND,
      async (documentUri: vscode.Uri) => {
        await openFileAnnotations(documentUri);
      },
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (
        document.uri.scheme === "file" &&
        resolveActiveWorkspaceFolder(document.uri)
      ) {
        treeProvider.refresh();
        codeLensProvider.refresh();
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      if (event.files.some((file) => resolveActiveWorkspaceFolder(file))) {
        treeProvider.refresh();
        codeLensProvider.refresh();
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      if (
        event.files.some(
          ({ oldUri, newUri }) =>
            resolveActiveWorkspaceFolder(oldUri) ||
            resolveActiveWorkspaceFolder(newUri),
        )
      ) {
        treeProvider.refresh();
        codeLensProvider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      codeLensProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codeAnnotations.documentPath")) {
        treeProvider.refresh();
        codeLensProvider.refresh();
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

async function openSourceLocation(
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

async function fixAnnotationLocation(
  treeProvider: AnnotationTreeProvider,
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
  if (!canFixAnnotationLocation(resolution)) {
    if (resolution.status === "current") {
      vscode.window.showInformationMessage(
        "This annotation already points at the current source location.",
      );
      return;
    }

    vscode.window.showWarningMessage(
      "Unable to find a reliable current source location for this annotation.",
    );
    return;
  }

  const updatedEntry = await updateAnnotationCodeRef(
    workspaceFolder,
    entry,
    resolution,
  );
  if (!updatedEntry) {
    vscode.window.showWarningMessage(
      "Unable to update the annotation in the annotations document.",
    );
    return;
  }

  treeProvider.refresh();
  vscode.window.setStatusBarMessage(
    `Updated annotation to ${formatAnnotationLocation(updatedEntry)}`,
    3000,
  );
}

async function openFileAnnotations(documentUri: vscode.Uri): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder(documentUri);
  if (!workspaceFolder) {
    return;
  }

  const fileAnnotations = await loadResolvedAnnotationsForDocument(
    workspaceFolder,
    documentUri,
  );
  if (fileAnnotations.length === 0) {
    return;
  }

  if (fileAnnotations.length === 1) {
    await openSourceLocation(fileAnnotations[0].entry);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    fileAnnotations.map(({ entry, resolution }) => ({
      label: summarizeAnnotationForUi(entry),
      description:
        resolution.status === "current"
          ? formatAnnotationLocation(entry)
          : `${formatAnnotationLocation(entry)} -> ${formatAnnotationLocation(
              resolution,
            )}`,
      detail:
        resolution.status === "missing"
          ? "Current match not found"
          : resolution.status === "relocated"
            ? "Jumps to the best current match"
            : "Jumps to the saved location",
      annotation: entry,
    })),
    {
      title: "File annotations",
      placeHolder: "Choose an annotation to jump to",
      ignoreFocusOut: true,
    },
  );

  if (picked?.annotation) {
    await openSourceLocation(picked.annotation);
  }
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
    placeHolder:
      "Add a short note now; you can expand it with full markdown in the annotations document",
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

class AnnotationCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly onDidChangeCodeLensesEmitter =
    new vscode.EventEmitter<void>();

  public readonly onDidChangeCodeLenses =
    this.onDidChangeCodeLensesEmitter.event;

  constructor(
    private readonly resolveWorkspaceFolder: (
      uri?: vscode.Uri,
    ) => vscode.WorkspaceFolder | undefined,
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

async function loadResolvedAnnotationsForDocument(
  workspaceFolder: vscode.WorkspaceFolder,
  documentUri: vscode.Uri,
): Promise<
  Array<{
    entry: AnnotationEntry;
    resolution: AnnotationLocationResolution;
  }>
> {
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

function buildFileSummaryTitle(count: number): string {
  return count === 1
    ? "1 annotation in this file"
    : `${count} annotations in this file`;
}

function buildAnnotationLensTitle(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  const prefix =
    resolution.status === "relocated"
      ? "Annotation moved: "
      : resolution.status === "missing"
        ? "Annotation missing: "
        : "Annotation: ";
  return `${prefix}${summarizeAnnotationForUi(entry)}`;
}

function buildAnnotationLensTooltip(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  if (resolution.status === "current") {
    return `Jump to ${formatAnnotationLocation(entry)}`;
  }

  if (resolution.status === "relocated") {
    return `Jump to ${formatAnnotationLocation(resolution)}`;
  }

  return `Open ${formatAnnotationLocation(entry)} for review`;
}

function summarizeAnnotationForUi(entry: AnnotationEntry): string {
  const firstLine = entry.comment
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  const normalized = (firstLine ?? entry.type)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/, "")
    .replace(/[`*_~]/g, "")
    .trim();

  return truncateForUi(normalized || entry.type, 80);
}
