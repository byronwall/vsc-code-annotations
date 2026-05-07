# Code Annotations

This file stores code selections, annotation types, and comments for later AI-assisted implementation work.

## [follow-up] package.json:118-122
- File: package.json
- Lines: 118-122
- Type: follow-up
- Comment: What is all this doing?
- Added: 2026-05-07T13:25:53.384Z

```json
"typecheck": "tsc -p ./ --noEmit",
        "compile": "pnpm run typecheck && pnpm run bundle:extension",
        "watch": "tsc -watch -p ./",
        "package:vsix": "pnpm run compile && vsce package --no-dependencies -o vsc-code-annotations.vsix",
        "publish:vsix": "vsce publish --packagePath vsc-code-annotations.vsix",
```
