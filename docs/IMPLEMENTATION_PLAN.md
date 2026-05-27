# Visual Parity MCP Implementation Plan

> **For Hermes / future agents:** This plan exists so the work can be picked up cold if Ben gets vaporized by Discord, gateway restarts, cosmic rays, or dumb bullshit.

**Goal:** Build a local CLI + MCP server that compares reference pages against candidate pages and produces visual/style/layout diffs.

**Architecture:** Playwright captures reference/candidate renderings under identical viewport settings. Pixelmatch generates visual diffs. Computed style extraction gives coding agents actionable CSS/layout deltas. Reports are saved to files; CLI/MCP returns compact summaries.

**Tech Stack:** TypeScript, Node.js, Playwright, pixelmatch, pngjs, sharp, commander, @modelcontextprotocol/sdk, zod.

---

## Task 1: Browser capture helpers

**Objective:** Add reusable Playwright functions for loading pages, stabilizing them, hiding noisy selectors, and saving screenshots.

**Files:**

- Create: `src/browser.ts`
- Modify if needed: `src/types.ts`

**Steps:**

1. Create `launchBrowser()` / context helper.
2. Implement `preparePage(page, url, options)`:
   - goto URL
   - wait until `networkidle` by default
   - inject animation-disabling CSS
   - inject hidden selector CSS
   - wait `waitMs`
3. Implement `capturePageScreenshot()` that writes PNG.
4. Add clear error when Playwright Chromium is missing.

**Verification:**

```bash
npm run build
```

Expected: TypeScript compiles.

---

## Task 2: Style snapshot + diff

**Objective:** Extract computed styles and bounding boxes for selectors and compare reference/candidate snapshots.

**Files:**

- Create: `src/styles.ts`
- Use: `src/defaults.ts`
- Modify if needed: `src/types.ts`

**Steps:**

1. Implement `captureStyleSnapshots(page, selectors, properties, maxElementsPerSelector)`.
2. Capture selector errors without killing whole run.
3. Implement `diffStyleSnapshots(reference, candidate)`:
   - count mismatches
   - rect diffs > 1px
   - style property diffs
   - short text diffs
4. Cap returned diffs in summaries but keep full diffs in JSON.

**Verification:**

```bash
npm run build
```

Expected: TypeScript compiles.

---

## Task 3: Screenshot normalization and pixel diff

**Objective:** Compare screenshots even if dimensions differ.

**Files:**

- Create/modify: `src/compare.ts`

**Steps:**

1. Read reference/candidate PNGs with `sharp` or `pngjs`.
2. Create equal-size white canvases using max width/height.
3. Composite screenshots onto canvases.
4. Run `pixelmatch`.
5. Write `diff.png`.
6. Calculate diff percent.

**Verification:**

Use two simple local PNG or HTML fixtures and ensure a diff image is written.

---

## Task 4: Report writer

**Objective:** Write machine and human readable reports.

**Files:**

- Create: `src/report.ts`

**Steps:**

1. Write `report.json` containing full comparison report.
2. Write `report.html` with:
   - reference/candidate URLs
   - pass/fail
   - diff percent
   - reference/candidate/diff images
   - top style/layout diffs
3. Make report self-contained enough to open locally.

**Verification:**

Open report path or inspect output file exists/non-empty.

---

## Task 5: Core compare function

**Objective:** Wire browser capture, screenshot diff, style diff, and reports into one function.

**Files:**

- Create/modify: `src/compare.ts`

**Steps:**

1. Implement `comparePages(options)`.
2. Create stable run directory names.
3. Capture reference/candidate screenshots and style snapshots in same browser context settings.
4. Run pixel diff.
5. Build `PageComparisonReport`.
6. Write JSON/HTML reports.
7. Return report object.

**Verification:**

```bash
npm run build
```

Expected: TypeScript compiles.

---

## Task 6: Batch routes

**Objective:** Compare many paths under base URLs and produce aggregate summary.

**Files:**

- Create: `src/routes.ts`

**Steps:**

1. Implement URL joining safely.
2. Loop through paths and call `comparePages`.
3. Write `summary.json` and `summary.html`.
4. Continue route loop if one route fails? Prefer fail-fast for initial implementation unless errors can be captured cleanly.

**Verification:**

Run against two local static pages with two paths.

---

## Task 7: CLI

**Objective:** Add human-usable command line interface.

**Files:**

- Create: `src/cli.ts`

**Commands:**

- `visual-parity compare`
- `visual-parity routes`
- `visual-parity inspect`

**Verification:**

```bash
npm run build
node dist/cli.js --help
node dist/cli.js compare --help
npm link
visual-parity --help
```

Expected: Help text prints.

---

## Task 8: MCP server

**Objective:** Expose compare functionality to Claude/Codex via MCP stdio.

**Files:**

- Create: `src/mcp.ts`

**Tools:**

- `compare_pages`
- `compare_routes`
- `inspect_selector`

**Verification:**

```bash
npm run build
node dist/mcp.js
```

Expected: process starts as MCP stdio server without crashing. Full MCP validation can happen from an MCP client.

---

## Task 9: Docs and examples

**Objective:** Make this usable by Dylan and by future coding agents.

**Files:**

- Create/modify: `README.md`
- Create examples in `examples/`

**Include:**

- Installation
- CLI examples
- MCP config examples
- General reference/candidate workflow
- HubSpot preset/noise tips

**Verification:**

README has enough info for another agent to run the tool with no context.

---

## Task 10: Smoke test

**Objective:** Prove the tool works locally without real external site access.

**Files:**

- Create: `fixtures/live/index.html`
- Create: `fixtures/local/index.html`
- Optional: `scripts/smoke-test.sh`

**Steps:**

1. Create two static HTML pages with intentional visual differences.
2. Serve fixture directory locally.
3. Run compare.
4. Verify reports are generated.

**Commands:**

```bash
npm install
npm run build
npx playwright install chromium
node dist/cli.js compare \
  --reference http://127.0.0.1:4173/live/index.html \
  --candidate http://127.0.0.1:4173/local/index.html \
  --out reports/smoke \
  --name fixture
```

Expected: report files exist and diff percent is > 0 for intentionally different fixtures.

---

## Final verification checklist

- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds
- [ ] `node dist/cli.js --help` succeeds
- [ ] `npm link && visual-parity --help` succeeds
- [ ] fixture smoke compare writes screenshots and reports
- [ ] failed visual threshold exits `2`, not a generic crash
- [ ] MCP server starts without immediate crash
- [ ] docs explain how Claude/Codex should use it
- [ ] git commit contains docs + implementation
