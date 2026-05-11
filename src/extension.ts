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
import { AnnotationHoverProvider } from "./annotationHover";
import { AnnotationListState } from "./annotationListState";
import { openSourceLocation } from "./annotationNavigation";
import { registerAnnotationTools } from "./annotationTools";
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
  const hoverProvider = new AnnotationHoverProvider(
    resolveActiveWorkspaceFolder,
  );
  const refreshAnnotations = () =>
    refreshProviders(treeProvider, codeLensProvider);
  const treeView = vscode.window.createTreeView("codeAnnotations.annotations", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  registerAnnotationTools(context, listState, refreshAnnotations);

  context.subscriptions.push(
    treeProvider,
    codeLensProvider,
    treeView,
    vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }],
      codeLensProvider,
    ),
    vscode.languages.registerHoverProvider([{ scheme: "file" }], hoverProvider),
    vscode.commands.registerCommand(
      "codeAnnotations.addAnnotation",
      async () => {
        await addAnnotation(listState, refreshAnnotations);
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
        await createNewAnnotationList(listState, refreshAnnotations);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.setActiveAnnotationList",
      async (target?: AnnotationListTreeItem) => {
        await setActiveAnnotationList(listState, refreshAnnotations, target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.refresh",
      refreshAnnotations,
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.expandAnnotationsTree",
      async () => {
        await treeProvider.expandAll();
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.collapseAnnotationsTree",
      async () => {
        await treeProvider.collapseAll();
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.toggleSidebarGroupingMode",
      async () => {
        await toggleSidebarGroupingMode();
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.openSourceLocation",
      async (target: AnnotationTreeItem) => {
        await openSourceLocation(target);
      },
    ),
    vscode.commands.registerCommand(
      "codeAnnotations.fixAnnotationLocation",
      async (target: AnnotationTreeItem) => {
        await fixAnnotationLocation(refreshAnnotations, target);
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
        await removeAnnotation(refreshAnnotations, target);
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
      treeProvider.refresh();
      codeLensProvider.refresh();
    }),
    treeView.onDidExpandElement(({ element }) => {
      treeProvider.trackElementExpansion(element, true);
    }),
    treeView.onDidCollapseElement(({ element }) => {
      treeProvider.trackElementExpansion(element, false);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("codeAnnotations.documentPath") ||
        event.affectsConfiguration("codeAnnotations.sidebarGroupingMode")
      ) {
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

async function toggleSidebarGroupingMode(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("codeAnnotations");
  const currentMode = configuration.get<"flat" | "file">(
    "sidebarGroupingMode",
    "flat",
  );
  const nextMode = currentMode === "file" ? "flat" : "file";

  await configuration.update(
    "sidebarGroupingMode",
    nextMode,
    vscode.ConfigurationTarget.Global,
  );

  vscode.window.setStatusBarMessage(
    nextMode === "file"
      ? "Annotations sidebar grouping: file tree"
      : "Annotations sidebar grouping: flat list",
    2500,
  );
}
