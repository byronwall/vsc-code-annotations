export function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

export function selectFence(code: string): string {
  return code.includes("```") ? "````" : "```";
}

export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function trimBlankLines(lines: string[]): string[] {
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

export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeLanguageId(
  languageId: string | undefined,
): string | undefined {
  if (!languageId || languageId === "plaintext") {
    return undefined;
  }

  return languageId;
}

export function normalizeCodeForStorage(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

export function normalizeForMatching(value: string): string {
  return normalizeCodeForStorage(value).replace(/\s+/g, " ").trim();
}

export function countCodeLines(value: string): number {
  return normalizeCodeForStorage(value).split("\n").length;
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
}

export function truncateForLabel(value: string, limit = 72): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}...`;
}
