import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { PageHealth, ViewportOptions, WaitUntil } from "./types.js";
import { ensureDir } from "./utils.js";

export const DEFAULT_VIEWPORT: Required<ViewportOptions> = {
  width: 1440,
  height: 1200,
  deviceScaleFactor: 1
};

export interface PreparePageOptions {
  waitUntil?: WaitUntil;
  waitMs?: number;
  timeoutMs?: number;
  hideSelectors?: string[];
}

export interface BrowserPairOptions extends PreparePageOptions {
  viewport?: ViewportOptions;
}

const STABILIZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-play-state: paused !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  transition-property: none !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
html, body { overscroll-behavior: none !important; }
[data-visual-parity-hidden="true"] { visibility: hidden !important; pointer-events: none !important; }
`;

export function normalizeViewport(viewport?: ViewportOptions): Required<ViewportOptions> {
  return {
    width: viewport?.width ?? DEFAULT_VIEWPORT.width,
    height: viewport?.height ?? DEFAULT_VIEWPORT.height,
    deviceScaleFactor: viewport?.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor
  };
}

export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist") || message.includes("browserType.launch")) {
      throw new Error(
        `${message}\n\nPlaywright Chromium appears to be missing. Run:\n  npx playwright install chromium`
      );
    }
    throw error;
  }
}

export async function createContext(browser: Browser, viewport?: ViewportOptions): Promise<BrowserContext> {
  const normalized = normalizeViewport(viewport);
  return browser.newContext({
    viewport: { width: normalized.width, height: normalized.height },
    deviceScaleFactor: normalized.deviceScaleFactor,
    ignoreHTTPSErrors: true
  });
}

export async function preparePage(page: Page, url: string, options: PreparePageOptions = {}): Promise<PageHealth> {
  const waitUntil = options.waitUntil ?? "networkidle";
  const timeout = options.timeoutMs ?? 30_000;
  let status: number | undefined;

  try {
    const response = await page.goto(url, { waitUntil, timeout });
    status = response?.status();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${url}: ${message}`);
  }

  await page.addStyleTag({ content: STABILIZE_CSS });
  await stabilizeDom(page);
  const hideErrors = await hideSelectors(page, options.hideSelectors ?? []);
  await waitForStablePage(page);

  const waitMs = options.waitMs ?? 1_000;
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }

  await waitForStablePage(page);
  const health = await inspectPageHealth(page, url, status, hideErrors);
  assertPageHealth(health);
  return health;
}

export async function hideSelectors(page: Page, selectors: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const selector of selectors) {
    try {
      await page.locator(selector).evaluateAll((elements) => {
        for (const element of elements) {
          if (element instanceof HTMLElement || element instanceof SVGElement) {
            element.setAttribute("data-visual-parity-hidden", "true");
            element.style.setProperty("visibility", "hidden", "important");
            element.style.setProperty("pointer-events", "none", "important");
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${selector}: ${message}`);
    }
  }
  return errors;
}

async function stabilizeDom(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const element of Array.from(document.querySelectorAll("details[open]"))) {
      element.removeAttribute("open");
    }
    for (const dialog of Array.from(document.querySelectorAll("dialog[open]"))) {
      try {
        (dialog as HTMLDialogElement).close();
      } catch {
        dialog.removeAttribute("open");
      }
    }
  });
}

async function waitForStablePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    if ("fonts" in document) {
      try {
        await document.fonts.ready;
      } catch {
        // Ignore font readiness failures from cross-origin or aborted faces.
      }
    }
    const images = Array.from(document.images).filter((image) => image.complete === false);
    await Promise.all(
      images.map((image) =>
        image.decode().catch(() => {
          // Broken images are captured in page health; they should not block stabilization.
        })
      )
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise<void>((resolve) => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => resolve(), { timeout: 500 });
      } else {
        setTimeout(resolve, 100);
      }
    });
    window.scrollTo(0, 0);
  });
}

async function inspectPageHealth(page: Page, url: string, status: number | undefined, setupErrors: string[]): Promise<PageHealth> {
  const details = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const images = Array.from(document.images);
    return {
      title: document.title,
      bodyTextLength: bodyText.length,
      bodyChildCount: document.body?.children.length ?? 0,
      landmarkCount: document.querySelectorAll("main, header, footer, nav, h1, h2, section, article, [role='main'], [role='banner'], [role='contentinfo'], [role='navigation']").length,
      imageCount: images.length,
      decodedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      hiddenElementCount: document.querySelectorAll("[data-visual-parity-hidden='true']").length
    };
  });

  const errors = [...setupErrors];
  const warnings: string[] = [];
  if (typeof status === "number" && status >= 400) errors.push(`HTTP ${status}`);
  if (details.bodyChildCount === 0 || details.bodyTextLength === 0) errors.push("empty body");
  if (details.landmarkCount === 0) errors.push("missing landmarks");
  if (details.imageCount > 0 && details.decodedImageCount < details.imageCount) {
    warnings.push(`${details.imageCount - details.decodedImageCount} image(s) did not decode before capture`);
  }

  return {
    url,
    status,
    ok: errors.length === 0,
    ...details,
    errors,
    warnings
  };
}

function assertPageHealth(health: PageHealth): void {
  if (!health.ok) {
    throw new Error(`Broken page detected at ${health.url}: ${health.errors.join(", ")}`);
  }
}

export async function screenshotPage(
  page: Page,
  outputPath: string,
  options: { fullPage?: boolean } = {}
): Promise<string> {
  await ensureDir(path.dirname(outputPath));
  await page.screenshot({ path: outputPath, fullPage: options.fullPage ?? false, animations: "disabled" });
  return outputPath;
}

export async function screenshotFirstMatch(page: Page, selector: string, outputPath: string): Promise<string | undefined> {
  const locator = page.locator(selector).first();
  const count = await page.locator(selector).count();
  if (count < 1) return undefined;
  await ensureDir(path.dirname(outputPath));
  await locator.screenshot({ path: outputPath, animations: "disabled" });
  return outputPath;
}
