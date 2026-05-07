# Code Annotations

Code Annotations is a VS Code extension prototype for capturing code selections into a workspace markdown document. The generated document is meant to be readable by humans and easy to hand to an AI agent as an implementation backlog.

## Features

- Capture the current editor selection as an annotation.
- Choose an annotation type from a small quick-pick flow.
- Add a comment with the file, line range, and code snippet already in context.
- Append structured markdown entries to a workspace document.
- Review saved annotations from a sidebar and jump back to the original source range.

## Commands

- `Code Annotations: Add Annotation` (`codeAnnotations.addAnnotation`)
- `Code Annotations: Open Annotations Sidebar` (`codeAnnotations.openAnnotationsSidebar`)
- `Code Annotations: Open Annotations Document` (`codeAnnotations.openAnnotationsDocument`)
- `Code Annotations: Refresh Annotations` (`codeAnnotations.refresh`)

## Setting

### `codeAnnotations.documentPath`

- Type: `string`
- Default: `code-annotations.md`
- Meaning: Workspace-relative markdown file used to store saved annotations.

## Markdown Format

Each saved annotation is appended as a stable markdown block:

````md
## [follow-up] src/extension.ts:12-18

- File: src/extension.ts
- Lines: 12-18
- Type: follow-up
- Comment: Replace the old activation path with the new annotation flow
- Added: 2026-05-07T15:00:00.000Z

```ts
const provider = new AnnotationTreeProvider(resolveActiveWorkspaceFolder);
```
````

The sidebar parser depends on this structure, so append and parse logic should be changed together.

## Development

```bash
pnpm install
pnpm run compile
pnpm run watch
pnpm run dev:host
```

## Packaging

```bash
pnpm run build:install
```

## Extension Layout

- `src/extension.ts` - activation, command wiring, selection capture, and source navigation
- `src/annotations.ts` - markdown persistence, parsing, and sidebar tree items
