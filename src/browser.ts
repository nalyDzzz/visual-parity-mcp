import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ViewportOptions, WaitUntil } from "./types.js";
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
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
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

export async function preparePage(page: Page, url: string, options: PreparePageOptions = {}): Promise<void> {
  const waitUntil = options.waitUntil ?? "networkidle";
  const timeout = options.timeoutMs ?? 30_000;

  try {
    await page.goto(url, { waitUntil, timeout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${url}: ${message}`);
  }

  await page.addStyleTag({ content: STABILIZE_CSS });
  await hideSelectors(page, options.hideSelectors ?? []);
  await page.evaluate(() => window.scrollTo(0, 0));

  const waitMs = options.waitMs ?? 1_000;
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

export async function hideSelectors(page: Page, selectors: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const selector of selectors) {
    try {
      await page.locator(selector).evaluateAll((elements) => {
        for (const element of elements) {
          if (element instanceof HTMLElement || element instanceof SVGElement) {
            element.style.setProperty("visibility", "hidden", "important");
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
