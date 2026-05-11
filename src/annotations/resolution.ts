import * as vscode from "vscode";

import { AnnotationEntry, AnnotationLocationResolution } from "./model";
import {
  buildSearchWindowSizes,
  MIN_FUZZY_MATCH_LENGTH,
  MIN_FUZZY_MATCH_SCORE,
  scoreApproximateMatch,
} from "./fuzzy";
import {
  countCodeLines,
  normalizeCodeForStorage,
  normalizeForMatching,
  normalizeLanguageId,
} from "./utils";

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

  if (entry.scope === "file") {
    return {
      relativePath: entry.relativePath,
      startLine: 1,
      endLine: Math.max(document.lineCount, 1),
      scope: "file",
      code: "",
      language: normalizeLanguageId(document.languageId) ?? entry.language,
      status: "current",
      score: 1,
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
  return resolution.scope !== "file" && resolution.status === "relocated";
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
  const storedCode = normalizeCodeForStorage(entry.code);
  if (!storedCode) {
    return undefined;
  }

  const lineRange = getFullLineRange(
    document,
    entry.startLine - 1,
    entry.endLine - 1,
  );
  if (!lineRange) {
    return undefined;
  }

  const rangeText = document.getText(lineRange);
  const localIndex = rangeText.indexOf(storedCode);
  if (localIndex < 0) {
    return undefined;
  }

  const absoluteStart = document.offsetAt(lineRange.start) + localIndex;
  const absoluteEnd = absoluteStart + storedCode.length;
  return buildResolutionFromOffsets(
    document,
    entry.relativePath,
    absoluteStart,
    absoluteEnd,
    "selection",
    storedCode,
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
        "selection",
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
        "selection",
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

function buildResolutionFromOffsets(
  document: vscode.TextDocument,
  relativePath: string,
  startOffset: number,
  endOffset: number,
  scope: "selection",
  code: string,
  language: string | undefined,
  status: "current" | "relocated",
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
    scope,
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
  scope: "selection",
  code: string,
  language: string | undefined,
  status: "relocated",
  score: number,
): AnnotationLocationResolution {
  return {
    relativePath,
    startLine: range.start.line + 1,
    endLine: range.end.line + 1,
    scope,
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
