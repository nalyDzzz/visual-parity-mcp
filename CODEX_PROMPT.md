# Agent task: maintain Visual Parity MCP + CLI

You are working in the `visual-parity-mcp` repo root, a TypeScript Node project for visual QA.

## What this project is

Visual Parity MCP compares a **reference** web page against a **candidate** web page and produces evidence about what visually differs.

It is useful for:

- website migrations
- CMS rebuilds
- framework rewrites
- redesign QA
- preview deploy vs production checks
- AI coding-agent visual repair loops

Origin note: this was born from a HubSpot → Sanity/Next.js migration, so a `hubspot` preset exists. Do not make the core tool HubSpot-specific.

## Deliverables

The project exposes both:

1. CLI binary: `visual-parity`
2. MCP stdio server: `visual-parity-mcp`

## Core idea

Use Playwright to load both pages in Chromium with the same viewport. Stabilize the page. Screenshot both. Normalize screenshot dimensions. Run pixel diff with `pixelmatch`. Also extract computed styles and bounding boxes for important selectors so agents get exact CSS/property-level differences instead of just “pixels differ lol good luck.”

This needs to be useful for an AI coding agent, not just a human QA screenshot.

## CLI commands

### `visual-parity compare`

Compare one reference URL against one candidate URL.

Preferred args:

```bash
visual-parity compare \
  --reference https://example.com/page \
  --candidate http://localhost:3000/page
```

Legacy args still work:

```bash
visual-parity compare \
  --live https://example.com/page \
  --local http://localhost:3000/page
```

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
- `--preset <name>` repeatable; currently includes `hubspot`
- `--no-styles` disable computed style extraction
- `--json` print machine-readable JSON only

Outputs:

- `<runDir>/live.png` reference screenshot, legacy filename
- `<runDir>/local.png` candidate screenshot, legacy filename
- `<runDir>/diff.png`
- `<runDir>/report.json`
- `<runDir>/report.html`

Exit code:

- `0` if visual diff percent <= `maxDiffPercent`
- `2` if comparison completed but failed threshold
- nonzero other codes for actual errors

### `visual-parity routes`

Compare many routes under two base URLs.

```bash
visual-parity routes \
  --reference-base https://example.com \
  --candidate-base http://localhost:3000 \
  --path / \
  --path /about
```

Legacy aliases still work:

- `--live-base` = `--reference-base`
- `--local-base` = `--candidate-base`

### `visual-parity inspect`

Deep inspect a selector on both pages.

```bash
visual-parity inspect \
  --reference https://example.com/page \
  --candidate http://localhost:3000/page \
  --selector '.hero'
```

## MCP tools

Expose:

- `compare_pages`
- `compare_routes`
- `inspect_selector`

Preferred MCP fields:

```json
{
  "referenceUrl": "https://example.com/page",
  "candidateUrl": "http://localhost:3000/page"
}
```

Legacy MCP fields still work:

```json
{
  "liveUrl": "https://example.com/page",
  "localUrl": "http://localhost:3000/page"
}
```

## Presets

The default tool should stay general. Presets are optional bundles of selectors/noise masks.

Current preset:

```bash
--preset hubspot
```

The HubSpot preset hides common cookie banners, HubSpot iframes/forms/chat widgets, CAPTCHA badge, and `aria-live` regions. It also adds common content/style selectors.

Use `visibility: hidden !important`, not `display: none`, for hide masks unless there is an intentional reason to change layout.

## Verification

Run:

```bash
npm install
npm run build
node dist/cli.js --help
node dist/cli.js compare --help
npm run smoke
```

For local CLI command testing from the source checkout:

```bash
npm link
visual-parity --help
```

If Playwright browsers are missing:

```bash
npx playwright install chromium
```

## Docs expectations

Keep docs general. HubSpot can appear only as:

- historical origin/context
- optional preset documentation
- a concrete example

Do not position the whole package as HubSpot-only.

## Important constraints

- Keep it local-first. No external SaaS.
- Do not require copying source CSS.
- Do not require modifying either site.
- Avoid giant tool outputs. Save artifacts to files; return summaries.
- Keep MCP output compact and JSON-safe.
- Preserve backward compatibility with `live` / `local` fields for now.
