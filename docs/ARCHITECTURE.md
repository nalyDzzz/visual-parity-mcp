# Visual Parity MCP — Architecture

## Goal

Compare a production/live source page against a local migration page and produce machine-actionable evidence about visual differences.

This is specifically for HubSpot → Sanity/Next.js migrations where the original CSS cannot be cleanly reused.

## Components

```text
CLI / MCP Tool Call
        |
        v
compare engine
        |
        +--> Playwright browser capture
        |       - open live URL
        |       - open local URL
        |       - same viewport/DPR
        |       - disable animations
        |       - hide noisy selectors
        |       - screenshot both
        |       - collect computed styles
        |
        +--> screenshot diff
        |       - normalize dimensions
        |       - pixelmatch diff
        |       - write diff.png
        |
        +--> style/layout diff
        |       - compare element counts
        |       - compare bounding boxes
        |       - compare computed styles
        |       - compare short text samples
        |
        +--> report writer
                - live.png/local.png/diff.png
                - report.json
                - report.html
```

## Source layout

```text
src/
  browser.ts     Playwright launch, stabilization, screenshot, selector crops
  cli.ts         Commander CLI
  compare.ts     Core compare_pages implementation
  defaults.ts    Default selectors and CSS properties
  mcp.ts         MCP stdio server and tools
  report.ts      JSON/HTML report writers
  routes.ts      Batch route comparison
  styles.ts      Computed style capture/diff
  types.ts       Shared TypeScript types
```

## Browser stabilization

Before taking screenshots, inject CSS that removes animation noise:

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

For hidden selectors, inject:

```css
selector { visibility: hidden !important; }
```

Use `visibility: hidden` instead of `display: none` so layout remains stable.

## Screenshot diffing

Raw screenshots can differ in dimensions, especially full-page screenshots where content height varies. The diff path must:

1. Read both PNGs.
2. Determine max width and max height.
3. Composite both screenshots onto equal-size white canvases.
4. Run `pixelmatch` over equal-sized buffers.
5. Write `diff.png`.

This prevents false crashes and turns height differences into visible diff regions.

## Computed style extraction

For each selector:

- Query matching elements, capped by `maxElementsPerSelector`.
- Capture:
  - tagName
  - trimmed text sample
  - bounding rect
  - selected computed style properties

Properties should include layout, spacing, typography, color, backgrounds, borders, shadows, flex/grid basics, and opacity.

## Style diffing rules

Detect:

- Count mismatches.
- Bounding rect differences above tolerance, default 1px.
- Computed style value differences.
- Short text sample mismatches.

Do not spam the agent. Save full diffs in JSON, but return top diffs in CLI/MCP output.

## MCP design

Expose three tools:

### `compare_pages`

Single URL pair. Returns compact summary and artifact paths.

### `compare_routes`

Base URL pair + list of route paths. Returns aggregate summary and artifact paths.

### `inspect_selector`

Deep-dive one selector between two pages. Useful after a failed compare when the agent needs exact CSS/layout differences.

## Security / safety

- This tool fetches URLs supplied by the caller. It should be used locally/trusted.
- It does not execute code in the target project except loading webpages in Chromium.
- It writes reports under the requested output directory.
- It should not dump page HTML, cookies, or secrets to stdout.

## Why not CSS extraction?

HubSpot CSS is often:

- split across many generated files
- tied to module wrappers and CMS-generated classes
- polluted by global cascade/order dependencies
- dependent on runtime scripts and inline styles
- not compatible with componentized Next.js/Tailwind architecture

Rendered visual comparison is the useful invariant. Pixel output, bounding boxes, and computed styles tell us what matters without worshipping HubSpot's cursed CSS sewer.
