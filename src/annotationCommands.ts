import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationList,
  AnnotationListTreeItem,
  AnnotationTreeItem,
  appendAnnotation,
  canFixAnnotationLocation,
  createAnnotationList,
  deleteAnnotation,
  ensureAnnotationsDocument,
  findAnnotationSection,
  formatAnnotationLocation,
  loadAnnotationLists,
  updateAnnotationCodeRef,
} from "./annotations";
import { summarizeAnnotationForUi } from "./annotations/presentation";
import { AnnotationListState } from "./annotationListState";
import {
  buildSelectionDraft,
  pickAnnotationType,
  promptForComment,
} from "./annotationSelection";
import { openSourceLocation } from "./annotationNavigation";
import {
  loadResolvedAnnotationsForDocument,
  ResolvedAnnotation,
  resolveActiveWorkspaceFolder,
} from "./annotationWorkspace";

export const FILE_ANNOTATION_SUMMARY_COMMAND =
  "codeAnnotations.openFileAnnotations";

type RefreshAnnotations = () => void;

export async function addAnnotation(
  listState: AnnotationListState,
  refreshAnnotations: RefreshAnnotations,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showWarningMessage(
      "Open a workspace file before adding an annotation.",
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
      "Select some non-whitespace text, or clear the selection to annotate the whole file.",
    );
    return;
  }

  const activeList = await listState.resolveActiveList(workspaceFolder);

  const type = await pickAnnotationType(selectionDraft);
  if (!type) {
    return;
  }

  const comment = await promptForComment(selectionDraft);
  if (!comment) {
    return;
  }

  const entry = await appendAnnotation(
    workspaceFolder,
    {
      ...selectionDraft,
      type,
      comment,
    },
    activeList.documentUri,
  );

  refreshAnnotations();
  vscode.window.setStatusBarMessage(
    `Saved annotation in ${activeList.name} for ${formatAnnotationLocation(entry)}`,
    3000,
  );
}

export async function openAnnotationsDocument(
  listState: AnnotationListState,
  target?: AnnotationListTreeItem | AnnotationTreeItem | AnnotationList,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder(
    resolveListTarget(target)?.documentUri,
  );
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace folder before opening the annotations document.",
    );
    return;
  }

  const targetList =
    resolveListTarget(target) ??
    (await listState.resolveActiveList(workspaceFolder));
  const documentUri = await ensureAnnotationsDocument(
    workspaceFolder,
    targetList.documentUri,
    targetList.isDefault ? undefined : targetList.name,
  );
  const document = await vscode.workspace.openTextDocument(documentUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

export async function fixAnnotationLocation(
  refreshAnnotations: RefreshAnnotations,
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const resolved = await resolveAnnotationTarget(workspaceFolder, target);
  if (!resolved) {
    return;
  }

  const { entry, list, resolution } = resolved;

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
    list.documentUri,
  );
  if (!updatedEntry) {
    vscode.window.showWarningMessage(
      "Unable to update the annotation in the annotations document.",
    );
    return;
  }

  refreshAnnotations();
  vscode.window.setStatusBarMessage(
    `Updated annotation to ${formatAnnotationLocation(updatedEntry)}`,
    3000,
  );
}

export async function createNewAnnotationList(
  listState: AnnotationListState,
  refreshAnnotations: RefreshAnnotations,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace folder before creating an annotation list.",
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    title: "New annotation list",
    prompt: "Create a dedicated markdown file for a new annotation list.",
    placeHolder: "Example: Refactor follow-ups",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length > 0 ? undefined : "List name is required.",
  });
  if (!name) {
    return;
  }

  const list = await createAnnotationList(workspaceFolder, name);
  await listState.setActiveList(workspaceFolder, list);
  refreshAnnotations();
  vscode.window.setStatusBarMessage(
    `Created annotation list ${list.name} and marked it active.`,
    3000,
  );
}

export async function setActiveAnnotationList(
  listState: AnnotationListState,
  refreshAnnotations: RefreshAnnotations,
  target?: AnnotationListTreeItem | AnnotationList,
): Promise<void> {
  const explicitTarget =
    target instanceof AnnotationListTreeItem ? target.list : target;
  const workspaceFolder = resolveActiveWorkspaceFolder(
    explicitTarget?.documentUri,
  );
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace folder before choosing an annotation list.",
    );
    return;
  }

  const list =
    explicitTarget ?? (await pickAnnotationList(workspaceFolder, listState));
  if (!list) {
    return;
  }

  await listState.setActiveList(workspaceFolder, list);
  refreshAnnotations();
  vscode.window.setStatusBarMessage(
    `Marked ${list.name} as the active annotation list.`,
    3000,
  );
}

export async function openAnnotationDocumentLocation(
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder(
    target instanceof AnnotationTreeItem ? target.list.documentUri : undefined,
  );
  if (!workspaceFolder) {
    return;
  }

  const resolved = await resolveAnnotationTarget(workspaceFolder, target);
  if (!resolved) {
    vscode.window.showWarningMessage(
      "Unable to find this annotation inside the annotations document.",
    );
    return;
  }

  const { entry, list } = resolved;

  const section = await findAnnotationSection(
    workspaceFolder,
    entry,
    list.documentUri,
  );
  if (!section) {
    vscode.window.showWarningMessage(
      "Unable to find this annotation inside the annotations document.",
    );
    return;
  }

  await showDocumentAtLine(list.documentUri, section.startLine);
}

export async function removeAnnotation(
  refreshAnnotations: RefreshAnnotations,
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder(
    target instanceof AnnotationTreeItem ? target.list.documentUri : undefined,
  );
  if (!workspaceFolder) {
    return;
  }

  const resolved = await resolveAnnotationTarget(workspaceFolder, target);
  if (!resolved) {
    vscode.window.showWarningMessage(
      "Unable to find this annotation in the annotations document.",
    );
    return;
  }

  const { entry, list } = resolved;

  const confirmed = await vscode.window.showWarningMessage(
    `Delete this annotation from ${list.name}?`,
    { modal: true },
    "Delete",
  );
  if (confirmed !== "Delete") {
    return;
  }

  const deleted = await deleteAnnotation(
    workspaceFolder,
    entry,
    list.documentUri,
  );
  if (!deleted) {
    vscode.window.showWarningMessage(
      "Unable to delete the annotation from the annotations document.",
    );
    return;
  }

  refreshAnnotations();
  vscode.window.setStatusBarMessage("Deleted annotation.", 3000);
}

export async function openFileAnnotations(
  documentUri: vscode.Uri,
): Promise<void> {
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
    fileAnnotations.map(({ entry, list, resolution }) => ({
      label: summarizeAnnotationForUi(entry),
      description: `${list.name} • ${formatAnnotationLocation(entry)}`,
      detail: describeResolution(resolution),
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

function describeResolution(resolution: { status: string }): string {
  if (resolution.status === "missing") {
    return "Current match not found";
  }

  if (resolution.status === "relocated") {
    return "Jumps to the best current match";
  }

  return "Jumps to the saved location";
}

async function resolveAnnotationTarget(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<ResolvedAnnotation | undefined> {
  if (target instanceof AnnotationTreeItem) {
    return {
      entry: target.entry,
      list: target.list,
      resolution: target.resolution,
    };
  }

  const matches = await loadResolvedAnnotationsForDocument(
    workspaceFolder,
    vscode.Uri.joinPath(workspaceFolder.uri, ...target.relativePath.split("/")),
  );
  return matches.find((match) => match.entry.addedAt === target.addedAt);
}

async function pickAnnotationList(
  workspaceFolder: vscode.WorkspaceFolder,
  listState: AnnotationListState,
): Promise<AnnotationList | undefined> {
  const [lists, activeList] = await Promise.all([
    loadAnnotationLists(workspaceFolder),
    listState.resolveActiveList(workspaceFolder),
  ]);
  const picked = await vscode.window.showQuickPick(
    lists.map((list) => ({
      label: list.name,
      description:
        list.relativePath === activeList.relativePath ? "Active" : undefined,
      detail: list.relativePath,
      list,
    })),
    {
      title: "Active annotation list",
      placeHolder: "Choose the list used for new annotations",
      ignoreFocusOut: true,
    },
  );

  return picked?.list;
}

function resolveListTarget(
  target?: AnnotationListTreeItem | AnnotationTreeItem | AnnotationList,
): AnnotationList | undefined {
  if (!target) {
    return undefined;
  }

  if (target instanceof AnnotationTreeItem) {
    return target.list;
  }

  if (target instanceof AnnotationListTreeItem) {
    return target.list;
  }

  return target;
}

async function showDocumentAtLine(
  documentUri: vscode.Uri,
  lineNumber: number,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(documentUri);
  const line = Math.min(
    Math.max(lineNumber - 1, 0),
    Math.max(document.lineCount - 1, 0),
  );
  const selection = new vscode.Range(line, 0, line, 0);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    selection,
  });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}
