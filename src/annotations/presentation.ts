import * as vscode from "vscode";

import {
  AnnotationEntry,
  AnnotationLocationResolution,
  AnnotationLocationStatus,
  AnnotationScope,
} from "./model";
import {
  escapeMarkdown,
  formatLineRange,
  trimBlankLines,
  truncateForLabel,
} from "./utils";

export function formatAnnotationLocation(entry: {
  relativePath: string;
  startLine: number;
  endLine: number;
}): string {
  return `${entry.relativePath}:${formatLineRange(entry.startLine, entry.endLine)}`;
}

export function resolveTreeItemContextValue(
  status: AnnotationLocationStatus,
): string {
  if (status === "relocated") {
    return "annotationEntryRelocated";
  }

  if (status === "missing") {
    return "annotationEntryMissing";
  }

  return "annotationEntryCurrent";
}

export function buildTreeItemDescription(
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

export function buildGroupedTreeItemDescription(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  const storedRange = formatLineRange(entry.startLine, entry.endLine);
  if (resolution.status === "current") {
    return storedRange;
  }

  if (resolution.status === "relocated") {
    return `${storedRange} -> ${formatLineRange(
      resolution.startLine,
      resolution.endLine,
    )}`;
  }

  return `${storedRange} (needs review)`;
}

export function buildTooltip(
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
  tooltip.appendMarkdown(
    `- Scope: ${escapeMarkdown(formatAnnotationScope(entry.scope))}\n`,
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
  appendStoredCodePreview(tooltip, entry);
  return tooltip;
}

export function formatAnnotationScope(scope: AnnotationScope): string {
  return scope === "file" ? "whole file" : "selection";
}

export function appendStoredCodePreview(
  markdown: vscode.MarkdownString,
  entry: Pick<AnnotationEntry, "code" | "language" | "scope">,
): void {
  if (entry.scope === "file") {
    markdown.appendMarkdown(
      "_Whole-file annotation. Stored code block intentionally left blank._",
    );
    return;
  }

  markdown.appendCodeblock(entry.code, entry.language);
}

export function summarizeComment(entry: AnnotationEntry): string {
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

export function summarizeAnnotationForUi(entry: AnnotationEntry): string {
  const firstLine = entry.comment
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  const normalized = (firstLine ?? entry.type)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/, "")
    .replace(/[`*_~]/g, "")
    .trim();

  return truncateForLabel(normalized || entry.type, 80);
}

export function buildFileSummaryTitle(count: number): string {
  return count === 1
    ? "1 annotation in this file"
    : `${count} annotations in this file`;
}

export function buildAnnotationLensTitle(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  const prefix =
    resolution.status === "relocated"
      ? "Annotation moved: "
      : resolution.status === "missing"
        ? "Annotation missing: "
        : "Annotation: ";
  return `${prefix}${summarizeAnnotationForUi(entry)}`;
}

export function buildAnnotationLensTooltip(
  entry: AnnotationEntry,
  resolution: AnnotationLocationResolution,
): string {
  if (resolution.status === "current") {
    return `Jump to ${formatAnnotationLocation(entry)}`;
  }

  if (resolution.status === "relocated") {
    return `Jump to ${formatAnnotationLocation(resolution)}`;
  }

  return `Open ${formatAnnotationLocation(entry)} for review`;
}
