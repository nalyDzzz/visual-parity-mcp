# Visual Parity MCP

A local-first visual QA toolkit for comparing a **reference** web page against a **candidate** web page.

Use it for website migrations, redesigns, framework rewrites, CMS rebuilds, landing page refreshes, or any cursed “make this page match that page” job where eyeballing screenshots by hand makes you want to walk into the sea.

It includes:

- a CLI: `visual-parity`
- an MCP stdio server: `visual-parity-mcp`
- Playwright screenshot capture
- pixel diffs
- computed style and bounding-box diffs
- JSON + HTML reports
- optional presets, including `hubspot`

## What it compares

Visual Parity MCP compares:

- **Reference page:** the page you want to match, e.g. production, a competitor page, an old CMS page, or a design-system reference URL
- **Candidate page:** the page being tested, e.g. localhost, preview deploy, staging, or the rewritten implementation

It writes:

- `live.png` reference screenshot
- `local.png` candidate screenshot
- `diff.png` pixel difference image
- `report.json` full machine-readable report
- `report.html` human-readable report
- computed style/layout diffs for selectors like `header`, `.hero`, `h1`, `.cta`

> Note: artifact and JSON field names still use `live` / `local` for backward compatibility. The user-facing language is now reference / candidate.

## Why this exists

Copying source CSS is often the wrong move. CMSs and legacy apps tend to produce CSS that is split across generated files, order-dependent, runtime-mutated, wrapper-heavy, and generally haunted as shit.

Rendered output is the truth. This tool compares what the browser actually renders and gives humans or agents concrete evidence to fix.

## Install

### From npm

MCP server via `npx`:

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

CLI without installing globally:

```bash
npx -y -p visual-parity-mcp visual-parity compare \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about
```

Global install if you want both binaries on PATH:

```bash
npm install -g visual-parity-mcp
visual-parity --help
visual-parity-mcp
```

### From source

```bash
npm install
npm run build
npm link
visual-parity --help
```

If Chromium is missing:

```bash
npx playwright install chromium
```

## CLI usage

### Compare one page

```bash
visual-parity compare \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --selector header \
  --selector main \
  --selector h1 \
  --selector '.hero' \
  --selector '.cta'
```

Legacy aliases still work:

```bash
visual-parity compare \
  --live https://example.com/about \
  --local http://localhost:3000/about
```

### Compare multiple routes

```bash
visual-parity routes \
  --reference-base https://example.com \
  --candidate-base http://localhost:3000 \
  --path / \
  --path /about \
  --path /pricing
```

Legacy aliases still work:

```bash
visual-parity routes \
  --live-base https://example.com \
  --local-base http://localhost:3000 \
  --path /about
```

### Inspect one selector

```bash
visual-parity inspect \
  --reference https://example.com/about \
  --candidate http://localhost:3000/about \
  --selector '.hero'
```

## Common options

```text
--reference <url>           Reference/source URL
--candidate <url>           Candidate/target URL
--live <url>                Legacy alias for --reference
--local <url>               Legacy alias for --candidate
--out <dir>                 Output directory, default reports/visual-parity
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
--hide <css>                Repeatable noisy selector to hide before screenshot
--preset <name>             Repeatable preset bundle; currently: hubspot
--no-styles                 Disable computed style extraction
--json                      Print compact JSON only
```

For local dev servers that keep websocket/HMR connections open, such as `next dev` or Vite dev mode, use:

```bash
--wait-until domcontentloaded
```

The default `networkidle` is still useful for quieter production/staging pages, but dev servers may never become network-idle.

## Presets

Presets bundle useful selectors and noise masks for specific stacks. The tool is general by default; presets are optional.

### HubSpot preset

`--preset hubspot` adds selectors/noise masks for HubSpot-backed pages:

- content/style selectors: `body`, `header`, `nav`, `main`, `footer`, `section`, headings, buttons, hero/CTA/card/module-ish classes
- noise masks: cookie banners, HubSpot iframes/forms/chat widgets, CAPTCHA badge, aria-live regions

Example:

```bash
visual-parity compare \
  --reference https://old-site.com/pricing \
  --candidate http://localhost:3000/pricing \
  --preset hubspot \
  --selector '.pricing-card' \
  --hide '.promo-modal'
```

Don't hide real page content unless it is dynamic/noisy. The point is visual truth, not sweeping ugly evidence under the rug like a corporate incident report.

## MCP usage

Recommended npm / `npx` config:

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

Source checkout config after building:

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

Exposed tools:

- `compare_pages`
- `compare_routes`
- `inspect_selector`

Example `compare_pages` input:

```json
{
  "referenceUrl": "https://example.com/about",
  "candidateUrl": "http://localhost:3000/about",
  "outputDir": "reports/visual-parity",
  "name": "about",
  "viewport": { "width": 1440, "height": 1200, "deviceScaleFactor": 1 },
  "fullPage": false,
  "waitUntil": "domcontentloaded",
  "waitMs": 1000,
  "threshold": 0.1,
  "maxDiffPercent": 1,
  "presets": ["hubspot"],
  "selectors": [".custom-section"],
  "hideSelectors": [".custom-chat-widget"],
  "compareStyles": true
}
```

Legacy MCP fields still work:

```json
{
  "liveUrl": "https://example.com/about",
  "localUrl": "http://localhost:3000/about"
}
```

## Recommended workflow

1. Start or identify the candidate site/app.
2. Run `visual-parity compare` for one route.
3. Open `report.html` and inspect `diff.png`.
4. Give Claude/Codex/the poor intern the JSON summary and report paths.
5. Fix styles/components.
6. Re-run compare.
7. Repeat until diff is under threshold or remaining differences are acceptable content/dynamic changes.

## CI

This repo includes GitHub Actions CI at `.github/workflows/ci.yml`:

- `npm ci`
- install Playwright Chromium with dependencies
- `npm run build`
- `npm run smoke`

The smoke fixture intentionally fails visual parity; the smoke runner treats exit code `2` as success because `2` means “comparison completed and exceeded threshold,” not “the tool crashed.”

## Project docs

- `docs/HANDOFF.md` — pickup notes for future agents
- `docs/ARCHITECTURE.md` — technical architecture
- `docs/IMPLEMENTATION_PLAN.md` — task-by-task implementation plan
- `docs/STATUS.md` — current implementation status and verified commands
- `CODEX_PROMPT.md` — standalone coding-agent handoff prompt
