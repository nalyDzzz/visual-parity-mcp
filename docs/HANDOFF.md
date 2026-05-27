# Visual Parity MCP — Handoff Notes

## Status

Implemented and smoke-tested as of 2026-05-27. See `docs/STATUS.md` for verified commands, artifact paths, and known limitations.

This repo is a local-first visual QA tool for Dylan's HubSpot → Sanity/Next.js migration.

Problem: AI coding agents are trying to visually match the HubSpot site in Next.js, but manual QA is painful because HubSpot styling is generated, spread across many files, and not portable. Copying HubSpot CSS is not the strategy. The strategy is evidence-based visual parity.

Target outcome: give Claude/Codex an MCP + CLI that compares the live HubSpot URL against localhost Next.js and returns concrete visual/layout/style diffs the agent can fix.

## Repo

Path:

```bash
/home/dylan/Projects/visual-parity-mcp
```

Primary deliverables:

- CLI binary: `visual-parity`
- MCP stdio server: `visual-parity-mcp`
- Core compare engine using Playwright + pixelmatch + computed style extraction

## Core workflow

```bash
# Terminal 1: start migrated Next.js site
cd /path/to/nextjs-site
npm run dev

# Terminal 2: compare live vs local
cd /home/dylan/Projects/visual-parity-mcp
npm run build
node dist/cli.js compare \
  --live https://live-hubspot-site.com/some-page \
  --local http://localhost:3000/some-page \
  --selector header \
  --selector main \
  --selector h1 \
  --selector '.hero' \
  --hide '.chat-widget' \
  --hide '.cookie-banner'
```

Expected artifacts:

```text
reports/visual-parity/<run>/live.png
reports/visual-parity/<run>/local.png
reports/visual-parity/<run>/diff.png
reports/visual-parity/<run>/report.json
reports/visual-parity/<run>/report.html
```

## What this tool should tell an agent

Bad output:

```text
The page looks different.
```

Useful output:

```text
Visual parity: FAIL
Diff: 4.82% (max 1.00%)
Top diffs:
- header[0] rect.height live=88 local=72 delta=-16
- h1[0] font-size live=64px local=56px
- .hero[0] padding-top live=96px local=72px
- .cta[0] border-radius live=999px local=8px
Artifacts:
- report: reports/visual-parity/home/report.html
- diff: reports/visual-parity/home/diff.png
```

## Implementation plan

1. Document architecture and pickup context. **Done first intentionally.**
2. Implement Playwright browser capture helpers.
3. Implement screenshot normalization and pixel diff.
4. Implement computed style extraction and diffing.
5. Implement JSON + HTML report writers.
6. Implement CLI commands: `compare`, `routes`, `inspect`.
7. Implement MCP tools: `compare_pages`, `compare_routes`, `inspect_selector`.
8. Add smoke fixtures/tests.
9. Verify with `npm install`, `npm run build`, CLI help, and local fixture compare.

## Important design choices

- Local-first. No SaaS dependency.
- Do not require modifying either site.
- Do not copy HubSpot CSS; compare rendered output.
- Keep stdout/tool output compact; save heavy artifacts to files.
- Always disable animations/transitions before screenshots.
- Allow noisy selectors to be hidden.
- Normalize screenshot sizes before diffing so different document heights do not crash comparisons.
- Computed style diffs are as important as pixel diffs because AI agents need exact fixes.

## Noise to hide on HubSpot pages

Common selectors to pass via `--hide` / `hideSelectors`:

```text
.cookie-banner
#hs-eu-cookie-confirmation
.hs-cookie-notification-position-bottom
.chat-widget
iframe[src*='hubspot']
iframe[src*='hsforms']
[class*='chat']
[class*='cookie']
[class*='modal']
```

Don't hide real page content unless it is dynamic/noisy.

## If another agent picks this up

Start here:

```bash
cd /home/dylan/Projects/visual-parity-mcp
git status
read docs/HANDOFF.md
read docs/ARCHITECTURE.md
read docs/IMPLEMENTATION_PLAN.md
read CODEX_PROMPT.md
```

Then verify:

```bash
npm install
npm run build
node dist/cli.js --help
```

If Playwright complains about missing browser binaries:

```bash
npx playwright install chromium
```

## Current known constraints

- Codex CLI was not on PATH when scaffold was created.
- Claude CLI exists on this host, but this repo should be implementable by any coding agent.
- MCP config examples must use absolute path to `dist/mcp.js` unless installed globally.

## Success criteria

The project is successful when Claude/Codex can do this loop without Dylan manually screaming at pixels like a cursed optometrist:

1. Run `compare_pages` against live and local.
2. Read top visual/style/layout diffs.
3. Edit Next.js/Tailwind/component code.
4. Re-run compare.
5. Repeat until under threshold or only acceptable content differences remain.
