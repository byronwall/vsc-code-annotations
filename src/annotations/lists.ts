import * as path from "node:path";
import * as vscode from "vscode";

import { parseAnnotationsDocumentTitle } from "./markdown";
import {
  ensureAnnotationsDocument,
  getAnnotationsDocumentPath,
} from "./storage";
import { toPosix } from "./utils";

export interface AnnotationList {
  name: string;
  relativePath: string;
  documentUri: vscode.Uri;
  isDefault: boolean;
}

export async function loadAnnotationLists(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<AnnotationList[]> {
  const defaultRelativePath = getAnnotationsDocumentPath();
  const defaultDocumentUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...defaultRelativePath.split("/"),
  );
  const defaultList: AnnotationList = {
    name: (await loadListName(defaultDocumentUri)) ?? "Default",
    relativePath: defaultRelativePath,
    documentUri: defaultDocumentUri,
    isDefault: true,
  };

  const listsDirectoryPath = getNamedAnnotationListsPath();
  const listsDirectoryUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...listsDirectoryPath.split("/"),
  );

  const discoveredLists = await readMarkdownFiles(listsDirectoryUri);
  const namedLists = await Promise.all(
    discoveredLists.map(async (documentUri) => {
      const relativePath = toPosix(
        path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath),
      );
      return {
        name:
          (await loadListName(documentUri)) ??
          deriveListName(path.posix.basename(relativePath, ".md")),
        relativePath,
        documentUri,
        isDefault: false,
      } satisfies AnnotationList;
    }),
  );

  namedLists.sort((left, right) => left.name.localeCompare(right.name));
  return [defaultList, ...namedLists];
}

export async function createAnnotationList(
  workspaceFolder: vscode.WorkspaceFolder,
  name: string,
): Promise<AnnotationList> {
  const normalizedName = name.trim();
  const existingPaths = new Set(
    (await loadAnnotationLists(workspaceFolder)).map(
      (list) => list.relativePath,
    ),
  );
  const relativePath = nextAvailableListPath(existingPaths, normalizedName);
  const documentUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...relativePath.split("/"),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(path.dirname(documentUri.fsPath)),
  );
  await ensureAnnotationsDocument(workspaceFolder, documentUri, normalizedName);

  return {
    name: normalizedName,
    relativePath,
    documentUri,
    isDefault: false,
  };
}

export function getNamedAnnotationListsPath(): string {
  const defaultPath = getAnnotationsDocumentPath();
  const directory = path.posix.dirname(defaultPath);
  return directory === "." ? "lists" : path.posix.join(directory, "lists");
}

async function readMarkdownFiles(
  directoryUri: vscode.Uri,
): Promise<vscode.Uri[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(directoryUri);
    return entries
      .filter(
        ([name, type]) =>
          type === vscode.FileType.File && name.toLowerCase().endsWith(".md"),
      )
      .map(([name]) => vscode.Uri.joinPath(directoryUri, name));
  } catch {
    return [];
  }
}

async function loadListName(
  documentUri: vscode.Uri,
): Promise<string | undefined> {
  try {
    const contents = await vscode.workspace.fs.readFile(documentUri);
    return parseAnnotationsDocumentTitle(
      Buffer.from(contents).toString("utf8"),
    );
  } catch {
    return undefined;
  }
}

function nextAvailableListPath(
  existingPaths: Set<string>,
  name: string,
): string {
  const slugBase = slugify(name);
  const listsDirectoryPath = getNamedAnnotationListsPath();

  let index = 1;
  while (true) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = path.posix.join(
      listsDirectoryPath,
      `${slugBase}${suffix}.md`,
    );
    if (!existingPaths.has(candidate)) {
      return candidate;
    }

    index += 1;
  }
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "annotation-list";
}

function deriveListName(value: string): string {
  const normalized = value.replace(/[-_]+/g, " ").trim();
  if (!normalized) {
    return "Annotation List";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
