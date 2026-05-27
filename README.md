# Visual Parity MCP

A local-first visual QA tool for migration work where an AI coding agent needs to match a live website 1:1 against a local rewrite.

Built for Dylan's HubSpot → Sanity/Next.js migration, because HubSpot CSS is a haunted landfill and copying it directly is how you summon production demons.

## What it does

Visual Parity MCP compares:

- **Live source page:** e.g. `https://old-hubspot-site.com/about`
- **Local migrated page:** e.g. `http://localhost:3000/about`

It then produces:

- `live.png` screenshot
- `local.png` screenshot
- `diff.png` pixel difference image
- `report.json` full machine-readable report
- `report.html` human-readable report
- computed style/layout diffs for selectors like `header`, `.hero`, `h1`, `.cta`

## Why not just copy HubSpot CSS?

Because HubSpot CSS is usually:

- split across many generated files
- order-dependent
- loaded through CMS/module wrappers
- polluted with global cascade
- mixed with runtime inline styles/scripts
- not directly portable to componentized Next.js/Tailwind

Rendered output is the truth. This tool compares rendered output and tells the agent what to fix.

## Install

```bash
cd /home/dylan/Projects/visual-parity-mcp
npm install
npm run build
```

If Chromium is missing:

```bash
npx playwright install chromium
```

## CLI usage

### Compare one page

```bash
node dist/cli.js compare \
  --live https://old-site.com/about \
  --local http://localhost:3000/about \
  --selector header \
  --selector main \
  --selector h1 \
  --selector '.hero' \
  --selector '.cta' \
  --hide '.chat-widget' \
  --hide '.cookie-banner'
```

### Compare multiple routes

```bash
node dist/cli.js routes \
  --live-base https://old-site.com \
  --local-base http://localhost:3000 \
  --path / \
  --path /about \
  --path /pricing
```

### Inspect one selector

```bash
node dist/cli.js inspect \
  --live https://old-site.com/about \
  --local http://localhost:3000/about \
  --selector '.hero'
```

## Common options

```text
--out <dir>                 Output directory, default reports/visual-parity
--name <slug>               Run name
--width <px>                Viewport width, default 1440
--height <px>               Viewport height, default 1200
--dpr <number>              Device scale factor, default 1
--full-page                 Capture full-page screenshots
--wait-ms <ms>              Extra wait after page load, default 1000
--timeout-ms <ms>           Navigation timeout, default 30000
--threshold <number>        pixelmatch threshold, default 0.1
--max-diff-percent <num>    Failure threshold, default 1.0
--selector <css>            Repeatable selector for style/layout extraction
--hide <css>                Repeatable noisy selector to hide before screenshot
--no-styles                 Disable computed style extraction
--json                      Print compact JSON only
```

## MCP usage

After building, configure your MCP client to run:

```json
{
  "mcpServers": {
    "visual-parity": {
      "command": "node",
      "args": ["/home/dylan/Projects/visual-parity-mcp/dist/mcp.js"]
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
  "liveUrl": "https://old-site.com/about",
  "localUrl": "http://localhost:3000/about",
  "outputDir": "reports/visual-parity",
  "name": "about",
  "viewport": { "width": 1440, "height": 1200, "deviceScaleFactor": 1 },
  "fullPage": false,
  "waitMs": 1000,
  "threshold": 0.1,
  "maxDiffPercent": 1,
  "selectors": ["header", "main", "h1", ".hero", ".cta"],
  "hideSelectors": [".chat-widget", ".cookie-banner"],
  "compareStyles": true
}
```

## Recommended migration workflow

1. Start the Next.js app locally.
2. Compare one route against the live HubSpot route.
3. Open `report.html` and inspect `diff.png`.
4. Give Claude/Codex the JSON summary and report paths.
5. Fix styles/components in Next.js.
6. Re-run compare.
7. Repeat until diff is under threshold or remaining differences are acceptable content/dynamic changes.

## HubSpot noise tips

Hide dynamic junk that isn't part of the migrated design:

```bash
--hide '#hs-eu-cookie-confirmation' \
--hide '.hs-cookie-notification-position-bottom' \
--hide '.chat-widget' \
--hide "iframe[src*='hubspot']" \
--hide "[class*='cookie']" \
--hide "[class*='modal']"
```

Use fixed viewport sizes. Compare route by route. Start with desktop, then add mobile/tablet once desktop is sane.

## Project docs

- `docs/HANDOFF.md` — pickup notes for future agents
- `docs/ARCHITECTURE.md` — technical architecture
- `docs/IMPLEMENTATION_PLAN.md` — task-by-task implementation plan
- `CODEX_PROMPT.md` — standalone coding-agent handoff prompt
