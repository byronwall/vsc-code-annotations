import * as vscode from "vscode";

import {
  AnnotationEntry,
  canFixAnnotationLocation,
  formatAnnotationLocation,
  isAnnotationsDocument,
} from "./annotations";
import {
  appendStoredCodePreview,
  formatAnnotationScope,
} from "./annotations/presentation";
import {
  loadResolvedAnnotationsForDocument,
  ResolvedAnnotation,
  resolveActiveWorkspaceFolder,
} from "./annotationWorkspace";
import { escapeMarkdown, trimBlankLines } from "./annotations/utils";

const HOVER_COMMANDS = [
  "codeAnnotations.fixAnnotationLocation",
  "codeAnnotations.deleteAnnotation",
  "codeAnnotations.openAnnotationDocumentLocation",
] as const;

export class AnnotationHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly resolveWorkspaceFolder: (
      uri?: vscode.Uri,
    ) => vscode.WorkspaceFolder | undefined = resolveActiveWorkspaceFolder,
  ) {}

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const workspaceFolder = this.resolveWorkspaceFolder(document.uri);
    if (
      !workspaceFolder ||
      document.uri.scheme !== "file" ||
      isAnnotationsDocument(document.uri, workspaceFolder)
    ) {
      return undefined;
    }

    const resolvedAnnotations = await loadResolvedAnnotationsForDocument(
      workspaceFolder,
      document.uri,
    );
    const matchingAnnotations = resolvedAnnotations.filter((annotation) =>
      buildAnnotationRange(document, annotation).contains(position),
    );
    if (matchingAnnotations.length === 0) {
      return undefined;
    }

    const contents: vscode.MarkdownString[] = [];
    for (const [index, annotation] of matchingAnnotations.entries()) {
      if (index > 0) {
        contents.push(new vscode.MarkdownString("---"));
      }

      contents.push(buildAnnotationDetailMarkdown(annotation));
      contents.push(buildAnnotationActionsMarkdown(annotation));
    }

    return new vscode.Hover(
      contents,
      buildAnnotationRange(document, matchingAnnotations[0]),
    );
  }
}

function buildAnnotationDetailMarkdown(
  annotation: ResolvedAnnotation,
): vscode.MarkdownString {
  const { entry, list, resolution } = annotation;
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  markdown.appendMarkdown(`### ${escapeMarkdown(entry.type)}\n\n`);
  markdown.appendMarkdown(
    `${trimBlankLines(entry.comment.split(/\r?\n/)).join("\n") || "_No comment provided._"}\n\n`,
  );
  markdown.appendMarkdown(`- List: ${escapeMarkdown(list.name)}\n`);
  markdown.appendMarkdown(
    `- Saved Code Ref: ${escapeMarkdown(formatAnnotationLocation(entry))}\n`,
  );
  markdown.appendMarkdown(
    `- Scope: ${escapeMarkdown(formatAnnotationScope(entry.scope))}\n`,
  );

  if (resolution.status === "relocated") {
    markdown.appendMarkdown(
      `- Best Current Match: ${escapeMarkdown(
        formatAnnotationLocation(resolution),
      )}\n`,
    );
  }

  if (resolution.status === "missing") {
    markdown.appendMarkdown("- Best Current Match: not found\n");
  }
  markdown.appendMarkdown(`- Added: ${escapeMarkdown(entry.addedAt)}\n\n`);
  appendStoredCodePreview(markdown, entry);
  return markdown;
}

function buildAnnotationActionsMarkdown(
  annotation: ResolvedAnnotation,
): vscode.MarkdownString {
  const actions = [
    buildCommandLink(
      "codeAnnotations.openAnnotationDocumentLocation",
      "Jump to comment in md",
      annotation.entry,
    ),
    buildCommandLink(
      "codeAnnotations.deleteAnnotation",
      "Delete",
      annotation.entry,
    ),
  ];

  if (annotation.resolution.status !== "current") {
    actions.unshift(
      buildCommandLink(
        "codeAnnotations.fixAnnotationLocation",
        canFixAnnotationLocation(annotation.resolution)
          ? "Fix code ref"
          : "Try fix code ref",
        annotation.entry,
      ),
    );
  }

  const markdown = new vscode.MarkdownString(actions.join(" | "));
  markdown.isTrusted = { enabledCommands: [...HOVER_COMMANDS] };
  markdown.supportHtml = false;
  return markdown;
}

function buildCommandLink(
  command: string,
  label: string,
  argument: AnnotationEntry,
): string {
  return `[${label}](command:${command}?${encodeURIComponent(
    JSON.stringify([argument]),
  )})`;
}

function buildAnnotationRange(
  document: vscode.TextDocument,
  annotation: Pick<ResolvedAnnotation, "entry" | "resolution">,
): vscode.Range {
  const target =
    annotation.resolution.status === "missing"
      ? annotation.entry
      : annotation.resolution;
  const startLine = clampLine(document, target.startLine - 1);
  const endLine = clampLine(document, target.endLine - 1);
  const hasCharacterRange =
    "startCharacter" in target &&
    target.startCharacter !== undefined &&
    "endCharacter" in target &&
    target.endCharacter !== undefined;

  if (!hasCharacterRange) {
    return fullLineRange(document, startLine, endLine);
  }

  const targetStartCharacter = target.startCharacter ?? 0;
  const targetEndCharacter = target.endCharacter ?? 0;

  const startCharacter = clampCharacter(
    document,
    startLine,
    targetStartCharacter,
  );
  const endCharacter = clampCharacter(document, endLine, targetEndCharacter);
  if (endLine === startLine && endCharacter <= startCharacter) {
    return fullLineRange(document, startLine, endLine);
  }

  return new vscode.Range(
    new vscode.Position(startLine, startCharacter),
    new vscode.Position(endLine, endCharacter),
  );
}

function fullLineRange(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
): vscode.Range {
  return new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, document.lineAt(endLine).range.end.character),
  );
}

function clampLine(document: vscode.TextDocument, index: number): number {
  return Math.min(Math.max(index, 0), Math.max(document.lineCount - 1, 0));
}

function clampCharacter(
  document: vscode.TextDocument,
  line: number,
  character: number,
): number {
  return Math.min(
    Math.max(character, 0),
    document.lineAt(line).range.end.character,
  );
}
