# Visual Parity MCP

Visual Parity MCP compares a reference web page against a candidate web page and writes screenshot, pixel-diff, and computed-style reports.

It is designed for website rebuilds, CMS migrations, framework rewrites, landing page QA, and agent-assisted visual parity work where you need concrete browser-rendered evidence instead of manual screenshot inspection.

## Features

- MCP stdio server: `visual-parity-mcp`
- CLI: `visual-parity`
- Playwright Chromium page capture
- Pixel-level screenshot diffs with configurable thresholds
- Computed style, text, and bounding-box diffs by selector
- Basic stylesheet provenance for matched computed-style rules
- Root-cause clustering for repeated style/layout diffs
- Cross-page aggregation for route comparisons
- Broken-page detection for HTTP errors, empty bodies, and missing landmarks
- Per-project accepted deviations through `.visual-parity.json`
- HTML and JSON reports
- Noisy-element masking with custom selectors
- Built-in `hubspot` preset for common HubSpot and CookieYes page noise
- Built-in `nextjs-fonts` preset for next/font fallback font-family noise
- Built-in `dev-toolbars` preset for local feedback/debug toolbar overlays
- Configurable Playwright `waitUntil` behavior for local dev servers

## Requirements

- Node.js 20 or newer
- Playwright Chromium

If Chromium is not already installed, run:

```bash
npx playwright install chromium
```

## Install

Use directly with `npx`:

```bash
npx -y -p visual-parity-mcp visual-parity compare \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about
```

Or install globally:

```bash
npm install -g visual-parity-mcp
visual-parity --help
visual-parity-mcp
```

## MCP Setup

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "visual-parity": {
      "command": "npx",
      "args": ["-y", "visual-parity-mcp"]
    }
  }
}
```

For a local source checkout, build first:

```bash
npm install
npm run build
```

Then configure the built server:

```json
{
  "mcpServers": {
    "visual-parity": {
      "command": "node",
      "args": ["/absolute/path/to/visual-parity-mcp/dist/mcp.js"]
    }
  }
}
```

Restart your MCP client after changing the config.

## MCP Tools

### `compare_pages`

Compare one reference URL against one candidate URL.

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "outputDir": ".visual-parity/reports",
  "name": "about",
  "viewport": {
    "width": 1440,
    "height": 1200,
    "deviceScaleFactor": 1
  },
  "fullPage": false,
  "waitUntil": "domcontentloaded",
  "waitMs": 1000,
  "timeoutMs": 30000,
  "threshold": 0.1,
  "maxDiffPercent": 1,
  "selectors": ["header", "main", "h1", ".hero", ".cta"],
  "hideSelectors": [".cookie-banner", ".chat-widget"],
  "presets": ["hubspot", "nextjs-fonts"],
  "acceptedDeviations": [
    { "selector": "header", "property": "position", "reason": "Intentional sticky chrome" }
  ],
  "compareStyles": true
}
```

The response includes pass/fail status, pixel diff percentage, report paths, screenshot paths, style diff counts, top root-cause clusters, suggested fixes when available, and remaining raw examples.

### `compare_routes`

Compare multiple paths under a reference and candidate base URL.

```json
{
  "referenceBaseUrl": "https://example.com",
  "candidateBaseUrl": "http://localhost:3000",
  "paths": ["/", "/about", "/pricing"],
  "waitUntil": "domcontentloaded",
  "presets": ["hubspot", "nextjs-fonts"]
}
```

Route summaries include `crossPageFindings`, sorted by impact, so global issues such as box sizing, shared footer typography, or repeated spacing drift rise above page-by-page noise.

### `inspect_selector`

Inspect one selector across reference and candidate pages.

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "selector": ".hero",
  "waitUntil": "domcontentloaded"
}
```

Legacy field names are still accepted for compatibility:

```json
{
  "liveUrl": "https://example.com/about",
  "localUrl": "http://localhost:3000/about"
}
```

## CLI Usage

### Compare One Page

```bash
visual-parity compare \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --wait-until domcontentloaded \
  --selector header \
  --selector main \
  --selector h1 \
  --selector ".hero" \
  --selector ".cta"
```

### Compare Multiple Routes

```bash
visual-parity routes \
  --reference-base https://example.com \
  --candidate-base http://localhost:3000 \
  --wait-until domcontentloaded \
  --path / \
  --path /about \
  --path /pricing
```

### Inspect One Selector

```bash
visual-parity inspect \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --selector ".hero" \
  --wait-until domcontentloaded
```

## Common Options

```text
--reference <url>           Reference/source URL
--candidate <url>           Candidate/target URL
--live <url>                Legacy alias for --reference
--local <url>               Legacy alias for --candidate
--out <dir>                 Output directory, default .visual-parity/reports
--name <slug>               Run name
--width <px>                Viewport width, default 1440
--height <px>               Viewport height, default 1200
--dpr <number>              Device scale factor, default 1
--full-page                 Capture full-page screenshots
--wait-until <state>        Navigation readiness state, default networkidle
--wait-ms <ms>              Extra wait after page load, default 1000
--timeout-ms <ms>           Navigation timeout, default 30000
--threshold <number>        pixelmatch threshold, default 0.1
--max-diff-percent <num>    Failure threshold, default 1.0
--selector <css>            Repeatable selector for style/layout extraction
--hide <css>                Repeatable selector to hide before screenshot
--config <file>             Config file, default .visual-parity.json
--preset <name>             Repeatable preset bundle; currently: hubspot, nextjs-fonts, dev-toolbars
--no-styles                 Disable computed-style extraction
--json                      Print compact JSON only
```

## Root-Cause Analysis

Style/layout diffs are analyzed before reports are written:

- repeated diffs are clustered by `kind`, `property`, reference value, and candidate value
- four matching `border-*-color` diffs on the same element collapse into one `border-color` diff
- next/font fallback font-family entries such as `"Inter Fallback"` are stripped before comparison
- accepted deviations are filtered out
- width/height layout diffs are kept but lower-prioritized because they are often downstream symptoms
- common fixes are synthesized for high-signal clusters such as missing `box-sizing: border-box`
- same-origin stylesheets and inline styles are reported as provenance using a cascade-aware rule winner when the browser can read matching CSS rules
- root-cause displays prioritize repeated findings and summarize hidden one-off tail findings
- hidden preset elements are excluded from style snapshots as well as screenshots
- `color` comparison uses effective text fill when pages rely on `-webkit-text-fill-color`

Instead of reading dozens of repeated entries, the report can now show a single finding such as:

```text
style box-sizing: reference=border-box candidate=content-box (45 diffs)
fix: Add `*, *::before, *::after { box-sizing: border-box; }` to the candidate global CSS.
```

## Project Config

Create `.visual-parity.json` in the working directory to permanently suppress intentional or known-noisy diffs:

```json
{
  "acceptedDeviations": [
    {
      "selector": "header",
      "property": "position",
      "reason": "Intentional sticky chrome"
    },
    {
      "selector": "*",
      "property": "font-family",
      "pattern": ".*Fallback.*",
      "reason": "Ignore generated next/font fallback families"
    }
  ]
}
```

Accepted deviations support:

- `selector`: exact selector or `*` wildcard
- `property`: CSS/style property, rect property, or `text`
- `kind`: one of `count`, `style`, `rect`, or `text`
- `pattern`: regex matched against either reference or candidate value
- `reason`: documentation-only note

## Navigation Readiness

The default navigation readiness state is `networkidle`.

For local development servers such as `next dev` or Vite dev mode, use:

```bash
--wait-until domcontentloaded
```

Persistent HMR websocket connections can keep dev pages from ever reaching `networkidle`, which causes navigation timeouts. `domcontentloaded` is usually the right option for local iteration. Production and preview URLs often work well with the default `networkidle`.

Before every screenshot, the browser pass now freezes animations/transitions, waits for fonts and decodable images, scrolls back to the top, closes open `details`/`dialog` elements, and waits for an idle frame. The run hard-fails before writing a misleading comparison if either page returns HTTP 4xx/5xx, has an empty body, or exposes no landmark/content selectors.

Accepted values:

- `commit`
- `domcontentloaded`
- `load`
- `networkidle`

## Reports

Each comparison writes a run directory containing:

```text
live.png       Reference screenshot
local.png      Candidate screenshot
diff.png       Pixel difference image
report.json    Full machine-readable report
report.html    Human-readable report
```

The JSON report includes:

- reference and candidate URLs
- viewport settings
- screenshot paths
- diff dimensions and mismatch count
- `diffPercent`
- pass/fail result based on `maxDiffPercent`
- computed-style, layout, and text diffs for selected elements
- style-rule provenance on style diffs when available
- root-cause clusters under `styles.analysis.clusters`
- route-level cross-page clusters under `crossPageFindings`

Artifact names still use `live` and `local` for backward compatibility.

By default, reports are written under `.visual-parity/reports` in the current working directory. Use `--out` or `outputDir` to put them somewhere else.

## HubSpot Preset

Use the HubSpot preset when comparing HubSpot-backed pages:

```bash
visual-parity compare \
  --reference https://old-site.com/pricing \
  --candidate http://localhost:3000/pricing \
  --preset hubspot \
  --wait-until domcontentloaded
```

The preset adds common content selectors and masks common noisy elements such as HubSpot/CookieYes cookie banners and `.cky-*` controls, HubSpot forms, chat widgets, CAPTCHA badges, and aria-live regions. Broad class selectors for card/module elements use whole-class matching, so project-specific names such as `feature-card__item` or `home-hero__module` do not explode into count noise just because they contain those words.

You can add more masks with `--hide` or `hideSelectors`.

## Suggested Workflow

1. Start the candidate app or identify a preview URL.
2. Run one page comparison.
3. Open `report.html` and inspect `diff.png`.
4. Use `report.json` or the MCP response to identify the largest style/layout differences.
5. Fix the candidate page.
6. Re-run the comparison.
7. Repeat until the remaining differences are acceptable.

For Next.js local development, include `waitUntil: "domcontentloaded"` in MCP calls or `--wait-until domcontentloaded` in CLI calls.

## Exit Codes

```text
0    Command completed and visual diff passed the configured threshold
1    Command failed due to an error such as bad input, navigation failure, or missing browser
2    Command completed but visual diff exceeded the configured threshold
```

## Development

```bash
npm install
npm run build
npm run smoke
```

Useful local commands:

```bash
npm run compare -- --help
npm run routes -- --help
npm run inspect -- --help
npm run dev:mcp
```

The smoke fixture intentionally produces a visual diff. The smoke script treats CLI exit code `2` as success because it confirms the comparison completed and reported the expected threshold failure.

## Publishing

Before publishing:

```bash
npm ci
npm run build
npm run smoke
npm pack --dry-run
```

Publish a patch release:

```bash
npm version patch
npm publish --access public
```

After publishing, verify the package through `npx`:

```bash
npx -y -p visual-parity-mcp visual-parity --help
npx -y -p visual-parity-mcp visual-parity compare --help
```

Then restart MCP clients that use:

```json
{
  "command": "npx",
  "args": ["-y", "visual-parity-mcp"]
}
```

If an MCP client appears to keep using an old package version, clear its npx/npm cache or temporarily pin the new version:

```json
{
  "command": "npx",
  "args": ["-y", "visual-parity-mcp@0.1.1"]
}
```

Replace `0.1.1` with the version you published.

## License

MIT
