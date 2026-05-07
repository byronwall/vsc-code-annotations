import * as path from "node:path";
import * as vscode from "vscode";

const DEFAULT_DOCUMENT_PATH = ".annotations/code-annotations.md";
const ANNOTATIONS_DIRECTORY = ".annotations";
const ANNOTATIONS_GITIGNORE_ENTRY = ".annotations/";
const MIN_FUZZY_MATCH_LENGTH = 24;
const MIN_FUZZY_MATCH_SCORE = 0.58;
const FUZZY_WINDOW_RADIUS = 2;
const ANNOTATION_HEADING_PATTERN =
  /^##\s+\[([^\]]+)\]\s+(.+):(\d+)(?:-(\d+))?\s*$/;
const COMMENT_SECTION_PATTERN = /^#{2,6}\s+Comment\s*$/i;
const CODE_REF_SECTION_PATTERN = /^#{2,6}\s+Code\s+Ref\s*$/i;
const DOCUMENT_HEADER = [
  "# Code Annotations",
  "",
  "Saved code refs and markdown comments live here for later AI-assisted work.",
  "Paths in each Code Ref section are repo-relative to the workspace root.",
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
export type AnnotationLocationStatus = "current" | "relocated" | "missing";

export interface AnnotationCodeRef {
  relativePath: string;
  startLine: number;
  endLine: number;
  code: string;
  language?: string;
}

export interface AnnotationDraft extends AnnotationCodeRef {
  type: AnnotationType;
  comment: string;
}

export interface AnnotationEntry extends AnnotationDraft {
  addedAt: string;
}

export interface AnnotationLocationResolution extends AnnotationCodeRef {
  status: AnnotationLocationStatus;
  score: number;
  startCharacter?: number;
  endCharacter?: number;
}

export interface AnnotationTypeOption {
  label: string;
  description: string;
  value: AnnotationType;
}

interface ParsedAnnotationSection {
  entry: AnnotationEntry;
  start: number;
  end: number;
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

    const entries = await loadAnnotations(workspaceFolder);
    if (entries.length === 0) {
      return [
        new MessageTreeItem(
          `No annotations found in ${getConfiguredDocumentPath()} yet.`,
        ),
      ];
    }

    return Promise.all(
      entries.map(async (entry) => {
        const resolution = await resolveAnnotationLocation(
          workspaceFolder,
          entry,
        );
        return new AnnotationTreeItem(entry, resolution);
      }),
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

export class AnnotationTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: AnnotationEntry,
    public readonly resolution: AnnotationLocationResolution,
  ) {
    super(summarizeComment(entry), vscode.TreeItemCollapsibleState.None);
    this.contextValue = resolveTreeItemContextValue(resolution.status);
    this.description = buildTreeItemDescription(entry, resolution);
    this.iconPath = new vscode.ThemeIcon(resolveTypeIcon(entry.type));
    this.command = {
      command: "codeAnnotations.openSourceLocation",
      title: "Open Source Location",
      arguments: [this],
    };
    this.tooltip = buildTooltip(entry, resolution);
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
  await maybeEnsureAnnotationsDirectoryIgnored(workspaceFolder, documentUri);

  const existing = (await readTextFile(documentUri)) ?? DOCUMENT_HEADER;
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
    documentUri,
    nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`,
  );
  return entry;
}

export async function updateAnnotationCodeRef(
  workspaceFolder: vscode.WorkspaceFolder,
  target: AnnotationEntry,
  nextCodeRef: AnnotationCodeRef,
): Promise<AnnotationEntry | undefined> {
  const documentUri = await ensureAnnotationsDocument(workspaceFolder);
  await maybeEnsureAnnotationsDirectoryIgnored(workspaceFolder, documentUri);

  const contents = await readTextFile(documentUri);
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
  await writeTextFile(documentUri, nextContents);
  return updatedEntry;
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

export async function resolveAnnotationLocation(
  workspaceFolder: vscode.WorkspaceFolder,
  entry: AnnotationEntry,
): Promise<AnnotationLocationResolution> {
  const fileUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ...entry.relativePath.split("/"),
  );
  const document = await openTextDocumentIfExists(fileUri);
  if (!document) {
    return {
      ...entry,
      code: normalizeCodeForStorage(entry.code),
      status: "missing",
      score: 0,
    };
  }

  const currentLocation = findMatchWithinStoredRange(document, entry);
  if (currentLocation) {
    return {
      ...currentLocation,
      relativePath: entry.relativePath,
      status: "current",
      score: 1,
    };
  }

  const relocatedExact = pickClosestExactMatch(
    findExactCodeMatches(document, entry.code, entry.relativePath),
    entry.startLine,
  );
  if (relocatedExact) {
    return {
      ...relocatedExact,
      status: "relocated",
      score: 1,
    };
  }

  const relocatedApproximate = findBestApproximateMatch(document, entry);
  if (relocatedApproximate) {
    return relocatedApproximate;
  }

  return {
    ...entry,
    code: normalizeCodeForStorage(entry.code),
    status: "missing",
    score: 0,
  };
}

export function canFixAnnotationLocation(
  resolution: AnnotationLocationResolution,
): boolean {
  return resolution.status === "relocated";
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
  const comment = trimBlankLines(entry.comment.split(/\r?\n/)).join("\n");
  const fence = selectFence(entry.code);
  const fenceLine = entry.language?.trim()
    ? `${fence}${entry.language.trim()}`
    : fence;

  return [
    `## [${entry.type}] ${formatAnnotationLocation(entry)}`,
    "",
    `Added: ${entry.addedAt}`,
    `Type: ${entry.type}`,
    "",
    "### Comment",
    "",
    comment || "_No comment provided._",
    "",
    "### Code ref",
    "",
    `Path: ${entry.relativePath}`,
    `Lines: ${formatLineRange(entry.startLine, entry.endLine)}`,
    "",
    fenceLine,
    normalizeCodeForStorage(entry.code),
    fence,
    "",
    "",
  ].join("\n");
}

function parseAnnotationsDocument(contents: string): AnnotationEntry[] {
  const entries = collectAnnotationSections(contents).map(({ entry }) => entry);

  return entries.sort((left, right) => {
    const leftTime = Date.parse(left.addedAt);
    const rightTime = Date.parse(right.addedAt);
    return (
      (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0)
    );
  });
}

function collectAnnotationSections(
  contents: string,
): ParsedAnnotationSection[] {
  const matches = Array.from(contents.matchAll(/^##\s+\[[^\]]+\]\s+.+$/gm));

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? contents.length;
      const sectionText = contents.slice(start, end);
      const entry = parseAnnotationSection(sectionText);
      if (!entry) {
        return undefined;
      }

      return {
        entry,
        start,
        end,
      };
    })
    .filter(
      (section): section is ParsedAnnotationSection => section !== undefined,
    );
}

function parseAnnotationSection(section: string): AnnotationEntry | undefined {
  const lines = section.replace(/\s+$/, "").split(/\r?\n/);
  const heading = lines[0]?.match(ANNOTATION_HEADING_PATTERN);
  if (!heading) {
    return undefined;
  }

  const preambleLines: string[] = [];
  const commentLines: string[] = [];
  const codeRefLines: string[] = [];
  let currentSection: "preamble" | "comment" | "codeRef" = "preamble";

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (COMMENT_SECTION_PATTERN.test(line)) {
      currentSection = "comment";
      continue;
    }

    if (CODE_REF_SECTION_PATTERN.test(line)) {
      currentSection = "codeRef";
      continue;
    }

    if (currentSection === "preamble") {
      preambleLines.push(line);
      continue;
    }

    if (currentSection === "comment") {
      commentLines.push(line);
      continue;
    }

    codeRefLines.push(line);
  }

  const preambleMetadata = parseMetadataLines(preambleLines);
  const legacyMetadata = parseMetadataLines(
    lines.slice(1).filter((line) => line.trim().startsWith("- ")),
  );
  const codeRefMetadata = parseMetadataLines(codeRefLines);
  const type = normalizeAnnotationType(
    preambleMetadata.get("type") ?? legacyMetadata.get("type") ?? heading[1],
  );
  if (!type) {
    return undefined;
  }

  const relativePath =
    codeRefMetadata.get("path") ??
    codeRefMetadata.get("file") ??
    legacyMetadata.get("file") ??
    heading[2];
  const range =
    parseLineRange(codeRefMetadata.get("lines")) ??
    parseLineRange(legacyMetadata.get("lines"));
  const startLine = range?.startLine ?? Number.parseInt(heading[3], 10);
  const endLine =
    range?.endLine ?? Number.parseInt(heading[4] ?? heading[3], 10);
  const comment =
    trimBlankLines(commentLines).join("\n") ||
    legacyMetadata.get("comment") ||
    "";
  const addedAt =
    preambleMetadata.get("added") ?? legacyMetadata.get("added") ?? "";
  const codeBlock =
    extractCodeBlock(codeRefLines) ?? extractCodeBlock(lines.slice(1));
  if (!codeBlock) {
    return undefined;
  }

  return {
    relativePath,
    startLine,
    endLine,
    type,
    comment,
    addedAt,
    code: normalizeCodeForStorage(codeBlock.code),
    language: codeBlock.language,
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

  const match = value.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return undefined;
  }

  return {
    startLine: Number.parseInt(match[1], 10),
    endLine: Number.parseInt(match[2] ?? match[1], 10),
  };
}

function parseMetadataLines(lines: string[]): Map<string, string> {
  const metadata = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(/^(?:[-*]\s*)?([^:]+):\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    metadata.set(match[1].trim().toLowerCase(), match[2].trim());
  }

  return metadata;
}

function extractCodeBlock(
  lines: string[],
): { code: string; language?: string } | undefined {
  let openerIndex = -1;
  let fence = "";
  let language: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index].match(/^(`{3,}|~{3,})([^\s`]*)\s*$/);
    if (!opener) {
      continue;
    }

    openerIndex = index;
    fence = opener[1];
    language = opener[2]?.trim() || undefined;
    break;
  }

  if (openerIndex < 0) {
    return undefined;
  }

  const closingPattern = new RegExp(`^${escapeForRegExp(fence)}\\s*$`);
  const codeLines: string[] = [];
  for (let index = openerIndex + 1; index < lines.length; index += 1) {
    if (closingPattern.test(lines[index])) {
      return {
        code: codeLines.join("\n"),
        language,
      };
    }

    codeLines.push(lines[index]);
  }

  return undefined;
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
  return value.trim().replace(/\/+$|\\+$/g, "");
}

async function openTextDocumentIfExists(
  uri: vscode.Uri,
): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

function findMatchWithinStoredRange(
  document: vscode.TextDocument,
  entry: AnnotationEntry,
): AnnotationLocationResolution | undefined {
  const lineRange = getFullLineRange(
    document,
    entry.startLine - 1,
    entry.endLine - 1,
  );
  if (!lineRange) {
    return undefined;
  }

  const rangeText = document.getText(lineRange);
  const localIndex = rangeText.indexOf(entry.code);
  if (localIndex < 0) {
    return undefined;
  }

  const absoluteStart = document.offsetAt(lineRange.start) + localIndex;
  const absoluteEnd = absoluteStart + entry.code.length;
  return buildResolutionFromOffsets(
    document,
    entry.relativePath,
    absoluteStart,
    absoluteEnd,
    entry.code,
    normalizeLanguageId(document.languageId) ?? entry.language,
    "current",
    1,
  );
}

function findExactCodeMatches(
  document: vscode.TextDocument,
  code: string,
  relativePath: string,
): AnnotationLocationResolution[] {
  const normalizedCode = normalizeCodeForStorage(code);
  if (!normalizedCode) {
    return [];
  }

  const documentText = document.getText();
  const matches: AnnotationLocationResolution[] = [];
  let index = documentText.indexOf(normalizedCode);

  while (index >= 0) {
    matches.push(
      buildResolutionFromOffsets(
        document,
        relativePath,
        index,
        index + normalizedCode.length,
        normalizedCode,
        normalizeLanguageId(document.languageId),
        "relocated",
        1,
      ),
    );
    index = documentText.indexOf(normalizedCode, index + 1);
  }

  return matches;
}

function pickClosestExactMatch(
  matches: AnnotationLocationResolution[],
  storedStartLine: number,
): AnnotationLocationResolution | undefined {
  return matches.sort((left, right) => {
    return (
      Math.abs(left.startLine - storedStartLine) -
      Math.abs(right.startLine - storedStartLine)
    );
  })[0];
}

function findBestApproximateMatch(
  document: vscode.TextDocument,
  entry: AnnotationEntry,
): AnnotationLocationResolution | undefined {
  const target = normalizeForMatching(entry.code);
  if (target.length < MIN_FUZZY_MATCH_LENGTH) {
    return undefined;
  }

  const windowSizes = buildSearchWindowSizes(
    Math.max(
      countCodeLines(entry.code),
      entry.endLine - entry.startLine + 1,
      1,
    ),
  );
  let bestMatch: AnnotationLocationResolution | undefined;

  for (const windowSize of windowSizes) {
    for (
      let startLineIndex = 0;
      startLineIndex + windowSize <= document.lineCount;
      startLineIndex += 1
    ) {
      const endLineIndex = startLineIndex + windowSize - 1;
      const range = getFullLineRange(document, startLineIndex, endLineIndex);
      if (!range) {
        continue;
      }

      const candidateCode = normalizeCodeForStorage(document.getText(range));
      const score = scoreApproximateMatch(
        entry.code,
        candidateCode,
        entry.startLine - 1,
        startLineIndex,
      );
      if (score < MIN_FUZZY_MATCH_SCORE) {
        continue;
      }

      const candidate = buildResolutionFromRange(
        document,
        entry.relativePath,
        range,
        candidateCode,
        normalizeLanguageId(document.languageId) ?? entry.language,
        "relocated",
        score,
      );
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

function buildSearchWindowSizes(lineCount: number): number[] {
  const values = new Set<number>();
  values.add(lineCount);

  for (let delta = 1; delta <= FUZZY_WINDOW_RADIUS; delta += 1) {
    values.add(Math.max(1, lineCount - delta));
    values.add(lineCount + delta);
  }

  return Array.from(values);
}

function scoreApproximateMatch(
  targetCode: string,
  candidateCode: string,
  targetStartLine: number,
  candidateStartLine: number,
): number {
  const normalizedTarget = normalizeForMatching(targetCode);
  const normalizedCandidate = normalizeForMatching(candidateCode);
  if (!normalizedTarget || !normalizedCandidate) {
    return 0;
  }

  const contentScore = diceCoefficient(normalizedTarget, normalizedCandidate);
  const boundaryScore = scoreBoundarySimilarity(targetCode, candidateCode);
  const distance = Math.abs(targetStartLine - candidateStartLine);
  const proximityScore = 1 / (1 + distance / 40);

  return contentScore * 0.75 + boundaryScore * 0.15 + proximityScore * 0.1;
}

function scoreBoundarySimilarity(
  targetCode: string,
  candidateCode: string,
): number {
  const targetLines = nonEmptyNormalizedLines(targetCode);
  const candidateLines = nonEmptyNormalizedLines(candidateCode);
  if (targetLines.length === 0 || candidateLines.length === 0) {
    return 0;
  }

  const firstScore = diceCoefficient(targetLines[0], candidateLines[0] ?? "");
  const lastScore = diceCoefficient(
    targetLines[targetLines.length - 1],
    candidateLines[candidateLines.length - 1] ?? "",
  );
  return (firstScore + lastScore) / 2;
}

function nonEmptyNormalizedLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => normalizeForMatching(line))
    .filter(Boolean);
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftCounts = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    leftCounts.set(gram, (leftCounts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    const count = leftCounts.get(gram) ?? 0;
    if (count > 0) {
      leftCounts.set(gram, count - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / (left.length + right.length - 2);
}

function countCodeLines(value: string): number {
  return normalizeCodeForStorage(value).split("\n").length;
}

function normalizeForMatching(value: string): string {
  return normalizeCodeForStorage(value).replace(/\s+/g, " ").trim();
}

function normalizeCodeForStorage(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function buildResolutionFromOffsets(
  document: vscode.TextDocument,
  relativePath: string,
  startOffset: number,
  endOffset: number,
  code: string,
  language: string | undefined,
  status: AnnotationLocationStatus,
  score: number,
): AnnotationLocationResolution {
  const start = document.positionAt(startOffset);
  const end = document.positionAt(endOffset);
  const endLine =
    end.character === 0 && end.line > start.line ? end.line : end.line + 1;

  return {
    relativePath,
    startLine: start.line + 1,
    endLine,
    code: normalizeCodeForStorage(code),
    language,
    startCharacter: start.character,
    endCharacter: end.character,
    status,
    score,
  };
}

function buildResolutionFromRange(
  document: vscode.TextDocument,
  relativePath: string,
  range: vscode.Range,
  code: string,
  language: string | undefined,
  status: AnnotationLocationStatus,
  score: number,
): AnnotationLocationResolution {
  return {
    relativePath,
    startLine: range.start.line + 1,
    endLine: range.end.line + 1,
    code: normalizeCodeForStorage(code),
    language,
    startCharacter: range.start.character,
    endCharacter: range.end.character,
    status,
    score,
  };
}

function getFullLineRange(
  document: vscode.TextDocument,
  startLineIndex: number,
  endLineIndex: number,
): vscode.Range | undefined {
  if (
    startLineIndex < 0 ||
    endLineIndex < startLineIndex ||
    startLineIndex >= document.lineCount
  ) {
    return undefined;
  }

  const safeEndLineIndex = Math.min(endLineIndex, document.lineCount - 1);
  return new vscode.Range(
    new vscode.Position(startLineIndex, 0),
    document.lineAt(safeEndLineIndex).range.end,
  );
}

function normalizeLanguageId(
  languageId: string | undefined,
): string | undefined {
  if (!languageId || languageId === "plaintext") {
    return undefined;
  }

  return languageId;
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
    left.type === right.type &&
    left.comment === right.comment
  );
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

function resolveTreeItemContextValue(status: AnnotationLocationStatus): string {
  if (status === "relocated") {
    return "annotationEntryRelocated";
  }

  if (status === "missing") {
    return "annotationEntryMissing";
  }

  return "annotationEntryCurrent";
}

function buildTreeItemDescription(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  const storedLocation = formatAnnotationLocation(entry);
  if (resolution.status === "current") {
    return storedLocation;
  }

  if (resolution.status === "relocated") {
    return `${storedLocation} -> ${formatAnnotationLocation(resolution)}`;
  }

  return `${storedLocation} (needs review)`;
}

function buildTooltip(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.isTrusted = false;
  tooltip.supportHtml = false;
  tooltip.appendMarkdown(
    `${trimBlankLines(entry.comment.split(/\r?\n/)).join("\n") || "_No comment provided._"}\n\n`,
  );
  tooltip.appendMarkdown(`- Type: ${escapeMarkdown(entry.type)}\n`);
  tooltip.appendMarkdown(
    `- Saved Code Ref: ${escapeMarkdown(formatAnnotationLocation(entry))}\n`,
  );

  if (resolution.status === "relocated") {
    tooltip.appendMarkdown(
      `- Best Current Match: ${escapeMarkdown(
        formatAnnotationLocation(resolution),
      )}\n`,
    );
  }

  if (resolution.status === "missing") {
    tooltip.appendMarkdown("- Best Current Match: not found\n");
  }

  tooltip.appendMarkdown(`- Added: ${escapeMarkdown(entry.addedAt)}\n\n`);
  tooltip.appendCodeblock(entry.code, entry.language);
  return tooltip;
}

function summarizeComment(entry: AnnotationEntry): string {
  const firstLine = trimBlankLines(entry.comment.split(/\r?\n/)).find(
    (line) => line.trim().length > 0,
  );
  const normalized = (firstLine ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[>#*_\-+]+\s*/, "")
    .replace(/[`*_~]/g, "")
    .trim();

  return truncateForLabel(
    normalized || `${entry.type} • ${formatAnnotationLocation(entry)}`,
  );
}

function truncateForLabel(value: string, limit = 72): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}...`;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start].trim()) {
    start += 1;
  }

  while (end > start && !lines[end - 1].trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
}
