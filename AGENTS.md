# Copilot Instructions for vsc-code-annotations

## Big picture architecture

- This is a VS Code extension with an extension-host-only runtime.
- `src/extension.ts` owns activation, command registration, selection capture, and sidebar refresh wiring.
- `src/annotations.ts` owns the annotations document path, markdown append format, parsing, and tree item rendering.

## Code quality

- Aim to keep files below 200-300 LOC. If we go beyond that, we should proactively refactor into smaller files that are easier to review/compose.

## Critical workflows

- Install deps: `pnpm install`
- Validate extension code: `pnpm run compile`
- Dev loop: `pnpm run watch` and `pnpm run dev:host`
- Package/install locally: `pnpm run build:install`

## Project-specific patterns

- Keep activation command-driven; avoid eager startup for the prototype.
- Keep annotation persistence human-readable markdown and parser-stable.
- When the markdown entry format changes, update append and parse logic together in `src/annotations.ts`.
- Store annotations in a workspace-relative markdown file rather than global extension storage.
- Prefer native VS Code input flows and tree views before introducing a webview.

## Integration points to keep stable

- Commands and view IDs are declared in `package.json` and implemented in `src/extension.ts`; keep them aligned.
- The markdown block format in `src/annotations.ts` is the contract between capture, persistence, and sidebar parsing.
- Tree item clicks should keep reopening the referenced source selection.
