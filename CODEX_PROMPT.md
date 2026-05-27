# Codex task: build Visual Parity MCP + CLI

You are working in `/home/dylan/Projects/visual-parity-mcp`, a TypeScript Node project scaffolded for a visual QA tool.

## Why this exists

Dylan is migrating a HubSpot site to Sanity + Next.js. Claude/Codex keep attempting to match the original HubSpot design 1:1, but HubSpot's CSS is a swamp-ass dumpster fire: many CSS files, global cascade, module wrappers, generated classnames, and styles that cannot simply be copied into Next.js. The useful tool is NOT “copy CSS.” The useful tool is an automated visual parity inspector that compares the live HubSpot page to the localhost Next.js page and gives an AI coding agent concrete evidence about what is visually wrong.

Build a local toolset that Claude/Codex can use to compare:

- live source URL, e.g. `https://old-site.com/some-page`
- local migration URL, e.g. `http://localhost:3000/some-page`

The output should help an AI agent fix the Next.js/Sanity implementation until it visually matches the live HubSpot site.

## Deliverables

Build both:

1. A CLI binary: `visual-parity`
2. An MCP stdio server: `visual-parity-mcp`

Existing scaffold files:

- `package.json`
- `tsconfig.json`
- `src/types.ts`
- `src/defaults.ts`
- `examples/claude-mcp.json`

Implement the missing source files and update package scripts/docs as needed.

## Core idea

Use Playwright to load both pages in Chromium with the same viewport. Stabilize the page. Screenshot both. Normalize screenshot dimensions. Run pixel diff with `pixelmatch`. Also extract computed styles and bounding boxes for important selectors so the agent gets exact CSS/property-level differences instead of just “pixels differ lol good luck.”

This needs to be useful for an AI coding agent, not just a human QA screenshot.

## CLI commands

### `visual-parity compare`

Compare one live URL against one local URL.

Required args:

- `--live <url>`
- `--local <url>`

Options:

- `--out <dir>` default `reports/visual-parity`
- `--name <slug>` optional run name
- `--width <px>` default `1440`
- `--height <px>` default `1200`
- `--dpr <number>` default `1`
- `--full-page` default false
- `--wait-ms <ms>` default `1000`
- `--timeout-ms <ms>` default `30000`
- `--threshold <number>` default `0.1` pixelmatch threshold
- `--max-diff-percent <number>` default `1.0`
- `--selector <css>` repeatable; if omitted use default selectors from `src/defaults.ts`
- `--hide <css>` repeatable; hide dynamic/noisy elements before screenshots
- `--no-styles` disable computed style extraction
- `--json` print machine-readable JSON only

Outputs:

- `<runDir>/live.png`
- `<runDir>/local.png`
- `<runDir>/diff.png`
- `<runDir>/report.json`
- `<runDir>/report.html`

Exit code:

- `0` if visual diff percent <= `maxDiffPercent`
- `2` if comparison completed but failed threshold
- nonzero other codes for actual errors

### `visual-parity routes`

Compare many routes under two base URLs.

Required args:

- `--live-base <url>`
- `--local-base <url>`
- either `--path <path>` repeatable OR `--paths-file <file>` with newline-separated paths

Same viewport/wait/selector/hide options as `compare`.

Outputs:

- one subdirectory per route
- aggregate `summary.json`
- aggregate `summary.html`

### `visual-parity inspect`

Deep inspect a selector on both pages.

Required args:

- `--live <url>`
- `--local <url>`
- `--selector <css>`

Outputs JSON with:

- count of matches on each page
- for each matched element index:
  - tag name
  - trimmed text sample
  - bounding box
  - screenshot crop paths if feasible
  - computed styles for important properties
  - style diffs
  - rect diffs

## MCP tools

Use `@modelcontextprotocol/sdk` and expose at least these tools:

### `compare_pages`

Input schema mirrors CLI compare:

```json
{
  "liveUrl": "https://...",
  "localUrl": "http://localhost:3000/...",
  "outputDir": "reports/visual-parity",
  "name": "homepage",
  "viewport": { "width": 1440, "height": 1200, "deviceScaleFactor": 1 },
  "fullPage": false,
  "waitMs": 1000,
  "threshold": 0.1,
  "maxDiffPercent": 1,
  "selectors": ["header", "h1", ".hero"],
  "hideSelectors": [".chat-widget", "[data-test='timestamp']"],
  "compareStyles": true
}
```

Return compact JSON containing:

- pass/fail
- diffPercent
- screenshot paths
- report paths
- top style/rect/text diffs, capped to avoid huge tool output

### `compare_routes`

Input:

```json
{
  "liveBaseUrl": "https://...",
  "localBaseUrl": "http://localhost:3000",
  "paths": ["/", "/about"],
  "outputDir": "reports/visual-parity"
}
```

Return aggregate summary and report paths.

### `inspect_selector`

Input mirrors CLI inspect. Return JSON summary and crop/report paths.

## Implementation requirements

### Playwright page stabilization

Create reusable helpers:

- launch Chromium headless
- create browser context with viewport/deviceScaleFactor
- goto URL with timeout and `waitUntil: 'networkidle'` by default, but allow override
- inject CSS/JS before screenshots to reduce noise:
  - disable animations/transitions/caret blinking
  - force `scroll-behavior: auto`
  - optionally hide user-provided selectors with `visibility: hidden !important`
- wait extra `waitMs`
- screenshot

Suggested CSS:

```css
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
```

### Screenshot normalization

If screenshots differ in dimensions, create same-size canvases using `sharp` or `pngjs` before pixelmatch. Do not crash just because one page is taller/wider. Composite each onto a transparent/white background and diff equal dimensions.

### Computed styles

Implement `captureStyleSnapshots(page, selectors, properties, maxElementsPerSelector)`.

For each selector:

- query all matching elements, capped
- collect:
  - tagName
  - text sample
  - `getBoundingClientRect()`
  - computed style values for properties

Implement `diffStyleSnapshots(live, local)`.

Detect:

- different element counts
- rect differences beyond a small tolerance, e.g. 1px
- style property differences
- text differences for short obvious mismatches

Cap diffs in tool/CLI display, but save full diffs in `report.json`.

### HTML reports

Generate simple self-contained HTML:

- page title with live/local URLs
- pass/fail, diff percent, mismatched pixels
- side-by-side screenshots: live, local, diff
- top style diffs list
- paths to artifacts

No fancy framework needed. Just write HTML string. Make it dark themed and readable.

### Error handling

- If local dev server is not reachable, fail with a clear message.
- If a selector is invalid, capture an error for that selector but do not kill the entire run unless all selectors fail.
- If Playwright browser binaries are missing, print a message telling user to run `npx playwright install chromium`.
- Do not dump massive HTML or screenshots into stdout.

### Agent usability

Make console output useful:

Example human output:

```text
Visual parity: FAIL
Live:  https://old-site.com/
Local: http://localhost:3000/
Diff:  4.82% (max 1.00%)
Artifacts:
  report: reports/visual-parity/homepage/report.html
  diff:   reports/visual-parity/homepage/diff.png
Top diffs:
  header[0] rect.height live=88 local=72 delta=-16
  h1[0] font-size live=64px local=56px
  .hero[0] padding-top live=96px local=72px
```

MCP output should be compact and JSON-safe.

## Suggested source layout

Implement:

- `src/compare.ts` core compare functions
- `src/browser.ts` Playwright capture helpers
- `src/styles.ts` computed style capture/diff
- `src/report.ts` JSON/HTML report writer
- `src/routes.ts` multi-route runner
- `src/cli.ts` commander CLI
- `src/mcp.ts` MCP stdio server
- update `src/types.ts` if needed

## Dependencies already declared

- `@modelcontextprotocol/sdk`
- `commander`
- `pixelmatch`
- `playwright`
- `pngjs`
- `sharp`
- `zod`
- `tsx`, `typescript`

Update versions or types only if necessary.

## Testing / verification

After implementation:

1. Run `npm install`.
2. Run `npm run build`.
3. Run `node dist/cli.js --help`.
4. If Playwright browsers are missing, run `npx playwright install chromium`.
5. Create a tiny local smoke test fixture if helpful:
   - two static HTML pages served locally
   - compare them
   - verify report files are written and non-empty
6. Document exact commands in README.

## README docs

Add README with:

- what problem this solves
- installation
- CLI examples
- MCP config examples for Claude Desktop / Claude Code / Codex-compatible MCP clients
- recommended migration workflow:
  1. start Next.js localhost
  2. run compare against live HubSpot URL
  3. inspect failed selectors
  4. fix styles in Next.js
  5. repeat until diff passes
- tips for HubSpot noise:
  - hide chat widgets, cookie banners, rotating hero content, dates, carousels
  - use fixed viewport sizes
  - compare route by route
  - focus on top layout/text/style diffs, not copying HubSpot CSS

## Important constraints

- Keep it local-first. No external SaaS.
- Do not require copying HubSpot CSS.
- Do not require modifying either site.
- Avoid giant tool outputs. Save artifacts to files; return summaries.
- Make this pleasant for coding agents. The whole point is to give agents a tight visual QA loop instead of Dylan manually screaming at pixels like a cursed optometrist.

When done, commit the result locally with a clear commit message if this directory is a git repo. If it is not a git repo, initialize one first.
