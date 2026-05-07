# Code Annotations

This file stores code selections, annotation types, and markdown comments for later AI-assisted implementation work.

Paths in each Code Ref section are repo-relative to the workspace root.

## [follow-up] package.json:145-149

Added: 2026-05-07T13:25:53.384Z
Type: follow-up

### Comment

What is all this doing, and how so?

### Code ref

Path: package.json
Lines: 145-149

```json
"typecheck": "tsc -p ./ --noEmit",
        "compile": "pnpm run typecheck && pnpm run bundle:extension",
        "watch": "tsc -watch -p ./",
        "package:vsix": "pnpm run compile && vsce package --no-dependencies -o vsc-code-annotations.vsix",
        "publish:vsix": "vsce publish --packagePath vsc-code-annotations.vsix",
```
