import * as vscode from "vscode";

import {
  AnnotationListTreeItem,
  AnnotationTreeItem,
  AnnotationTreeProvider,
} from "./annotations";
import { AnnotationCodeLensProvider } from "./annotationCodeLens";
import {
  addAnnotation,
  createNewAnnotationList,
  FILE_ANNOTATION_SUMMARY_COMMAND,
  fixAnnotationLocation,
  openAnnotationDocumentLocation,
  openAnnotationsDocument,
  openFileAnnotations,
  removeAnnotation,
  setActiveAnnotationList,
} from "./annotationCommands";
import { AnnotationListState } from "./annotationListState";
import { openSourceLocation } from "./annotationNavigation";
import { resolveActiveWorkspaceFolder } from "./annotationWorkspace";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const listState = new AnnotationListState(context.workspaceState);
  const treeProvider = new AnnotationTreeProvider(
    resolveActiveWorkspaceFolder,
    listState,
  );
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
        await addAnnotation(listState, () =>
          refreshProviders(treeProvider, codeLensProvider),
        );
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
      async (target?: AnnotationListTreeItem | AnnotationTreeItem) => {
        await openAnnotationsDocument(listState, target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.createAnnotationList",
      async () => {
        await createNewAnnotationList(listState, () =>
          refreshProviders(treeProvider, codeLensProvider),
        );
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.setActiveAnnotationList",
      async (target?: AnnotationListTreeItem) => {
        await setActiveAnnotationList(
          listState,
          () => refreshProviders(treeProvider, codeLensProvider),
          target,
        );
      },
    ),
    vscode.commands.registerCommand("codeAnnotations.refresh", () => {
      refreshProviders(treeProvider, codeLensProvider);
    }),
    vscode.commands.registerCommand(
      "codeAnnotations.openSourceLocation",
      async (target: AnnotationTreeItem) => {
        await openSourceLocation(target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.fixAnnotationLocation",
      async (target: AnnotationTreeItem) => {
        await fixAnnotationLocation(
          () => refreshProviders(treeProvider, codeLensProvider),
          target,
        );
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.openAnnotationDocumentLocation",
      async (target: AnnotationTreeItem) => {
        await openAnnotationDocumentLocation(target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.deleteAnnotation",
      async (target: AnnotationTreeItem) => {
        await removeAnnotation(
          () => refreshProviders(treeProvider, codeLensProvider),
          target,
        );
      },
    ),
    vscode.commands.registerCommand(
      FILE_ANNOTATION_SUMMARY_COMMAND,
      openFileAnnotations,
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (
        document.uri.scheme === "file" &&
        resolveActiveWorkspaceFolder(document.uri)
      ) {
        refreshProviders(treeProvider, codeLensProvider);
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      if (event.files.some((file) => resolveActiveWorkspaceFolder(file))) {
        refreshProviders(treeProvider, codeLensProvider);
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
        refreshProviders(treeProvider, codeLensProvider);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      codeLensProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codeAnnotations.documentPath")) {
        refreshProviders(treeProvider, codeLensProvider);
      }
    }),
  );
}

function refreshProviders(
  treeProvider: AnnotationTreeProvider,
  codeLensProvider: AnnotationCodeLensProvider,
): void {
  treeProvider.refresh();
  codeLensProvider.refresh();
}
