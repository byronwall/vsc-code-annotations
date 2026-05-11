import * as path from "node:path";
import * as vscode from "vscode";

import { AnnotationListState } from "../annotationListState";
import {
  AnnotationEntry,
  AnnotationLocationResolution,
  resolveTypeIcon,
} from "./model";
import { AnnotationList, loadAnnotationLists } from "./lists";
import {
  buildGroupedTreeItemDescription,
  buildTooltip,
  buildTreeItemDescription,
  resolveTreeItemContextValue,
  summarizeComment,
} from "./presentation";
import { resolveAnnotationLocation } from "./resolution";
import { getAnnotationsDocumentPath, loadAnnotations } from "./storage";
import { toPosix } from "./utils";

type AnnotationSidebarGroupingMode = "flat" | "file";
type AnnotationExpansionPreset = "default" | "all" | "collapse-preserve-active";

interface ResolvedListAnnotation {
  entry: AnnotationEntry;
  resolution: AnnotationLocationResolution;
}

interface AnnotationPathTreeNode {
  label: string;
  relativePath: string;
  directories: Map<string, AnnotationPathTreeNode>;
  files: Array<{
    relativePath: string;
    annotations: ResolvedListAnnotation[];
  }>;
}

interface ExpandableAnnotationTreeItem extends vscode.TreeItem {
  readonly nodeId: string;
}

interface CollapsibleStateOptions {
  preserveOnCollapseAll?: boolean;
}

export class AnnotationTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined
  >();
  private readonly expansionState = new Map<string, boolean>();
  private expansionPreset: AnnotationExpansionPreset = "default";

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly resolveWorkspaceFolder: () =>
      | vscode.WorkspaceFolder
      | undefined,
    private readonly listState: AnnotationListState,
  ) {}

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public trackElementExpansion(
    element: vscode.TreeItem,
    expanded: boolean,
  ): void {
    if (!isExpandableTreeItem(element)) {
      return;
    }

    this.expansionState.set(element.nodeId, expanded);
  }

  public async expandAll(): Promise<void> {
    this.expansionState.clear();
    this.expansionPreset = "all";
    this.refresh();
  }

  public async collapseAll(): Promise<void> {
    this.expansionState.clear();
    this.expansionPreset = "collapse-preserve-active";
    this.refresh();
  }

  public async getChildren(
    element?: vscode.TreeItem,
  ): Promise<vscode.TreeItem[]> {
    if (element instanceof AnnotationListTreeItem) {
      return this.getListChildren(element);
    }

    if (element instanceof AnnotationContainerTreeItem) {
      return element.children;
    }

    if (element) {
      return [];
    }

    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [
        new MessageTreeItem("Open a workspace folder to store annotations."),
      ];
    }

    const activeList = await this.listState.resolveActiveList(workspaceFolder);
    const lists = await loadAnnotationLists(workspaceFolder);
    const listsWithActiveFile =
      getSidebarGroupingMode() === "file"
        ? await resolveListsWithActiveFile(workspaceFolder, lists)
        : new Set<string>();

    return lists.map(
      (list) =>
        new AnnotationListTreeItem(
          list,
          list.relativePath === activeList.relativePath,
          this.resolveCollapsibleState(
            getListNodeId(list),
            list.relativePath === activeList.relativePath,
            {
              preserveOnCollapseAll: listsWithActiveFile.has(list.relativePath),
            },
          ),
        ),
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private resolveCollapsibleState(
    nodeId: string,
    defaultExpanded: boolean,
    options?: CollapsibleStateOptions,
  ): vscode.TreeItemCollapsibleState {
    const explicitState = this.expansionState.get(nodeId);
    const expanded =
      explicitState ?? this.resolvePresetExpansion(options) ?? defaultExpanded;

    return expanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  private resolvePresetExpansion(
    options?: CollapsibleStateOptions,
  ): boolean | undefined {
    if (this.expansionPreset === "all") {
      return true;
    }

    if (this.expansionPreset === "collapse-preserve-active") {
      return options?.preserveOnCollapseAll === true;
    }

    return undefined;
  }

  private async getListChildren(
    element: AnnotationListTreeItem,
  ): Promise<vscode.TreeItem[]> {
    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [];
    }

    const entries = await loadAnnotations(
      workspaceFolder,
      element.list.documentUri,
    );
    if (entries.length === 0) {
      const documentPath = element.list.isDefault
        ? getAnnotationsDocumentPath()
        : element.list.relativePath;
      return [
        new MessageTreeItem(`No annotations found in ${documentPath} yet.`),
      ];
    }

    const resolvedEntries = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        resolution: await resolveAnnotationLocation(workspaceFolder, entry),
      })),
    );

    if (getSidebarGroupingMode() === "file") {
      return buildFileGroupedChildren(
        workspaceFolder,
        element.list,
        resolvedEntries,
        this.resolveCollapsibleState.bind(this),
      );
    }

    return resolvedEntries.map(
      ({ entry, resolution }) =>
        new AnnotationTreeItem(element.list, entry, resolution),
    );
  }
}

export class AnnotationListTreeItem extends vscode.TreeItem {
  constructor(
    public readonly list: AnnotationList,
    public readonly isActive: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(list.name, collapsibleState);
    this.id = getListNodeId(list);
    this.contextValue = isActive
      ? "annotationListActive"
      : "annotationListInactive";
    this.description = isActive ? "Active" : undefined;
    this.iconPath = new vscode.ThemeIcon(isActive ? "star-full" : "list-tree");
    this.tooltip = `${list.name}\n${list.relativePath}`;
  }
}

export class AnnotationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly list: AnnotationList,
    public readonly entry: AnnotationEntry,
    public readonly resolution: AnnotationLocationResolution,
    options?: {
      groupedByFile?: boolean;
    },
  ) {
    super(summarizeComment(entry), vscode.TreeItemCollapsibleState.None);
    this.contextValue = resolveTreeItemContextValue(resolution.status);
    this.description = options?.groupedByFile
      ? buildGroupedTreeItemDescription(entry, resolution)
      : buildTreeItemDescription(entry, resolution);
    this.iconPath = new vscode.ThemeIcon(resolveTypeIcon(entry.type));
    this.command = {
      command: "codeAnnotations.openSourceLocation",
      title: "Open Source Location",
      arguments: [this],
    };
    this.tooltip = buildTooltip(entry, resolution);
  }
}

abstract class AnnotationContainerTreeItem extends vscode.TreeItem {
  public readonly nodeId: string;

  constructor(
    label: string | vscode.Uri,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: vscode.TreeItem[],
    nodeId: string,
  ) {
    super(label as unknown as vscode.Uri, collapsibleState);
    this.nodeId = nodeId;
    this.id = nodeId;
  }
}

class AnnotationActiveFileTreeItem extends AnnotationContainerTreeItem {
  constructor(
    list: AnnotationList,
    relativePath: string,
    fileItem: AnnotationFileTreeItem,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(
      "Active file",
      collapsibleState,
      [fileItem],
      getActiveFileSectionNodeId(list),
    );
    this.contextValue = "annotationActiveFile";
    this.description = relativePath;
    this.iconPath = new vscode.ThemeIcon("target");
    this.tooltip = `Annotations for ${relativePath}`;
  }
}

class AnnotationFolderTreeItem extends AnnotationContainerTreeItem {
  constructor(
    workspaceFolder: vscode.WorkspaceFolder,
    list: AnnotationList,
    label: string,
    relativePath: string,
    children: vscode.TreeItem[],
    annotationCount: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(
      vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split("/")),
      collapsibleState,
      children,
      getFolderNodeId(list, relativePath),
    );
    this.label = label;
    this.contextValue = "annotationFolderGroup";
    this.description = annotationCountLabel(annotationCount);
    this.tooltip = relativePath;
  }
}

class AnnotationFileTreeItem extends AnnotationContainerTreeItem {
  constructor(
    workspaceFolder: vscode.WorkspaceFolder,
    list: AnnotationList,
    relativePath: string,
    children: AnnotationTreeItem[],
    branch: "tree" | "active",
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(
      vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split("/")),
      collapsibleState,
      children,
      getFileNodeId(list, relativePath, branch),
    );
    this.contextValue = "annotationFileGroup";
    this.description = annotationCountLabel(children.length);
    this.tooltip = relativePath;
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "annotationMessage";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

function getSidebarGroupingMode(): AnnotationSidebarGroupingMode {
  const configured = vscode.workspace
    .getConfiguration("codeAnnotations")
    .get<string>("sidebarGroupingMode", "flat");

  return configured === "file" ? "file" : "flat";
}

function buildFileGroupedChildren(
  workspaceFolder: vscode.WorkspaceFolder,
  list: AnnotationList,
  resolvedEntries: ResolvedListAnnotation[],
  resolveCollapsibleState: (
    nodeId: string,
    defaultExpanded: boolean,
    options?: CollapsibleStateOptions,
  ) => vscode.TreeItemCollapsibleState,
): vscode.TreeItem[] {
  const groupedEntries = groupResolvedEntriesByFile(resolvedEntries);
  const children = buildPathTreeItems(
    workspaceFolder,
    list,
    groupedEntries,
    resolveCollapsibleState,
  );
  const activeRelativePath = resolveActiveDocumentRelativePath(workspaceFolder);
  const activeFileEntries = activeRelativePath
    ? groupedEntries.get(activeRelativePath)
    : undefined;

  if (!activeRelativePath || !activeFileEntries) {
    return children;
  }

  return [
    new AnnotationActiveFileTreeItem(
      list,
      activeRelativePath,
      buildFileTreeItem(
        workspaceFolder,
        list,
        activeRelativePath,
        activeFileEntries,
        "active",
        resolveCollapsibleState,
        true,
        true,
      ),
      resolveCollapsibleState(getActiveFileSectionNodeId(list), true, {
        preserveOnCollapseAll: true,
      }),
    ),
    ...children,
  ];
}

function buildPathTreeItems(
  workspaceFolder: vscode.WorkspaceFolder,
  list: AnnotationList,
  groupedEntries: Map<string, ResolvedListAnnotation[]>,
  resolveCollapsibleState: (
    nodeId: string,
    defaultExpanded: boolean,
    options?: CollapsibleStateOptions,
  ) => vscode.TreeItemCollapsibleState,
): vscode.TreeItem[] {
  const root: AnnotationPathTreeNode = {
    label: "",
    relativePath: "",
    directories: new Map(),
    files: [],
  };

  for (const [relativePath, annotations] of groupedEntries) {
    addGroupedFile(root, relativePath, annotations);
  }

  return createPathTreeItems(
    workspaceFolder,
    list,
    root,
    resolveCollapsibleState,
  );
}

function addGroupedFile(
  root: AnnotationPathTreeNode,
  relativePath: string,
  annotations: ResolvedListAnnotation[],
): void {
  const segments = relativePath.split("/").filter((segment) => segment.length);
  const fileName = segments.pop();
  if (!fileName) {
    return;
  }

  let current = root;
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const next = current.directories.get(segment);
    if (next) {
      current = next;
      continue;
    }

    const created: AnnotationPathTreeNode = {
      label: segment,
      relativePath: currentPath,
      directories: new Map(),
      files: [],
    };
    current.directories.set(segment, created);
    current = created;
  }

  current.files.push({
    relativePath,
    annotations: sortResolvedEntries(annotations),
  });
}

function createPathTreeItems(
  workspaceFolder: vscode.WorkspaceFolder,
  list: AnnotationList,
  node: AnnotationPathTreeNode,
  resolveCollapsibleState: (
    nodeId: string,
    defaultExpanded: boolean,
    options?: CollapsibleStateOptions,
  ) => vscode.TreeItemCollapsibleState,
): vscode.TreeItem[] {
  const folderItems = [...node.directories.values()]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((childNode) => {
      const children = createPathTreeItems(
        workspaceFolder,
        list,
        childNode,
        resolveCollapsibleState,
      );
      return new AnnotationFolderTreeItem(
        workspaceFolder,
        list,
        childNode.label,
        childNode.relativePath,
        children,
        countAnnotations(childNode),
        resolveCollapsibleState(
          getFolderNodeId(list, childNode.relativePath),
          false,
        ),
      );
    });

  const fileItems = [...node.files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(({ relativePath, annotations }) =>
      buildFileTreeItem(
        workspaceFolder,
        list,
        relativePath,
        annotations,
        "tree",
        resolveCollapsibleState,
      ),
    );

  return [...folderItems, ...fileItems];
}

function buildFileTreeItem(
  workspaceFolder: vscode.WorkspaceFolder,
  list: AnnotationList,
  relativePath: string,
  annotations: ResolvedListAnnotation[],
  branch: "tree" | "active",
  resolveCollapsibleState: (
    nodeId: string,
    defaultExpanded: boolean,
    options?: CollapsibleStateOptions,
  ) => vscode.TreeItemCollapsibleState,
  defaultExpanded = false,
  preserveOnCollapseAll = false,
): AnnotationFileTreeItem {
  return new AnnotationFileTreeItem(
    workspaceFolder,
    list,
    relativePath,
    annotations.map(
      ({ entry, resolution }) =>
        new AnnotationTreeItem(list, entry, resolution, {
          groupedByFile: true,
        }),
    ),
    branch,
    resolveCollapsibleState(
      getFileNodeId(list, relativePath, branch),
      defaultExpanded,
      {
        preserveOnCollapseAll,
      },
    ),
  );
}

function groupResolvedEntriesByFile(
  resolvedEntries: ResolvedListAnnotation[],
): Map<string, ResolvedListAnnotation[]> {
  const groupedEntries = new Map<string, ResolvedListAnnotation[]>();

  for (const resolvedEntry of sortResolvedEntries(resolvedEntries)) {
    const existing = groupedEntries.get(resolvedEntry.entry.relativePath) ?? [];
    existing.push(resolvedEntry);
    groupedEntries.set(resolvedEntry.entry.relativePath, existing);
  }

  return groupedEntries;
}

function sortResolvedEntries(
  resolvedEntries: ResolvedListAnnotation[],
): ResolvedListAnnotation[] {
  return [...resolvedEntries].sort((left, right) => {
    const startLineDifference = left.entry.startLine - right.entry.startLine;
    if (startLineDifference !== 0) {
      return startLineDifference;
    }

    return right.entry.addedAt.localeCompare(left.entry.addedAt);
  });
}

function countAnnotations(node: AnnotationPathTreeNode): number {
  const fileCount = node.files.reduce(
    (count, file) => count + file.annotations.length,
    0,
  );
  const nestedCount = [...node.directories.values()].reduce(
    (count, childNode) => count + countAnnotations(childNode),
    0,
  );

  return fileCount + nestedCount;
}

function annotationCountLabel(count: number): string {
  return count === 1 ? "1 annotation" : `${count} annotations`;
}

async function resolveListsWithActiveFile(
  workspaceFolder: vscode.WorkspaceFolder,
  lists: AnnotationList[],
): Promise<Set<string>> {
  const activeRelativePath = resolveActiveDocumentRelativePath(workspaceFolder);
  if (!activeRelativePath) {
    return new Set<string>();
  }

  const listMatches = await Promise.all(
    lists.map(async (list) => ({
      relativePath: list.relativePath,
      hasActiveFile: (
        await loadAnnotations(workspaceFolder, list.documentUri)
      ).some((entry) => entry.relativePath === activeRelativePath),
    })),
  );

  return new Set(
    listMatches
      .filter((list) => list.hasActiveFile)
      .map((list) => list.relativePath),
  );
}

function getListNodeId(list: AnnotationList): string {
  return `list:${list.relativePath}`;
}

function getActiveFileSectionNodeId(list: AnnotationList): string {
  return `active-file:${list.relativePath}`;
}

function getFolderNodeId(list: AnnotationList, relativePath: string): string {
  return `folder:${list.relativePath}:${relativePath}`;
}

function getFileNodeId(
  list: AnnotationList,
  relativePath: string,
  branch: "tree" | "active",
): string {
  return `file:${branch}:${list.relativePath}:${relativePath}`;
}

function isExpandableTreeItem(
  element: vscode.TreeItem,
): element is ExpandableAnnotationTreeItem {
  return "nodeId" in element && typeof element.nodeId === "string";
}

function resolveActiveDocumentRelativePath(
  workspaceFolder: vscode.WorkspaceFolder,
): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (!activeUri || activeUri.scheme !== "file") {
    return undefined;
  }

  const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
  if (activeWorkspaceFolder?.uri.fsPath !== workspaceFolder.uri.fsPath) {
    return undefined;
  }

  return toPosix(path.relative(workspaceFolder.uri.fsPath, activeUri.fsPath));
}
