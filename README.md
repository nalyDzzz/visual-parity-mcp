# Visual Parity MCP

Visual Parity MCP compares a reference web page against a candidate web page and writes screenshot, pixel-diff, and computed-style reports.

It is designed for website rebuilds, CMS migrations, framework rewrites, landing page QA, and agent-assisted visual parity work where you need concrete browser-rendered evidence instead of manual screenshot inspection.

## Features

- MCP stdio server: `visual-parity-mcp`
- CLI: `visual-parity`
- Playwright Chromium page capture
- MCP responses include JSON summaries, resource links for report artifacts, and inline image content for key diff/crop images
- Pixel-level screenshot diffs with configurable thresholds
- Computed style, text, and bounding-box diffs by selector
- Basic stylesheet provenance for matched computed-style rules
- Root-cause clustering for repeated style/layout diffs
- Candidate-fixable root-cause ranking when stylesheet provenance is available
- Raw and effective visual diff percentages; effective diff excludes masked/noisy selector regions
- Section-by-section discovery and comparison tools for agent repair loops
- Cross-page aggregation for route comparisons
- Broken-page detection for HTTP errors, empty bodies, and missing landmarks
- Per-project accepted deviations through `.visual-parity.json`
- HTML and JSON reports
- Noisy-element masking with custom selectors
- Built-in `hubspot` preset for common HubSpot and CookieYes page noise
- Built-in `nextjs-fonts` preset for next/font fallback font-family noise
- Built-in `dev-toolbars` preset for local feedback/debug toolbar overlays
- Configurable Playwright `waitUntil` behavior for local dev servers
- Retry/backoff, realistic user agent, and optional persistent browser profile for pages that block fresh headless sessions

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
  "loadRetries": 1,
  "retryDelayMs": 1000,
  "persistentContextDir": ".visual-parity/browser-profile",
  "threshold": 0.1,
  "maxDiffPercent": 1,
  "selectors": ["header", "main", "h1", ".hero", ".cta"],
  "hideSelectors": [".cookie-banner", ".chat-widget"],
  "presets": ["hubspot", "nextjs-fonts"],
  "scrollPositions": [0.25, 0.5, 0.75],
  "acceptedDeviations": [
    { "selector": "header", "property": "position", "reason": "Intentional sticky chrome" }
  ],
  "compareStyles": true
}
```

The response includes pass/fail status, raw and effective pixel diff percentages, report paths, screenshot paths, style diff counts, top root-cause clusters, fixability ranking, suggested fixes when available, remaining raw examples, resource links for generated artifacts, and an inline MCP image block for the main diff image.

### `compare_routes`

Compare multiple paths under a reference and candidate base URL.

```json
{
  "referenceBaseUrl": "https://example.com",
  "candidateBaseUrl": "http://localhost:3000",
  "paths": ["/", "/about", "/pricing"],
  "concurrency": 2,
  "waitUntil": "domcontentloaded",
  "presets": ["hubspot", "nextjs-fonts"]
}
```

Route summaries include `crossPageFindings`, sorted by impact, so global issues such as box sizing, shared footer typography, or repeated spacing drift rise above page-by-page noise. MCP responses also include resource links for the route summary and per-route reports/diff images.

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

The MCP response includes resource links for the inspect report and inline image blocks for selector crops when the selector is present.

### `discover_sections`

Discover likely page sections and candidate matches so an agent can work down the page deliberately instead of guessing selectors.

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "waitUntil": "domcontentloaded",
  "maxSections": 12,
  "includeCrops": true
}
```

The response includes labels, reference/candidate selectors, bounding boxes, text samples, match confidence, match reason, and optional crop artifacts. Section matching scores selector equality, landmark/tag type, heading/text overlap, id/class token overlap, page order, and size similarity while avoiding duplicate candidate reuse.

### `compare_section`

Compare one section crop and scoped style snapshot.

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "referenceSelector": "main > section:nth-of-type(1)",
  "localSelector": "main > section:nth-of-type(1)",
  "sectionLabel": "Hero",
  "waitUntil": "domcontentloaded",
  "maxDiffPercent": 1
}
```

The response includes reference/candidate/diff crop artifacts, section-level pixel diff, scoped style/layout/text diffs, a section fix plan, `section.json`, and `section.html`.

### `compare_sections`

Discover sections, compare each matched section, and return an agent-friendly checklist.

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "waitUntil": "domcontentloaded",
  "maxSections": 8,
  "concurrency": 2,
  "maxDiffPercent": 1
}
```

The response includes pass/fail counts, per-section next actions, diff/report artifact links, `sections-summary.json`, `sections-summary.html`, and `recommendedOrder` so an agent can fix the largest failing sections first.

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
  --concurrency 2 \
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

### Discover Sections

```bash
visual-parity discover-sections \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --wait-until domcontentloaded \
  --max-sections 8 \
  --include-crops
```

### Compare One Section

```bash
visual-parity section \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --reference-selector "main > section:nth-of-type(1)" \
  --candidate-selector "main > section:nth-of-type(1)" \
  --section-label Hero \
  --wait-until domcontentloaded
```

### Compare Sections Checklist

```bash
visual-parity sections \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --wait-until domcontentloaded \
  --max-sections 8 \
  --concurrency 2
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
--load-retries <count>      Retry count for blocked or transiently empty page loads, default 1
--retry-delay-ms <ms>       Delay between page load retries, default 1000
--concurrency <count>       Route/section comparisons to run at once for routes/sections commands, default 1
--user-agent <value>        Override browser user agent
--persistent-context-dir <dir> Reuse cookies/storage from a persistent Playwright profile directory
--soft-page-health          Warn instead of failing on broken-page health checks
--threshold <number>        pixelmatch threshold, default 0.1
--max-diff-percent <num>    Failure threshold, default 1.0
--selector <css>            Repeatable selector for style/layout extraction
--section-selector <css>    Repeatable scoped selector for section style/layout extraction
--hide <css>                Repeatable selector to hide before screenshot
--config <file>             Config file, default .visual-parity.json
--preset <name>             Repeatable preset bundle; currently: hubspot, nextjs-fonts, dev-toolbars
--scroll-position <value>   Repeatable viewport scroll state; 0..1 = page progress, >1 = pixels
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
- clusters with candidate-side provenance are ranked ahead of reference-only third-party noise
- root-cause displays prioritize repeated findings and summarize hidden one-off tail findings
- hidden preset elements are excluded from style snapshots as well as screenshots
- `color` comparison uses effective text fill when pages rely on `-webkit-text-fill-color`
- reports and MCP responses include a recommended fix plan grouped into global CSS, component styles, content/DOM mismatches, probable noise, and manual review

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

If a live site intermittently returns an empty body or bot-blocks fresh headless contexts, use a persistent profile and retries:

```bash
visual-parity compare \
  --reference https://example.com/products \
  --candidate http://localhost:3000/products \
  --persistent-context-dir .visual-parity/browser-profile \
  --load-retries 2 \
  --retry-delay-ms 1500
```

`--persistent-context-dir` lets Playwright reuse cookies and storage across runs. `--soft-page-health` is available for diagnosis when you want artifacts from a blocked page, but normal parity runs should keep the default hard-fail behavior.

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
- `effectiveDiffPercent`, `effectiveMismatchedPixels`, and `maskedPixels`
- pass/fail result based on `maxDiffPercent`
- optional `scrollStates` captures when `scrollPositions` / `--scroll-position` is provided
- computed-style, layout, and text diffs for selected elements
- style-rule provenance on style diffs when available
- root-cause clusters under `styles.analysis.clusters`
- route-level cross-page clusters under `crossPageFindings`
- section-level reports from `visual-parity section` include `section.json` and `section.html`
- section checklist runs from `visual-parity sections` include `sections-summary.json` and `sections-summary.html`

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

For agent-led section repair, use:

1. Run `discover_sections` through MCP or `visual-parity discover-sections`.
2. Run `compare_sections` through MCP or `visual-parity sections` to get a section checklist and recommended order.
3. Fix the first failing section.
4. Re-run `compare_section` through MCP or `visual-parity section` for that section.
5. Move to the next failing section until the checklist passes or remaining differences are accepted.

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
node dist/cli.js sections --help
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
