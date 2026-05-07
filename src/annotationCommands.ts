import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationTreeItem,
  AnnotationTreeProvider,
  appendAnnotation,
  canFixAnnotationLocation,
  ensureAnnotationsDocument,
  formatAnnotationLocation,
  updateAnnotationCodeRef,
} from "./annotations";
import { summarizeAnnotationForUi } from "./annotations/presentation";
import {
  buildSelectionDraft,
  pickAnnotationType,
  promptForComment,
} from "./annotationSelection";
import { openSourceLocation } from "./annotationNavigation";
import {
  loadResolvedAnnotationsForDocument,
  resolveActiveWorkspaceFolder,
} from "./annotationWorkspace";

export const FILE_ANNOTATION_SUMMARY_COMMAND =
  "codeAnnotations.openFileAnnotations";

export async function addAnnotation(
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

export async function openAnnotationsDocument(): Promise<void> {
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

export async function fixAnnotationLocation(
  treeProvider: AnnotationTreeProvider,
  target: AnnotationTreeItem | AnnotationEntry,
): Promise<void> {
  const workspaceFolder = resolveActiveWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const entry = target instanceof AnnotationTreeItem ? target.entry : target;
  const resolution =
    target instanceof AnnotationTreeItem
      ? target.resolution
      : await loadResolution(workspaceFolder, entry);

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
    fileAnnotations.map(({ entry, resolution }) => ({
      label: summarizeAnnotationForUi(entry),
      description:
        resolution.status === "current"
          ? formatAnnotationLocation(entry)
          : `${formatAnnotationLocation(entry)} -> ${formatAnnotationLocation(
              resolution,
            )}`,
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

async function loadResolution(
  workspaceFolder: vscode.WorkspaceFolder,
  entry: AnnotationEntry,
) {
  const matches = await loadResolvedAnnotationsForDocument(
    workspaceFolder,
    vscode.Uri.joinPath(workspaceFolder.uri, ...entry.relativePath.split("/")),
  );
  return (
    matches.find((match) => match.entry.addedAt === entry.addedAt)
      ?.resolution ?? targetFallbackResolution(entry)
  );
}

function targetFallbackResolution(entry: AnnotationEntry) {
  return {
    ...entry,
    status: "missing" as const,
    score: 0,
  };
}
