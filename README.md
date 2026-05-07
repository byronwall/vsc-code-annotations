# Code Annotations

Code Annotations is a VS Code extension prototype for capturing code selections into a workspace markdown document. The generated document is meant to be readable by humans and easy to hand to an AI agent as an implementation backlog.

## Features

- Capture the current editor selection as an annotation.
- Choose an annotation type from a small quick-pick flow.
- Add a comment with the file, line range, and code snippet already in context.
- Append structured markdown entries to a workspace document.
- Review saved annotations from a sidebar, jump back to the best current source match, and repair stale code refs inline.
- See inline annotation lenses directly in annotated source files, including a file summary at the top of the file.
- Use `Cmd+Shift+0` or `Cmd+Shift+Numpad0` on macOS to add an annotation from the current selection.

## Commands

- `Code Annotations: Add Annotation` (`codeAnnotations.addAnnotation`)
- `Code Annotations: Fix Annotation Code Ref` (`codeAnnotations.fixAnnotationLocation`)
- `Code Annotations: Open Annotations Sidebar` (`codeAnnotations.openAnnotationsSidebar`)
- `Code Annotations: Open Annotations Document` (`codeAnnotations.openAnnotationsDocument`)
- `Code Annotations: Refresh Annotations` (`codeAnnotations.refresh`)

## Setting

### `codeAnnotations.documentPath`

- Type: `string`
- Default: `.annotations/code-annotations.md`
- Meaning: Workspace-relative markdown file used to store saved annotations. The paths stored inside each code ref are repo-relative to the workspace root.

When the document lives under `.annotations/`, the extension adds `.annotations/` to the repo root `.gitignore` if that file exists and does not already contain an active or commented-out entry for it.

## Markdown Format

Each saved annotation is appended as a stable markdown block. Comments are stored as markdown, and the parser tolerates round-trip formatting changes better than the original bullet-only format.

````md
## [follow-up] src/extension.ts:12-18

Added: 2026-05-07T15:00:00.000Z
Type: follow-up

### Comment

Replace the old activation path with the new annotation flow.

Keep the surrounding command wiring simple.

### Code ref

Path: src/extension.ts
Lines: 12-18

```ts
const provider = new AnnotationTreeProvider(resolveActiveWorkspaceFolder);
```
````

The document header also calls out that `Path` values are repo-relative to the workspace root.

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
