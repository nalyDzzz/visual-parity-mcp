# Visual Parity MCP — Current Status

Last updated: 2026-05-27

## Implementation status

Complete enough for real local use.

Implemented:

- CLI: `compare`, `routes`, `inspect`
- MCP server: `compare_pages`, `compare_routes`, `inspect_selector`
- Playwright Chromium capture
- animation/transition stabilization
- noisy selector hiding via `visibility: hidden !important`
- screenshot normalization for different dimensions
- pixel diff via `pixelmatch`
- computed style and bounding-box extraction
- style/layout/text diff summaries
- JSON + dark HTML reports
- smoke fixtures
- smoke test script
- MIT license
- GitHub Actions CI
- HubSpot preset: `--preset hubspot` / `presets: ["hubspot"]`

## Verified commands

```bash
cd /absolute/path/to/visual-parity-mcp
npm install
npm run build
node dist/cli.js --help
node dist/cli.js compare --help
npx playwright install chromium
npm run smoke
```

Smoke result:

```text
Visual parity: FAIL
Diff: 3.145% (max 0.000%)
Top diffs included header height, hero padding, h1/text/style differences.
```

This failure is expected because the smoke fixture intentionally differs. The smoke script treats CLI exit code `2` as success because `2` means “comparison completed but visual threshold failed.”

Also verified:

```bash
node dist/cli.js routes \
  --live-base http://127.0.0.1:4174/fixtures/live \
  --local-base http://127.0.0.1:4174/fixtures/local \
  --path /index.html \
  --out reports/routes-smoke \
  --selector header \
  --selector .hero \
  --max-diff-percent 0
```

And:

```bash
node dist/cli.js inspect \
  --live http://127.0.0.1:4174/fixtures/live/index.html \
  --local http://127.0.0.1:4174/fixtures/local/index.html \
  --selector .hero \
  --out reports/inspect-smoke \
  --name hero \
  --json
```

## Artifact examples

```text
reports/smoke/fixture/report.html
reports/smoke/fixture/report.json
reports/smoke/fixture/diff.png
reports/routes-smoke/summary.html
reports/inspect-smoke/hero/inspect.html
```

## Exit codes

- `0`: command succeeded and visual threshold passed, or smoke test expected failure was handled
- `2`: compare/routes completed successfully but visual diff exceeded threshold
- `1`: real error such as bad URL, local server down, Playwright/browser issue, etc.

## MCP config

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

## Recommended first real test

Start Dylan's migrated Next.js app:

```bash
cd /path/to/migration
npm run dev
```

Then run:

```bash
cd /absolute/path/to/visual-parity-mcp
node dist/cli.js compare \
  --live https://LIVE-HUBSPOT-URL/path \
  --local http://localhost:3000/path \
  --out reports/visual-parity \
  --name first-real-page \
  --preset hubspot \
  --selector header \
  --selector main \
  --selector h1 \
  --selector '.hero' \
  --selector '.cta' \
  --hide '#hs-eu-cookie-confirmation' \
  --hide '.hs-cookie-notification-position-bottom' \
  --hide '.chat-widget' \
  --hide "iframe[src*='hubspot']"
```

Then open:

```text
reports/visual-parity/first-real-page/report.html
```

## Known limitations / next improvements

- No automatic sitemap crawler yet. Routes are provided manually via `--path` or `--paths-file`.
- No mobile preset command yet; use `--width`, `--height`, `--dpr` manually.
- No AI auto-fix integration yet; the tool outputs evidence, then Claude/Codex edits the Next.js repo.
- No DOM structural diff yet. Current evidence is pixel + computed style + bounding rect + text sample.
- No authentication/session handling yet. Public pages are the intended first use.

## Pickup instruction for another agent

If picking this up cold:

1. Read `README.md`.
2. Read `docs/HANDOFF.md` and `docs/ARCHITECTURE.md`.
3. Run `npm run build && npm run smoke`.
4. Use CLI against the real live/local URLs.
5. If MCP is needed, add the config above to the relevant MCP client and restart that client.
