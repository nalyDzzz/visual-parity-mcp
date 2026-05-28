import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { PageHealth, PageMaskRect, ViewportOptions, WaitUntil } from "./types.js";
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
  loadRetries?: number;
  retryDelayMs?: number;
  softPageHealth?: boolean;
}

export interface BrowserPairOptions extends PreparePageOptions {
  viewport?: ViewportOptions;
  userAgent?: string;
  persistentContextDir?: string;
}

export interface BrowserSession {
  context: BrowserContext;
  close: () => Promise<void>;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

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
    userAgent: DEFAULT_USER_AGENT,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9"
    },
    ignoreHTTPSErrors: true
  });
}

export async function createBrowserSession(options: BrowserPairOptions = {}): Promise<BrowserSession> {
  const normalized = normalizeViewport(options.viewport);
  const contextOptions = {
    viewport: { width: normalized.width, height: normalized.height },
    deviceScaleFactor: normalized.deviceScaleFactor,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9"
    },
    ignoreHTTPSErrors: true
  };

  if (options.persistentContextDir) {
    const context = await chromium.launchPersistentContext(options.persistentContextDir, {
      ...contextOptions,
      headless: true
    });
    return { context, close: () => context.close() };
  }

  const browser = await launchChromium();
  const context = await browser.newContext(contextOptions);
  return {
    context,
    close: async () => {
      await context.close();
      await browser.close();
    }
  };
}

export async function preparePage(page: Page, url: string, options: PreparePageOptions = {}): Promise<PageHealth> {
  const waitUntil = options.waitUntil ?? "networkidle";
  const timeout = options.timeoutMs ?? 30_000;
  const retries = options.loadRetries ?? 0;
  let lastHealth: PageHealth | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let status: number | undefined;
    try {
      if (attempt > 0) {
        await page.waitForTimeout(options.retryDelayMs ?? 1_000);
      }
      const response = await page.goto(url, { waitUntil, timeout });
      status = response?.status();

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
      lastHealth = health;
      if (health.ok || options.softPageHealth) return health;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastHealth) {
    assertPageHealth(lastHealth);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to load ${url}: ${message}`);
}

export async function hideSelectors(page: Page, selectors: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const selector of selectors) {
    try {
      await page.locator(selector).evaluateAll((elements) => {
        for (const element of elements) {
          if (element instanceof HTMLElement || element instanceof SVGElement) {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const hasText = (element.textContent || "").replace(/\s+/g, "").length > 0;
            const hasMedia = element.matches("img, picture, video, canvas, svg, iframe") || element.querySelector("img, picture, video, canvas, svg, iframe") !== null;
            const hasBackground = style.backgroundImage !== "none" || !/rgba?\(0, 0, 0(?:, 0)?\)|transparent/i.test(style.backgroundColor);
            const hasBorder = ["Top", "Right", "Bottom", "Left"].some((side) => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0);
            const coversViewport = rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.85;
            const shouldMask = !coversViewport || hasText || hasMedia || hasBackground || hasBorder;
            element.setAttribute("data-visual-parity-hidden", "true");
            element.setAttribute("data-visual-parity-mask", shouldMask ? "true" : "false");
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
    const timeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
      Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), ms);
        })
      ]);

    if ("fonts" in document) {
      await timeout(document.fonts.ready.catch(() => undefined), 750);
    }
    const images = Array.from(document.images)
      .filter((image) => image.complete === false)
      .slice(0, 50);
    await timeout(
      Promise.all(
        images.map((image) =>
          image.decode().catch(() => {
            // Broken images are captured in page health; they should not block stabilization.
          })
        )
      ),
      1_000
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await timeout(
      new Promise<void>((resolve) => {
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(() => resolve(), { timeout: 500 });
        } else {
          setTimeout(resolve, 100);
        }
      }),
      600
    );
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

export async function collectHiddenRects(page: Page, coordinates: "document" | "viewport" = "document"): Promise<PageMaskRect[]> {
  return page.evaluate((mode) => {
    return Array.from(document.querySelectorAll("[data-visual-parity-hidden='true']:not([data-visual-parity-mask='false'])"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const offsetX = mode === "document" ? window.scrollX : 0;
        const offsetY = mode === "document" ? window.scrollY : 0;
        const x = Math.max(0, rect.left + offsetX);
        const y = Math.max(0, rect.top + offsetY);
        const right = Math.min(window.innerWidth + offsetX, rect.right + offsetX);
        const bottom = Math.min(mode === "document" ? document.documentElement.scrollHeight : window.innerHeight, rect.bottom + offsetY);
        return {
          selector: element.id ? `#${element.id}` : element.className ? `.${String(element.className).trim().split(/\s+/)[0]}` : element.tagName.toLowerCase(),
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          width: Number(Math.max(0, right - x).toFixed(2)),
          height: Number(Math.max(0, bottom - y).toFixed(2))
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }, coordinates);
}

export async function scrollToPosition(page: Page, position: number): Promise<number> {
  return page.evaluate(async (targetPosition) => {
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const requestedY = targetPosition >= 0 && targetPosition <= 1 ? maxY * targetPosition : targetPosition;
    const y = Math.max(0, Math.min(maxY, requestedY));
    window.scrollTo(0, y);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Number(window.scrollY.toFixed(2));
  }, position);
}

export async function screenshotFirstMatch(page: Page, selector: string, outputPath: string): Promise<string | undefined> {
  const locator = page.locator(selector).first();
  const count = await page.locator(selector).count();
  if (count < 1) return undefined;
  await ensureDir(path.dirname(outputPath));
  await locator.screenshot({ path: outputPath, animations: "disabled" });
  return outputPath;
}
