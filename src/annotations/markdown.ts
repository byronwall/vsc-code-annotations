import { AnnotationEntry, normalizeAnnotationType } from "./model";
import { formatAnnotationLocation } from "./presentation";
import {
  escapeForRegExp,
  formatLineRange,
  normalizeCodeForStorage,
  selectFence,
  trimBlankLines,
} from "./utils";

const ANNOTATION_HEADING_PATTERN =
  /^##\s+\[([^\]]+)\]\s+(.+):(\d+)(?:-(\d+))?\s*$/;
const COMMENT_SECTION_PATTERN = /^#{2,6}\s+Comment\s*$/i;
const CODE_REF_SECTION_PATTERN = /^#{2,6}\s+Code\s+Ref\s*$/i;

export function buildAnnotationsDocumentHeader(listName?: string): string {
  return [
    listName?.trim()
      ? `# Code Annotations: ${listName.trim()}`
      : "# Code Annotations",
    "",
    "Saved code refs and markdown comments live here for later AI-assisted work.",
    "Paths in each Code Ref section are repo-relative to the workspace root.",
    "",
  ].join("\n");
}

export const DOCUMENT_HEADER = buildAnnotationsDocumentHeader();

export interface ParsedAnnotationSection {
  entry: AnnotationEntry;
  start: number;
  end: number;
  startLine: number;
}

export function formatAnnotationEntry(entry: AnnotationEntry): string {
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

export function parseAnnotationsDocument(contents: string): AnnotationEntry[] {
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

export function collectAnnotationSections(
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
        startLine: contents.slice(0, start).split(/\r?\n/).length,
      };
    })
    .filter(
      (section): section is ParsedAnnotationSection => section !== undefined,
    );
}

export function parseAnnotationsDocumentTitle(
  contents: string,
): string | undefined {
  const match = contents.match(/^#\s+Code Annotations(?::\s*(.+))?\s*$/m);
  const title = match?.[1]?.trim();
  return title ? title : undefined;
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
