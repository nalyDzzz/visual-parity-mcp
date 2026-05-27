# Visual Parity MCP — Handoff Notes

## Status

Implemented and smoke-tested as of 2026-05-27. See `docs/STATUS.md` for verified commands, artifact paths, and known limitations.

This repo is a local-first visual QA tool for comparing a **reference** web page against a **candidate** web page. It is useful for migrations, redesigns, CMS rebuilds, preview-deploy QA, and agent-assisted visual matching work.

Origin story: it was built during a HubSpot → Sanity/Next.js migration, so a `hubspot` preset exists. The core tool is intentionally not HubSpot-specific.

Target outcome: give humans and agents a CLI + MCP server that returns concrete screenshot, pixel, layout, and computed-style diffs instead of vague “looks off” bullshit.

## Repo

Path:

```bash
/absolute/path/to/visual-parity-mcp
```

Public GitHub repo:

```text
https://github.com/nalyDzzz/visual-parity-mcp
```

Primary deliverables:

- CLI binary: `visual-parity`
- MCP stdio server: `visual-parity-mcp`
- Core compare engine using Playwright + pixelmatch + computed style extraction

## Core workflow

```bash
# Terminal 1: start or identify the candidate site
cd /path/to/candidate-site
npm run dev

# Terminal 2: compare reference vs candidate
cd /absolute/path/to/visual-parity-mcp
npm install
npm run build
npm link
visual-parity compare \
  --reference https://reference-site.com/some-page \
  --candidate http://localhost:3000/some-page \
  --selector header \
  --selector main \
  --selector h1 \
  --selector '.hero' \
  --hide '.chat-widget' \
  --hide '.cookie-banner'
```

Legacy CLI aliases still work: `--live` = `--reference`, `--local` = `--candidate`.

Expected artifacts:

```text
reports/visual-parity/<run>/live.png     # reference screenshot, legacy filename
reports/visual-parity/<run>/local.png    # candidate screenshot, legacy filename
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
- header[0] rect.height reference=88 candidate=72 delta=-16
- h1[0] font-size reference=64px candidate=56px
- .hero[0] padding-top reference=96px candidate=72px
- .cta[0] border-radius reference=999px candidate=8px
Artifacts:
- report: reports/visual-parity/home/report.html
- diff: reports/visual-parity/home/diff.png
```

## Important design choices

- Local-first. No SaaS dependency.
- Works for any rendered web page pair, not just one CMS or framework.
- Do not require modifying either site.
- Do not copy source CSS blindly; compare rendered output.
- Keep stdout/tool output compact; save heavy artifacts to files.
- Always disable animations/transitions before screenshots.
- Allow noisy selectors to be hidden with `visibility: hidden !important` to preserve layout boxes.
- Normalize screenshot sizes before diffing so different document heights do not crash comparisons.
- Computed style diffs are as important as pixel diffs because AI agents need exact fixes.

## Presets

The tool is general by default. Presets are optional bundles of selectors and hide masks.

HubSpot preset:

```bash
--preset hubspot
```

It adds common HubSpot selector targets and hides cookie banners, HubSpot iframes/forms/chat widgets, CAPTCHA badges, and aria-live regions. Add manual `--hide` / `hideSelectors` only for project-specific noise.

Don't hide real page content unless it is dynamic/noisy.

## If another agent picks this up

Start here:

```bash
cd /absolute/path/to/visual-parity-mcp
git status
read README.md
read docs/HANDOFF.md
read docs/ARCHITECTURE.md
```

Then verify:

```bash
npm install
npm run build
node dist/cli.js --help
npm run smoke
```

For human CLI ergonomics from a source checkout:

```bash
npm link
visual-parity --help
```

If Playwright complains about missing browser binaries:

```bash
npx playwright install chromium
```

## Current known constraints

- Codex CLI was not on PATH when scaffold was created.
- Claude CLI exists on this host, but this repo should be implementable by any coding agent.
- MCP can be run from npm with `npx -y visual-parity-mcp` after the package is published.
- Source checkout MCP config examples must use an absolute path to `dist/mcp.js`.
- npm publish is blocked until npm auth is completed on this host.

## Success criteria

The project is successful when Claude/Codex/a human can do this loop without manually screaming at pixels like a cursed optometrist:

1. Run `compare_pages` or `visual-parity compare` against reference and candidate.
2. Read top visual/style/layout diffs.
3. Edit candidate code/styles/content.
4. Re-run compare.
5. Repeat until under threshold or only acceptable content/dynamic differences remain.
