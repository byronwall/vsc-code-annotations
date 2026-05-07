import * as vscode from "vscode";

import { AnnotationTreeItem, AnnotationTreeProvider } from "./annotations";
import { AnnotationCodeLensProvider } from "./annotationCodeLens";
import {
  addAnnotation,
  FILE_ANNOTATION_SUMMARY_COMMAND,
  fixAnnotationLocation,
  openAnnotationsDocument,
  openFileAnnotations,
} from "./annotationCommands";
import { openSourceLocation } from "./annotationNavigation";
import { resolveActiveWorkspaceFolder } from "./annotationWorkspace";

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
      openAnnotationsDocument,
    ),
    vscode.commands.registerCommand("codeAnnotations.refresh", () => {
      treeProvider.refresh();
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
        await fixAnnotationLocation(treeProvider, target);
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
