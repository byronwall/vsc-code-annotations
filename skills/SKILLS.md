# Code Annotations Skill

Use this skill when you need to turn a code review, audit, or backlog into one or more annotation entries for this repository.

## Preferred workflow

- If the VS Code extension tools are available, prefer `create_code_annotations` for a review batch and `create_code_annotation` for a one-off finding.
- The tools accept absolute file paths, validate line ranges, derive the stored code snippet from the current file contents, and write the canonical markdown format for you.
- Only write the markdown files directly when those tools are unavailable.

## Storage layout

- The default annotations document comes from the `codeAnnotations.documentPath` VS Code setting.
- If no custom setting is present, the default path is `.annotations/code-annotations.md`.
- Named annotation lists live in a sibling `lists/` directory next to the default document path.
- With the default configuration, named lists live under `.annotations/lists/`.
- Paths stored inside annotation entries are always repo-relative to the workspace root and always use forward slashes.

## Named list files

- The default list title is `# Code Annotations`.
- A named list title is `# Code Annotations: <List Name>`.
- If you create a named list manually, use an ASCII kebab-case file name that matches the list name, for example `.annotations/lists/review-auth-flow.md`.
- The extension slugifies list file names by lowercasing, replacing non-alphanumeric runs with `-`, trimming outer dashes, and adding `-2`, `-3`, and so on when a file name collides.
- If you are using the extension tools, pass `listName` and `createListIfMissing: true` instead of manually creating the file.

## Canonical document header

Use one of these headers exactly:

```md
# Code Annotations

Saved code refs and markdown comments live here for later AI-assisted work.
Paths in each Code Ref section are repo-relative to the workspace root.
```

```md
# Code Annotations: Review - Authentication

Saved code refs and markdown comments live here for later AI-assisted work.
Paths in each Code Ref section are repo-relative to the workspace root.
```

## Canonical entry format

Write new entries in this exact shape:

````md
## [issue] src/example.ts:12-18

Added: 2026-05-11T20:15:30.000Z
Type: issue

### Comment

Explain the finding in markdown.

State the risk, rationale, or next step.

### Code ref

Path: src/example.ts
Scope: selection
Lines: 12-18

```ts
const value = computeThing();
return value;
```
````

## Required field rules

- The heading must be `## [<type>] <path>:<line>` or `## [<type>] <path>:<start>-<end>`.
- `Added` must be an ISO 8601 UTC timestamp in the same shape as `new Date().toISOString()`.
- `Type` must exactly match the heading type.
- Valid types are `follow-up`, `issue`, `question`, `idea`, and `context`.
- `Path` must be repo-relative and use `/`, never an absolute path.
- `Scope` must be `selection` or `file`.
- `Lines` are 1-based and inclusive.
- `### Comment` contains markdown and may span multiple paragraphs.
- `### Code ref` must contain `Path`, `Scope`, `Lines`, and a fenced code block.

## Code block rules

- For `selection` annotations, store the current source text for the referenced lines.
- Trim only trailing newlines and trailing whitespace from the captured code block. Do not reindent or rewrite the code.
- For `file` annotations, keep the whole-file line range, set `Scope: file`, and leave the fenced code block empty. Do not paste the entire file contents.
- If the stored code contains triple backticks, switch the fence to four backticks.
- Preserve the language identifier when it is known, for example `ts`, `tsx`, `js`, `json`, or `md`.

Whole-file example:

````md
## [context] src/extension.ts:1-190

Added: 2026-05-11T20:20:00.000Z
Type: context

### Comment

This file owns extension activation and command wiring.

### Code ref

Path: src/extension.ts
Scope: file
Lines: 1-190

```ts

```
````

## Append rules

- Append new entries to the end of the document.
- Leave a blank line between entries.
- Keep the header text intact.
- Do not sort or rewrite existing entries unless explicitly asked.

## Legacy compatibility

- The parser still accepts older markdown documents such as a repo-root `code-annotations.md` file.
- Older files might omit `Scope` or use older metadata layouts.
- Do not generate the legacy format for new work.
- Do not migrate or rewrite legacy files unless explicitly asked.

## Agent playbook

1. Prefer `create_code_annotations` for a full review and `create_code_annotation` for one finding.
2. Give those tools absolute file paths.
3. If you must write markdown directly, use the configured annotations path or `.annotations/code-annotations.md` when no custom path is known.
4. For a dedicated review file, create a named list under `.annotations/lists/` or the sibling `lists/` directory for the configured document path.
5. Use `selection` when the finding points to a concrete span of code.
6. Use `file` only for true whole-file notes.
7. Keep comments actionable: what is wrong, why it matters, and what should happen next.

## Tool input examples

Single annotation:

```json
{
  "listName": "Review - Authentication",
  "createListIfMissing": true,
  "filePath": "/Users/byronwall/repos/vsc-code-annotations/src/extension.ts",
  "startLine": 24,
  "endLine": 37,
  "type": "issue",
  "comment": "The activation path mixes tree refresh wiring with command registration. Split the refresh callback once and reuse it so future changes do not drift across handlers."
}
```

Bulk review annotations:

```json
{
  "listName": "Review - May 2026",
  "createListIfMissing": true,
  "annotations": [
    {
      "filePath": "/Users/byronwall/repos/vsc-code-annotations/src/extension.ts",
      "startLine": 24,
      "endLine": 37,
      "type": "follow-up",
      "comment": "Keep the refresh callback in one local variable so new command handlers reuse the same invalidation path."
    },
    {
      "filePath": "/Users/byronwall/repos/vsc-code-annotations/src/annotations/storage.ts",
      "startLine": 30,
      "endLine": 59,
      "type": "context",
      "comment": "This function is the append path for canonical markdown entries. Any direct file writer should preserve its exact field names and spacing."
    }
  ]
}
```

## Decision rule

- Prefer the extension tools when available.
- Fall back to direct markdown authoring only when the tool surface is unavailable.
- When writing markdown directly, always emit the canonical format shown above, not the legacy one.
