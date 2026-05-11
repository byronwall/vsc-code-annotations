import * as path from "node:path";
import * as vscode from "vscode";

import {
  AnnotationDraft,
  AnnotationEntry,
  AnnotationList,
  AnnotationScope,
  AnnotationType,
  appendAnnotation,
  createAnnotationList,
  formatAnnotationLocation,
  getAnnotationTypeOptions,
  loadAnnotationLists,
  normalizeAnnotationScope,
} from "./annotations";
import { normalizeLanguageId, toPosix } from "./annotations/utils";
import { AnnotationListState } from "./annotationListState";

const CREATE_ANNOTATION_TOOL = "create_code_annotation";
const CREATE_ANNOTATIONS_TOOL = "create_code_annotations";

const ANNOTATION_TYPE_VALUES = new Set<AnnotationType>(
  getAnnotationTypeOptions().map(({ value }) => value),
);

export function registerAnnotationTools(
  context: vscode.ExtensionContext,
  listState: AnnotationListState,
  refreshAnnotations: () => void,
): void {
  context.subscriptions.push(
    vscode.lm.registerTool(
      CREATE_ANNOTATION_TOOL,
      new CreateAnnotationTool(listState, refreshAnnotations),
    ),
    vscode.lm.registerTool(
      CREATE_ANNOTATIONS_TOOL,
      new CreateAnnotationsTool(listState, refreshAnnotations),
    ),
  );
}

interface AnnotationToolInput {
  listName?: string;
  createListIfMissing?: boolean;
  filePath: string;
  startLine?: number;
  endLine?: number;
  scope?: AnnotationScope;
  type: AnnotationType;
  comment: string;
}

interface BulkAnnotationToolInput {
  listName?: string;
  createListIfMissing?: boolean;
  annotations: AnnotationToolInput[];
}

interface ResolvedAnnotationDraft {
  workspaceFolder: vscode.WorkspaceFolder;
  draft: AnnotationDraft;
}

interface CreatedAnnotationRecord {
  list: AnnotationList;
  entry: AnnotationEntry;
}

class CreateAnnotationTool implements vscode.LanguageModelTool<AnnotationToolInput> {
  constructor(
    private readonly listState: AnnotationListState,
    private readonly refreshAnnotations: () => void,
  ) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<AnnotationToolInput>,
  ): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Creating annotation for ${path.basename(options.input.filePath)}`,
      confirmationMessages: {
        title: "Create code annotation",
        message: new vscode.MarkdownString(
          buildSingleConfirmationMessage(options.input),
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AnnotationToolInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const resolved = await resolveAnnotationDraft(options.input);
    const list = await resolveTargetList(
      this.listState,
      resolved.workspaceFolder,
      options.input.listName,
      options.input.createListIfMissing,
    );
    const entry = await appendAnnotation(
      resolved.workspaceFolder,
      resolved.draft,
      list.documentUri,
    );

    this.refreshAnnotations();

    return buildToolResult(
      `Created an annotation in ${list.name} for ${formatAnnotationLocation(entry)}.`,
      {
        tool: CREATE_ANNOTATION_TOOL,
        createdCount: 1,
        entries: [serializeCreatedRecord({ list, entry })],
      },
    );
  }
}

class CreateAnnotationsTool implements vscode.LanguageModelTool<BulkAnnotationToolInput> {
  constructor(
    private readonly listState: AnnotationListState,
    private readonly refreshAnnotations: () => void,
  ) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<BulkAnnotationToolInput>,
  ): vscode.PreparedToolInvocation {
    const count = options.input.annotations?.length ?? 0;
    const noun = count === 1 ? "annotation" : "annotations";

    return {
      invocationMessage: `Creating ${count} ${noun}`,
      confirmationMessages: {
        title: `Create ${count} code ${noun}`,
        message: new vscode.MarkdownString(
          buildBulkConfirmationMessage(options.input),
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<BulkAnnotationToolInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const annotations = options.input.annotations;
    if (!Array.isArray(annotations) || annotations.length === 0) {
      throw new Error(
        "Provide at least one annotation in the annotations array.",
      );
    }

    const resolvedDrafts = await Promise.all(
      annotations.map((annotation) => resolveAnnotationDraft(annotation)),
    );
    const listsByWorkspace = await resolveListsForDrafts(
      this.listState,
      resolvedDrafts,
      options.input.listName,
      options.input.createListIfMissing,
    );

    const created: CreatedAnnotationRecord[] = [];
    for (const resolved of resolvedDrafts) {
      const list = listsByWorkspace.get(
        resolved.workspaceFolder.uri.toString(),
      );
      if (!list) {
        throw new Error(
          `Unable to resolve an annotation list for ${resolved.workspaceFolder.name}.`,
        );
      }

      const entry = await appendAnnotation(
        resolved.workspaceFolder,
        resolved.draft,
        list.documentUri,
      );
      created.push({ list, entry });
    }

    this.refreshAnnotations();

    return buildToolResult(buildBulkSummary(created), {
      tool: CREATE_ANNOTATIONS_TOOL,
      createdCount: created.length,
      entries: created.map(serializeCreatedRecord),
    });
  }
}

async function resolveListsForDrafts(
  listState: AnnotationListState,
  drafts: ResolvedAnnotationDraft[],
  listName: string | undefined,
  createListIfMissing: boolean | undefined,
): Promise<Map<string, AnnotationList>> {
  const listsByWorkspace = new Map<string, AnnotationList>();

  for (const draft of drafts) {
    const workspaceKey = draft.workspaceFolder.uri.toString();
    if (listsByWorkspace.has(workspaceKey)) {
      continue;
    }

    listsByWorkspace.set(
      workspaceKey,
      await resolveTargetList(
        listState,
        draft.workspaceFolder,
        listName,
        createListIfMissing,
      ),
    );
  }

  return listsByWorkspace;
}

async function resolveTargetList(
  listState: AnnotationListState,
  workspaceFolder: vscode.WorkspaceFolder,
  listName: string | undefined,
  createListIfMissing: boolean | undefined,
): Promise<AnnotationList> {
  const normalizedName = listName?.trim();
  if (!normalizedName) {
    return listState.resolveActiveList(workspaceFolder);
  }

  const lists = await loadAnnotationLists(workspaceFolder);
  const existing = lists.find(
    (list) => list.name.trim().toLowerCase() === normalizedName.toLowerCase(),
  );
  if (existing) {
    return existing;
  }

  if (!createListIfMissing) {
    throw new Error(
      `Annotation list \"${normalizedName}\" does not exist in ${workspaceFolder.name}. Retry with createListIfMissing=true or use an existing list name.`,
    );
  }

  return createAnnotationList(workspaceFolder, normalizedName);
}

async function resolveAnnotationDraft(
  input: AnnotationToolInput,
): Promise<ResolvedAnnotationDraft> {
  const type = normalizeAnnotationTypeOrThrow(input.type);
  const comment = input.comment?.trim();
  if (!comment) {
    throw new Error("comment must contain a non-empty markdown note.");
  }

  const filePath = input.filePath?.trim();
  if (!filePath) {
    throw new Error("filePath is required.");
  }

  if (!path.isAbsolute(filePath)) {
    throw new Error(
      "filePath must be an absolute path inside an open workspace folder.",
    );
  }

  const documentUri = vscode.Uri.file(filePath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!workspaceFolder) {
    throw new Error(
      `The file ${filePath} is not inside any open workspace folder.`,
    );
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(documentUri);
  } catch {
    throw new Error(`Unable to open ${filePath}. Make sure the file exists.`);
  }

  const scope = resolveRequestedScope(input);
  const relativePath = toPosix(
    path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath),
  );
  const language = normalizeLanguageId(document.languageId);

  if (scope === "file") {
    return {
      workspaceFolder,
      draft: {
        relativePath,
        startLine: 1,
        endLine: Math.max(document.lineCount, 1),
        scope,
        code: "",
        language,
        type,
        comment,
      },
    };
  }

  const maxLine = Math.max(document.lineCount, 1);
  const startLine = ensurePositiveLineNumber(
    input.startLine,
    "startLine is required for selection annotations.",
  );
  const endLine = ensurePositiveLineNumber(input.endLine ?? startLine);

  if (endLine < startLine) {
    throw new Error("endLine must be greater than or equal to startLine.");
  }

  if (startLine > maxLine || endLine > maxLine) {
    throw new Error(
      `${relativePath} has ${maxLine} line${maxLine === 1 ? "" : "s"}; requested range ${startLine}-${endLine} is out of bounds.`,
    );
  }

  const code = extractDocumentLines(document, startLine, endLine);
  if (!code.trim()) {
    throw new Error(
      "Selection annotations must cover at least one non-whitespace line. Use scope='file' for a whole-file note.",
    );
  }

  return {
    workspaceFolder,
    draft: {
      relativePath,
      startLine,
      endLine,
      scope,
      code,
      language,
      type,
      comment,
    },
  };
}

function normalizeAnnotationTypeOrThrow(value: string): AnnotationType {
  if (ANNOTATION_TYPE_VALUES.has(value as AnnotationType)) {
    return value as AnnotationType;
  }

  throw new Error(
    `type must be one of: ${Array.from(ANNOTATION_TYPE_VALUES).join(", ")}.`,
  );
}

function resolveRequestedScope(input: {
  scope?: AnnotationScope;
  startLine?: number;
  endLine?: number;
}): AnnotationScope {
  if (input.scope !== undefined) {
    const normalized = normalizeAnnotationScope(input.scope);
    if (!normalized) {
      throw new Error("scope must be either 'selection' or 'file'.");
    }

    return normalized;
  }

  return input.startLine === undefined && input.endLine === undefined
    ? "file"
    : "selection";
}

function ensurePositiveLineNumber(
  value: number | undefined,
  message = "Line numbers must be positive integers.",
): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    throw new Error(message);
  }

  return value as number;
}

function extractDocumentLines(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
): string {
  const range = new vscode.Range(
    new vscode.Position(startLine - 1, 0),
    document.lineAt(endLine - 1).range.end,
  );
  return document.getText(range).trimEnd();
}

function buildSingleConfirmationMessage(input: AnnotationToolInput): string {
  return [
    "Create an annotation in the workspace annotations document?",
    "",
    `- File: ${input.filePath}`,
    `- Target: ${describeRequestedTarget(input)}`,
    `- Type: ${input.type}`,
    `- List: ${input.listName?.trim() || "active list"}`,
    input.createListIfMissing
      ? "- Missing list handling: create it automatically"
      : "- Missing list handling: fail if the named list does not exist",
  ].join("\n");
}

function buildBulkConfirmationMessage(input: BulkAnnotationToolInput): string {
  const preview = input.annotations
    .slice(0, 5)
    .map(
      (annotation) =>
        `- ${annotation.filePath} (${describeRequestedTarget(annotation)})`,
    );
  if (input.annotations.length > preview.length) {
    preview.push(`- ...and ${input.annotations.length - preview.length} more`);
  }

  return [
    `Create ${input.annotations.length} annotations in the workspace annotations document?`,
    "",
    `- List: ${input.listName?.trim() || "active list per workspace"}`,
    input.createListIfMissing
      ? "- Missing list handling: create it automatically"
      : "- Missing list handling: fail if the named list does not exist",
    "",
    ...preview,
  ].join("\n");
}

function describeRequestedTarget(input: {
  scope?: AnnotationScope;
  startLine?: number;
  endLine?: number;
}): string {
  const scope = resolveRequestedScope(input);
  if (scope === "file") {
    return "whole file";
  }

  const startLine = input.startLine ?? 1;
  const endLine = input.endLine ?? startLine;
  return startLine === endLine
    ? `line ${startLine}`
    : `lines ${startLine}-${endLine}`;
}

function buildBulkSummary(created: CreatedAnnotationRecord[]): string {
  const preview = created
    .slice(0, 8)
    .map(
      ({ list, entry }) =>
        `- ${formatAnnotationLocation(entry)} -> ${list.name}`,
    );
  if (created.length > preview.length) {
    preview.push(`- ...and ${created.length - preview.length} more`);
  }

  return [
    `Created ${created.length} annotation${created.length === 1 ? "" : "s"}.`,
    "",
    ...preview,
  ].join("\n");
}

function buildToolResult(
  summary: string,
  data: Record<string, unknown>,
): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(summary),
    vscode.LanguageModelDataPart.json(data),
  ]);
}

function serializeCreatedRecord({
  list,
  entry,
}: CreatedAnnotationRecord): Record<string, unknown> {
  return {
    listName: list.name,
    listPath: list.relativePath,
    relativePath: entry.relativePath,
    startLine: entry.startLine,
    endLine: entry.endLine,
    scope: entry.scope,
    type: entry.type,
    comment: entry.comment,
    addedAt: entry.addedAt,
  };
}
