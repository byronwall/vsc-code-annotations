import * as path from "node:path";
import * as vscode from "vscode";

import {
  ANNOTATIONS_DIRECTORY,
  ANNOTATIONS_GITIGNORE_ENTRY,
  AnnotationCodeRef,
  AnnotationDraft,
  AnnotationEntry,
  DEFAULT_DOCUMENT_PATH,
} from "./model";
import {
  collectAnnotationSections,
  ParsedAnnotationSection,
  DOCUMENT_HEADER,
  buildAnnotationsDocumentHeader,
  formatAnnotationEntry,
  parseAnnotationsDocument,
} from "./markdown";
import { normalizeCodeForStorage, toPosix, trimBlankLines } from "./utils";

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
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
  listName?: string,
): Promise<vscode.Uri> {
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(path.dirname(documentUri.fsPath)),
  );

  const existing = await readTextFile(documentUri);
  if (existing !== undefined) {
    return documentUri;
  }

  await writeTextFile(
    documentUri,
    listName ? buildAnnotationsDocumentHeader(listName) : DOCUMENT_HEADER,
  );
  return documentUri;
}

export async function appendAnnotation(
  workspaceFolder: vscode.WorkspaceFolder,
  draft: AnnotationDraft,
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
): Promise<AnnotationEntry> {
  const targetDocumentUri = await ensureAnnotationsDocument(
    workspaceFolder,
    documentUri,
  );
  await maybeEnsureAnnotationsDirectoryIgnored(
    workspaceFolder,
    targetDocumentUri,
  );

  const existing = (await readTextFile(targetDocumentUri)) ?? DOCUMENT_HEADER;
  const entry: AnnotationEntry = {
    ...draft,
    comment: trimBlankLines(draft.comment.split(/\r?\n/)).join("\n"),
    addedAt: new Date().toISOString(),
  };

  const separator = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const nextContents = `${existing}${separator}${formatAnnotationEntry(entry)}`;
  await writeTextFile(
    targetDocumentUri,
    nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`,
  );
  return entry;
}

export async function updateAnnotationCodeRef(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationEntry,
  nextCodeRef: AnnotationCodeRef,
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
): Promise<AnnotationEntry | undefined> {
  const targetDocumentUri = await ensureAnnotationsDocument(
    workspaceFolder,
    documentUri,
  );
  await maybeEnsureAnnotationsDirectoryIgnored(
    workspaceFolder,
    targetDocumentUri,
  );

  const contents = await readTextFile(targetDocumentUri);
  if (!contents) {
    return undefined;
  }

  const sections = collectAnnotationSections(contents);
  const section = sections.find(({ entry }) =>
    isSameAnnotationEntry(entry, target),
  );
  if (!section) {
    return undefined;
  }

  const updatedEntry: AnnotationEntry = {
    ...section.entry,
    relativePath: nextCodeRef.relativePath,
    startLine: nextCodeRef.startLine,
    endLine: nextCodeRef.endLine,
    code: normalizeCodeForStorage(nextCodeRef.code),
    language: nextCodeRef.language,
  };

  const nextContents = `${contents.slice(0, section.start)}${formatAnnotationEntry(
    updatedEntry,
  )}${contents.slice(section.end)}`;
  await writeTextFile(targetDocumentUri, nextContents);
  return updatedEntry;
}

export async function loadAnnotations(
  workspaceFolder: vscode.WorkspaceFolder,
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
): Promise<AnnotationEntry[]> {
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
  const relativePath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, uri.fsPath),
  );
  if (relativePath === getConfiguredDocumentPath()) {
    return true;
  }

  return (
    relativePath.startsWith(`${getManagedListsDirectoryPath()}/`) &&
    relativePath.toLowerCase().endsWith(".md")
  );
}

export async function deleteAnnotation(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationEntry,
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
): Promise<boolean> {
  const targetDocumentUri = await ensureAnnotationsDocument(
    workspaceFolder,
    documentUri,
  );
  const contents = await readTextFile(targetDocumentUri);
  if (!contents) {
    return false;
  }

  const section = collectAnnotationSections(contents).find(({ entry }) =>
    isSameAnnotationEntry(entry, target),
  );
  if (!section) {
    return false;
  }

  const nextContents = `${contents.slice(0, section.start)}${contents.slice(
    section.end,
  )}`;
  await writeTextFile(
    targetDocumentUri,
    nextContents.trimEnd() ? `${nextContents.trimEnd()}\n` : DOCUMENT_HEADER,
  );
  return true;
}

export async function findAnnotationSection(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationEntry,
  documentUri: vscode.Uri = getAnnotationsDocumentUri(workspaceFolder),
): Promise<ParsedAnnotationSection | undefined> {
  const contents = await readTextFile(documentUri);
  if (!contents) {
    return undefined;
  }

  return collectAnnotationSections(contents).find(({ entry }) =>
    isSameAnnotationEntry(entry, target),
  );
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

function getManagedListsDirectoryPath(): string {
  const directory = path.posix.dirname(getConfiguredDocumentPath());
  return directory === "." ? "lists" : path.posix.join(directory, "lists");
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

async function maybeEnsureAnnotationsDirectoryIgnored(
  workspaceFolder: vscode.WorkspaceFolder,
  documentUri: vscode.Uri,
): Promise<void> {
  const relativeDocumentPath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath),
  );
  if (!relativeDocumentPath.startsWith(`${ANNOTATIONS_DIRECTORY}/`)) {
    return;
  }

  const gitIgnoreUri = vscode.Uri.joinPath(workspaceFolder.uri, ".gitignore");
  const existing = await readTextFile(gitIgnoreUri);
  if (existing === undefined) {
    return;
  }

  const lines = existing.split(/\r?\n/);
  const hasActiveEntry = lines.some((line) =>
    matchesAnnotationsIgnoreEntry(line),
  );
  const hasCommentedEntry = lines.some((line) =>
    isCommentedAnnotationsIgnoreEntry(line),
  );
  if (hasActiveEntry || hasCommentedEntry) {
    return;
  }

  const separator = existing.endsWith("\n") ? "" : "\n";
  await writeTextFile(
    gitIgnoreUri,
    `${existing}${separator}${ANNOTATIONS_GITIGNORE_ENTRY}\n`,
  );
}

function matchesAnnotationsIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return false;
  }

  return normalizeIgnoreEntry(trimmed) === ANNOTATIONS_DIRECTORY;
}

function isCommentedAnnotationsIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) {
    return false;
  }

  return (
    normalizeIgnoreEntry(trimmed.replace(/^#+\s*/, "")) ===
    ANNOTATIONS_DIRECTORY
  );
}

function normalizeIgnoreEntry(value: string): string {
  return value.trim().replace(/\/+$/g, "").replace(/\\+$/g, "");
}

function isSameAnnotationEntry(
  left: AnnotationEntry,
  right: AnnotationEntry,
): boolean {
  if (left.addedAt && right.addedAt) {
    return left.addedAt === right.addedAt;
  }

  return (
    left.relativePath === right.relativePath &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.scope === right.scope &&
    left.type === right.type &&
    left.comment === right.comment
  );
}
