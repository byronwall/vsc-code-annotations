import * as path from "node:path";
import * as vscode from "vscode";

const DEFAULT_DOCUMENT_PATH = "code-annotations.md";
const DOCUMENT_HEADER = [
  "# Code Annotations",
  "",
  "This file stores code selections, annotation types, and comments for later AI-assisted implementation work.",
  "",
].join("\n");

const ANNOTATION_TYPES = [
  {
    value: "follow-up",
    label: "Follow-up",
    description: "Record a concrete change or next step.",
    icon: "arrow-right",
  },
  {
    value: "issue",
    label: "Issue",
    description: "Capture a bug, defect, or broken assumption.",
    icon: "warning",
  },
  {
    value: "question",
    label: "Question",
    description: "Mark code that needs clarification before editing.",
    icon: "question",
  },
  {
    value: "idea",
    label: "Idea",
    description: "Save a design option or improvement idea.",
    icon: "lightbulb",
  },
  {
    value: "context",
    label: "Context",
    description: "Preserve surrounding rationale for later AI work.",
    icon: "note",
  },
] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number]["value"];

export interface AnnotationDraft {
  relativePath: string;
  startLine: number;
  endLine: number;
  code: string;
  language?: string;
  type: AnnotationType;
  comment: string;
}

export interface AnnotationEntry extends AnnotationDraft {
  addedAt: string;
}

export interface AnnotationTypeOption {
  label: string;
  description: string;
  value: AnnotationType;
}

export class AnnotationTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined
  >();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly resolveWorkspaceFolder: () =>
      | vscode.WorkspaceFolder
      | undefined,
  ) {}

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: vscode.TreeItem,
  ): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const workspaceFolder = this.resolveWorkspaceFolder();
    if (!workspaceFolder) {
      return [
        new MessageTreeItem("Open a workspace folder to store annotations."),
      ];
    }

    const documentPath = getConfiguredDocumentPath();
    const entries = await loadAnnotations(workspaceFolder);
    if (entries.length === 0) {
      return [
        new MessageTreeItem(`No annotations found in ${documentPath} yet.`),
      ];
    }

    return entries.map((entry) => new AnnotationTreeItem(entry));
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

export function getAnnotationTypeOptions(): AnnotationTypeOption[] {
  return ANNOTATION_TYPES.map(({ value, label, description }) => ({
    value,
    label,
    description,
  }));
}

export function getAnnotationsDocumentPath(): string {
  return getConfiguredDocumentPath();
}

export function getAnnotationsDocumentUri(
  workspaceFolder: vscode.WorkspaceFolder,
): vscode.Uri {
  const relativePath = getConfiguredDocumentPath();
  return vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split("/"));
}

export async function ensureAnnotationsDocument(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<vscode.Uri> {
  const documentUri = getAnnotationsDocumentUri(workspaceFolder);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(path.dirname(documentUri.fsPath)),
  );

  const existing = await readTextFile(documentUri);
  if (existing !== undefined) {
    return documentUri;
  }

  await writeTextFile(documentUri, DOCUMENT_HEADER);
  return documentUri;
}

export async function appendAnnotation(
  workspaceFolder: vscode.WorkspaceFolder,
  draft: AnnotationDraft,
): Promise<AnnotationEntry> {
  const documentUri = await ensureAnnotationsDocument(workspaceFolder);
  const existing = (await readTextFile(documentUri)) ?? DOCUMENT_HEADER;
  const entry: AnnotationEntry = {
    ...draft,
    addedAt: new Date().toISOString(),
  };

  const separator = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const nextContents = `${existing}${separator}${formatAnnotationEntry(entry)}`;
  await writeTextFile(
    documentUri,
    nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`,
  );
  return entry;
}

export async function loadAnnotations(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<AnnotationEntry[]> {
  const documentUri = getAnnotationsDocumentUri(workspaceFolder);
  const contents = await readTextFile(documentUri);
  if (!contents) {
    return [];
  }

  return parseAnnotationsDocument(contents);
}

export function isAnnotationsDocument(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return getAnnotationsDocumentUri(workspaceFolder).fsPath === uri.fsPath;
}

export function formatAnnotationLocation(entry: {
  relativePath: string;
  startLine: number;
  endLine: number;
}): string {
  return `${entry.relativePath}:${formatLineRange(entry.startLine, entry.endLine)}`;
}

function getConfiguredDocumentPath(): string {
  const configured = vscode.workspace
    .getConfiguration("codeAnnotations")
    .get<string>("documentPath", DEFAULT_DOCUMENT_PATH);
  const normalized = path.posix
    .normalize((configured ?? DEFAULT_DOCUMENT_PATH).trim().replace(/\\/g, "/"))
    .replace(/^\.\//, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return DEFAULT_DOCUMENT_PATH;
  }

  return normalized;
}

function formatAnnotationEntry(entry: AnnotationEntry): string {
  const fence = selectFence(entry.code);
  const fenceLine = entry.language?.trim()
    ? `${fence}${entry.language.trim()}`
    : fence;

  return [
    `## [${entry.type}] ${formatAnnotationLocation(entry)}`,
    `- File: ${entry.relativePath}`,
    `- Lines: ${formatLineRange(entry.startLine, entry.endLine)}`,
    `- Type: ${entry.type}`,
    `- Comment: ${entry.comment}`,
    `- Added: ${entry.addedAt}`,
    "",
    fenceLine,
    entry.code,
    fence,
    "",
  ].join("\n");
}

function parseAnnotationsDocument(contents: string): AnnotationEntry[] {
  const sections = contents
    .split(/\n(?=## \[)/g)
    .filter((section) => section.startsWith("## ["));

  const entries = sections
    .map((section) => parseAnnotationSection(section))
    .filter((entry): entry is AnnotationEntry => entry !== undefined);

  return entries.sort((left, right) => {
    const leftTime = Date.parse(left.addedAt);
    const rightTime = Date.parse(right.addedAt);
    return (
      (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0)
    );
  });
}

function parseAnnotationSection(section: string): AnnotationEntry | undefined {
  const lines = section.split(/\r?\n/);
  const heading = lines[0]?.match(/^## \[([^\]]+)\] (.+):(\d+)(?:-(\d+))?$/);
  if (!heading) {
    return undefined;
  }

  const metadata = new Map<string, string>();
  let lineIndex = 1;
  for (; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) {
      lineIndex += 1;
      break;
    }

    const metadataLine = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!metadataLine) {
      return undefined;
    }

    metadata.set(metadataLine[1].trim().toLowerCase(), metadataLine[2].trim());
  }

  const opener = lines[lineIndex]?.match(/^(`{3,}|~{3,})([^\s`]*)\s*$/);
  if (!opener) {
    return undefined;
  }

  const closingPattern = new RegExp(`^${escapeForRegExp(opener[1])}\\s*$`);
  const codeLines: string[] = [];
  lineIndex += 1;
  for (; lineIndex < lines.length; lineIndex += 1) {
    if (closingPattern.test(lines[lineIndex])) {
      break;
    }
    codeLines.push(lines[lineIndex]);
  }

  const type = normalizeAnnotationType(metadata.get("type") ?? heading[1]);
  if (!type) {
    return undefined;
  }

  const relativePath = metadata.get("file") ?? heading[2];
  const range = parseLineRange(metadata.get("lines"));
  const startLine = range?.startLine ?? Number.parseInt(heading[3], 10);
  const endLine =
    range?.endLine ?? Number.parseInt(heading[4] ?? heading[3], 10);
  const comment = metadata.get("comment") ?? "";
  const addedAt = metadata.get("added") ?? "";

  return {
    relativePath,
    startLine,
    endLine,
    type,
    comment,
    addedAt,
    code: codeLines.join("\n"),
    language: opener[2]?.trim() || undefined,
  };
}

function normalizeAnnotationType(value: string): AnnotationType | undefined {
  const normalized = value.trim().toLowerCase();
  return ANNOTATION_TYPES.find((option) => option.value === normalized)?.value;
}

function parseLineRange(
  value: string | undefined,
): { startLine: number; endLine: number } | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return undefined;
  }

  return {
    startLine: Number.parseInt(match[1], 10),
    endLine: Number.parseInt(match[2] ?? match[1], 10),
  };
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function selectFence(code: string): string {
  return code.includes("```") ? "````" : "```";
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readTextFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const contents = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(contents).toString("utf8");
  } catch {
    return undefined;
  }
}

async function writeTextFile(uri: vscode.Uri, contents: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
}

class AnnotationTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: AnnotationEntry) {
    super(entry.comment, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "annotationEntry";
    this.description = formatAnnotationLocation(entry);
    this.iconPath = new vscode.ThemeIcon(resolveTypeIcon(entry.type));
    this.command = {
      command: "codeAnnotations.openSourceLocation",
      title: "Open Source Location",
      arguments: [entry],
    };
    this.tooltip = buildTooltip(entry);
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "annotationMessage";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

function resolveTypeIcon(type: AnnotationType): string {
  return (
    ANNOTATION_TYPES.find((option) => option.value === type)?.icon ?? "note"
  );
}

function buildTooltip(entry: AnnotationEntry): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${escapeMarkdown(entry.comment)}**\n\n`);
  tooltip.appendMarkdown(`- Type: ${escapeMarkdown(entry.type)}\n`);
  tooltip.appendMarkdown(
    `- Location: ${escapeMarkdown(formatAnnotationLocation(entry))}\n`,
  );
  tooltip.appendMarkdown(`- Added: ${escapeMarkdown(entry.addedAt)}\n\n`);
  tooltip.appendCodeblock(entry.code, entry.language);
  return tooltip;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
}
