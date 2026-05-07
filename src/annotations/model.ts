export const DEFAULT_DOCUMENT_PATH = ".annotations/code-annotations.md";
export const ANNOTATIONS_DIRECTORY = ".annotations";
export const ANNOTATIONS_GITIGNORE_ENTRY = ".annotations/";

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

export function getAnnotationTypeOptions(): AnnotationTypeOption[] {
  return ANNOTATION_TYPES.map(({ value, label, description }) => ({
    value,
    label,
    description,
  }));
}

export function normalizeAnnotationType(
  value: string,
): AnnotationType | undefined {
  const normalized = value.trim().toLowerCase();
  return ANNOTATION_TYPES.find((option) => option.value === normalized)?.value;
}

export function resolveTypeIcon(type: AnnotationType): string {
  return (
    ANNOTATION_TYPES.find((option) => option.value === type)?.icon ?? "note"
  );
}
