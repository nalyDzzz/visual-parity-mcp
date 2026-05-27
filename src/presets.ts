export interface VisualParityPreset {
  selectors?: string[];
  hideSelectors?: string[];
}

export const VISUAL_PARITY_PRESETS: Record<string, VisualParityPreset> = {
  hubspot: {
    selectors: [
      "body",
      "header",
      "nav",
      "main",
      "footer",
      "section",
      "h1",
      "h2",
      "h3",
      "p",
      "a",
      "button",
      "[class*='hero' i]",
      "[class*='cta' i]",
      "[class*='button' i]",
      "[class*='card' i]",
      "[class*='rich-text' i]",
      "[class*='module' i]"
    ],
    hideSelectors: [
      "#hs-eu-cookie-confirmation",
      "#hs-banner-parent",
      ".hs-cookie-notification-position-bottom",
      ".hs-cookie-notification-position-top",
      "[id^='hs-eu-']",
      "[class*='hs-cookie' i]",
      "[class*='cookie' i]",
      "iframe[src*='hubspot']",
      "iframe[src*='hsforms']",
      "iframe[src*='hs-scripts']",
      "iframe[title*='chat' i]",
      "iframe[title*='HubSpot' i]",
      "[class*='chat' i]",
      "[id*='chat' i]",
      ".grecaptcha-badge",
      "[data-test-id*='chat' i]",
      "[data-testid*='chat' i]",
      "[aria-live]"
    ]
  }
};

export function applyPresets<T extends { selectors?: string[]; hideSelectors?: string[]; presets?: string[] }>(options: T): T {
  const presetNames = options.presets ?? [];
  const selectors = [...(options.selectors ?? [])];
  const hideSelectors = [...(options.hideSelectors ?? [])];

  for (const name of presetNames) {
    const preset = VISUAL_PARITY_PRESETS[name];
    if (!preset) {
      throw new Error(`Unknown visual parity preset "${name}". Known presets: ${Object.keys(VISUAL_PARITY_PRESETS).join(", ")}`);
    }
    selectors.push(...(preset.selectors ?? []));
    hideSelectors.push(...(preset.hideSelectors ?? []));
  }

  return {
    ...options,
    selectors: Array.from(new Set(selectors)),
    hideSelectors: Array.from(new Set(hideSelectors))
  };
}
