(() => {
  const chrome = (globalThis as any).chrome;
  const DEBUG = false;
  const log = (...args: any[]) => {
    if (DEBUG) {
      console.log("[Font Switcher][content]", ...args);
    }
  };
  const warn = (...args: any[]) => {
    if (DEBUG) {
      console.warn("[Font Switcher][content]", ...args);
    }
  };

  const STYLE_ID = "__font_switcher_style__";
  const SHADOW_STYLE_ID = "__font_switcher_shadow_style__";
  const LINK_ID = "__font_switcher_link__";
  const DATA_FONT_VALUE = "data-font-switcher-font-value";
  const DATA_FONT_PRIORITY = "data-font-switcher-font-priority";
  const DATA_SIZE_VALUE = "data-font-switcher-size-value";
  const DATA_SIZE_PRIORITY = "data-font-switcher-size-priority";
  const DEFAULT_SIZE = 16;

  type FontSource = "web" | "system";

  const shadowState: {
    hasFont: boolean;
    hasSize: boolean;
    fontFamily: string | null;
    fontSize: number;
  } = {
    hasFont: false,
    hasSize: false,
    fontFamily: null,
    fontSize: DEFAULT_SIZE
  };
  let shadowHookInstalled = false;
  let shadowObserver: MutationObserver | null = null;
  let shadowResyncTimer: number | null = null;

  type FontSettings = {
    hasCustomFont: boolean;
    hasCustomSize: boolean;
    fontFamily: string | null;
    fontSize: number | null;
    fontSource?: FontSource;
  };


  installShadowHook();
  registerMessageListener();
  void init();

  async function init(): Promise<void> {
    log("init", { url: location.href });
    const siteSettings = await requestSiteSettings();
    log("site settings", siteSettings);
    if (siteSettings) {
      applyFromSettings(siteSettings);
    } else {
      resetFont();
    }
  }

  function registerMessageListener(): void {
    chrome.runtime.onMessage.addListener(
      (
        message: {
          type?: string;
          fontFamily?: string | null;
          fontSource?: FontSource;
          fontSize?: number;
        },
        _sender: any,
        sendResponse: (
          response: { ok: boolean; fontSize?: number | null; fontBlocked?: boolean }
        ) => void
      ) => {
        log("message", message);
        if (!message || !message.type) {
          sendResponse({ ok: false });
          return;
        }
        if (message.type === "apply-font") {
          void applyFont(
            message.fontFamily || null,
            message.fontSize,
            message.fontSource
          )
            .then((result) => {
              sendResponse({ ok: true, fontBlocked: result.fontBlocked });
            })
            .catch(() => {
              sendResponse({ ok: false });
            });
          return true;
        }
        if (message.type === "reset-font") {
          resetFont();
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "ping") {
          sendResponse({ ok: true });
          return;
        }
        if (message.type === "get-page-font-size") {
          sendResponse({ ok: true, fontSize: readPageFontSize() });
          return;
        }
        sendResponse({ ok: false });
      }
    );
  }


  function applyFromSettings(settings: FontSettings): void {
    log("applyFromSettings", settings);
    if (!settings.hasCustomFont && !settings.hasCustomSize) {
      resetFont();
      return;
    }
    void applyFont(settings.fontFamily, settings.fontSize, settings.fontSource);
  }

  function resetFont(): void {
    log("resetFont");
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
    const link = document.getElementById(LINK_ID);
    if (link) {
      link.remove();
    }
    clearRootOverrides();
    clearShadowStyles();
    stopShadowObserver();
  }

  function readPageFontSize(): number | null {
    const sampled = sampleCommonFontSize();
    if (sampled !== null) {
      return sampled;
    }
    const candidates: string[] = [];
    if (document.body) {
      candidates.push(getComputedStyle(document.body).fontSize);
    }
    if (document.documentElement) {
      candidates.push(getComputedStyle(document.documentElement).fontSize);
    }
    for (const value of candidates) {
      const size = Number.parseFloat(value);
      if (Number.isFinite(size) && size > 0) {
        return size;
      }
    }
    return null;
  }

  function sampleCommonFontSize(): number | null {
    const root = document.body || document.documentElement;
    if (!root) {
      return null;
    }

    const counts = new Map<number, number>();
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node && node.nodeValue ? node.nodeValue.trim() : "";
          return text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      } as any
    );

    let scanned = 0;
    let current = walker.nextNode();
    while (current && scanned < 240) {
      const text = (current.nodeValue || "").trim();
      const el = current.parentElement;
      if (el && isVisibleTextElement(el)) {
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (Number.isFinite(size) && size > 0) {
          const rounded = Math.round(size);
          const weight = Math.min(text.length, 24);
          counts.set(rounded, (counts.get(rounded) || 0) + weight);
          scanned += 1;
        }
      }
      current = walker.nextNode();
    }

    if (!counts.size) {
      return null;
    }
    let bestSize: number | null = null;
    let bestScore = -1;
    counts.forEach((score, size) => {
      if (score > bestScore) {
        bestScore = score;
        bestSize = size;
      }
    });
    return bestSize;
  }

  function isVisibleTextElement(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const opacity = Number.parseFloat(style.opacity || "1");
    if (Number.isFinite(opacity) && opacity <= 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function applyFont(
    fontFamily: string | null,
    fontSize?: number | null,
    fontSource?: FontSource
  ): Promise<{ fontBlocked: boolean }> {
    const hasFont = Boolean(fontFamily);
    const hasSize =
      fontSize !== null &&
      fontSize !== undefined &&
      Number.isFinite(Number(fontSize)) &&
      Number(fontSize) > 0;
    const sizeNumber = hasSize ? Number(fontSize) : DEFAULT_SIZE;
    const source: FontSource = fontSource === "system" ? "system" : "web";
    log("applyFont", { fontFamily, fontSize, hasFont, hasSize, sizeNumber });

    if (!hasFont && !hasSize) {
      resetFont();
      return { fontBlocked: false };
    }

    let fontBlocked = false;
    if (hasFont) {
      if (source === "web") {
        const available = await ensureWebFontAvailable(fontFamily as string);
        fontBlocked = !available;
      } else {
        removeFontLink();
      }
    } else {
      removeFontLink();
    }

    ensureStyle(fontFamily, sizeNumber, { hasFont, hasSize });
    applyRootOverrides(fontFamily, sizeNumber, { hasFont, hasSize });
    syncShadowStyles(fontFamily, sizeNumber, { hasFont, hasSize });
    if (hasFont || hasSize) {
      startShadowObserver();
    } else {
      stopShadowObserver();
    }
    return { fontBlocked };
  }

  function ensureFontLink(fontFamily: string): HTMLLinkElement {
    const head = document.head || document.documentElement;
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      head.appendChild(link);
    }
    link.href = buildGoogleFontsUrl(fontFamily);
    log("ensureFontLink", link.href);
    return link;
  }

  type LinkLoadState = "load" | "error" | "timeout";

  function waitForLinkState(
    link: HTMLLinkElement,
    timeoutMs: number
  ): Promise<LinkLoadState> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (state: LinkLoadState) => {
        if (settled) {
          return;
        }
        settled = true;
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
        resolve(state);
      };
      const onLoad = () => done("load");
      const onError = () => done("error");
      link.addEventListener("load", onLoad, { once: true });
      link.addEventListener("error", onError, { once: true });
      window.setTimeout(() => done("timeout"), timeoutMs);
    });
  }

  async function ensureWebFontAvailable(fontFamily: string): Promise<boolean> {
    const link = ensureFontLink(fontFamily);
    const linkState = await waitForLinkState(link, 2200);
    if (linkState === "error") {
      return false;
    }

    const fonts = (document as any).fonts as FontFaceSet | undefined;
    if (!fonts || typeof fonts.load !== "function") {
      return true;
    }
    const spec = `16px "${fontFamily}"`;

    try {
      await fonts.load(spec);
    } catch (error) {
      if (linkState === "load") {
        return false;
      }
      return true;
    }

    if (fonts.check(spec)) {
      return true;
    }

    // Do not mark as blocked on timeout/slow load; only explicit load errors.
    if (linkState === "timeout") {
      return true;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    return fonts.check(spec);
  }

  function removeFontLink(): void {
    const link = document.getElementById(LINK_ID);
    if (link) {
      link.remove();
    }
  }

  function ensureStyle(
    fontFamily: string | null,
    fontSize: number,
    options: { hasFont: boolean; hasSize: boolean }
  ): void {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    const rules: string[] = [];
    if (options.hasFont && fontFamily) {
      const safeFamily = String(fontFamily).replace(/"/g, "\\\"");
      rules.push(`font-family: "${safeFamily}", sans-serif !important;`);
    }
    if (options.hasSize) {
      rules.push(`font-size: ${fontSize}px !important;`);
    }

    if (!rules.length) {
      resetFont();
      return;
    }

  style.textContent = `
html, body, body *, input, textarea, select, button {
  ${rules.join("\n  ")}
}
`;
    log("ensureStyle rules", rules);
  }

  function applyRootOverrides(
    fontFamily: string | null,
    fontSize: number,
    options: { hasFont: boolean; hasSize: boolean }
  ): void {
    log("applyRootOverrides", { fontFamily, fontSize, options });
    const targets: HTMLElement[] = [];
    if (document.documentElement) {
      targets.push(document.documentElement);
    }
    if (document.body) {
      targets.push(document.body);
    }

    targets.forEach((el) => {
      if (options.hasFont && fontFamily) {
        stashInlineStyle(el, "font-family", DATA_FONT_VALUE, DATA_FONT_PRIORITY);
        el.style.setProperty(
          "font-family",
          `"${fontFamily}", sans-serif`,
          "important"
        );
      } else {
        restoreInlineStyle(el, "font-family", DATA_FONT_VALUE, DATA_FONT_PRIORITY);
      }

      if (options.hasSize) {
        stashInlineStyle(el, "font-size", DATA_SIZE_VALUE, DATA_SIZE_PRIORITY);
        el.style.setProperty("font-size", `${fontSize}px`, "important");
      } else {
        restoreInlineStyle(el, "font-size", DATA_SIZE_VALUE, DATA_SIZE_PRIORITY);
      }
    });
  }

  function clearRootOverrides(): void {
    const targets: HTMLElement[] = [];
    if (document.documentElement) {
      targets.push(document.documentElement);
    }
    if (document.body) {
      targets.push(document.body);
    }
    targets.forEach((el) => {
      restoreInlineStyle(el, "font-family", DATA_FONT_VALUE, DATA_FONT_PRIORITY);
      restoreInlineStyle(el, "font-size", DATA_SIZE_VALUE, DATA_SIZE_PRIORITY);
    });
  }

  function installShadowHook(): void {
    if (shadowHookInstalled) {
      return;
    }
    shadowHookInstalled = true;
    const original = Element.prototype.attachShadow;
    if (typeof original !== "function") {
      return;
    }
    Element.prototype.attachShadow = function (
      init: ShadowRootInit
    ): ShadowRoot {
      const root = original.call(this, init);
      try {
        syncShadowRoot(root);
      } catch (error) {
        // ignore shadow sync errors
      }
      return root;
    };
  }

  function syncShadowStyles(
    fontFamily: string | null,
    fontSize: number,
    options: { hasFont: boolean; hasSize: boolean }
  ): void {
    setShadowState(fontFamily, fontSize, options);
    const roots = collectOpenShadowRoots(document);
    roots.forEach((root) => {
      syncShadowRoot(root);
    });
  }

  function clearShadowStyles(): void {
    setShadowState(null, DEFAULT_SIZE, { hasFont: false, hasSize: false });
    const roots = collectOpenShadowRoots(document);
    roots.forEach((root) => removeShadowStyle(root));
  }

  function startShadowObserver(): void {
    if (shadowObserver) {
      return;
    }
    const target = document.documentElement || document;
    shadowObserver = new MutationObserver(() => {
      scheduleShadowResync();
    });
    shadowObserver.observe(target, {
      childList: true,
      subtree: true
    });
  }

  function stopShadowObserver(): void {
    if (shadowObserver) {
      shadowObserver.disconnect();
      shadowObserver = null;
    }
    if (shadowResyncTimer !== null) {
      window.clearTimeout(shadowResyncTimer);
      shadowResyncTimer = null;
    }
  }

  function scheduleShadowResync(): void {
    if (!shadowState.hasFont && !shadowState.hasSize) {
      return;
    }
    if (shadowResyncTimer !== null) {
      return;
    }
    shadowResyncTimer = window.setTimeout(() => {
      shadowResyncTimer = null;
      syncShadowStyles(shadowState.fontFamily, shadowState.fontSize, {
        hasFont: shadowState.hasFont,
        hasSize: shadowState.hasSize
      });
    }, 80);
  }

  function setShadowState(
    fontFamily: string | null,
    fontSize: number,
    options: { hasFont: boolean; hasSize: boolean }
  ): void {
    shadowState.hasFont = options.hasFont;
    shadowState.hasSize = options.hasSize;
    shadowState.fontFamily = fontFamily;
    shadowState.fontSize = fontSize;
  }

  function syncShadowRoot(root: ShadowRoot): void {
    if (!shadowState.hasFont && !shadowState.hasSize) {
      removeShadowStyle(root);
      return;
    }
    ensureShadowStyle(root, shadowState.fontFamily, shadowState.fontSize, {
      hasFont: shadowState.hasFont,
      hasSize: shadowState.hasSize
    });
  }

  function collectOpenShadowRoots(
    root: Document | ShadowRoot
  ): ShadowRoot[] {
    const roots: ShadowRoot[] = [];
    const rootNode =
      root instanceof Document ? root.documentElement : root;
    if (!rootNode) {
      return roots;
    }
    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_ELEMENT
    );
    let node = walker.nextNode();
    while (node) {
      const el = node as Element;
      const shadow = (el as any).shadowRoot as ShadowRoot | null;
      if (shadow) {
        roots.push(shadow);
        const nested = collectOpenShadowRoots(shadow);
        if (nested.length) {
          roots.push(...nested);
        }
      }
      node = walker.nextNode();
    }
    return roots;
  }

  function ensureShadowStyle(
    root: ShadowRoot,
    fontFamily: string | null,
    fontSize: number,
    options: { hasFont: boolean; hasSize: boolean }
  ): void {
    let style = root.querySelector<HTMLStyleElement>(`#${SHADOW_STYLE_ID}`);
    if (!style) {
      style = document.createElement("style");
      style.id = SHADOW_STYLE_ID;
      root.appendChild(style);
    }
    const rules: string[] = [];
    if (options.hasFont && fontFamily) {
      const safeFamily = String(fontFamily).replace(/"/g, "\\\"");
      rules.push(`font-family: "${safeFamily}", sans-serif !important;`);
    }
    if (options.hasSize) {
      rules.push(`font-size: ${fontSize}px !important;`);
    }
    if (!rules.length) {
      removeShadowStyle(root);
      return;
    }
    style.textContent = `
:host, :host *, ::slotted(*), * {
  ${rules.join("\n  ")}
}
`;
  }

  function removeShadowStyle(root: ShadowRoot): void {
    const style = root.querySelector<HTMLStyleElement>(`#${SHADOW_STYLE_ID}`);
    if (style) {
      style.remove();
    }
  }

  function stashInlineStyle(
    el: HTMLElement,
    prop: "font-family" | "font-size",
    valueAttr: string,
    priorityAttr: string
  ): void {
    if (el.getAttribute(valueAttr) !== null) {
      return;
    }
    const value = el.style.getPropertyValue(prop);
    const priority = el.style.getPropertyPriority(prop);
    el.setAttribute(valueAttr, value);
    if (priority) {
      el.setAttribute(priorityAttr, priority);
    }
  }

  function restoreInlineStyle(
    el: HTMLElement,
    prop: "font-family" | "font-size",
    valueAttr: string,
    priorityAttr: string
  ): void {
    const storedValue = el.getAttribute(valueAttr);
    if (storedValue === null) {
      return;
    }
    const storedPriority = el.getAttribute(priorityAttr) || "";
    if (storedValue) {
      el.style.setProperty(prop, storedValue, storedPriority);
    } else {
      el.style.removeProperty(prop);
    }
    el.removeAttribute(valueAttr);
    el.removeAttribute(priorityAttr);
  }

  function buildGoogleFontsUrl(font: string): string {
    const family = String(font || "Roboto").trim().replace(/\s+/g, "+");
    const encoded = encodeURIComponent(family).replace(/%2B/g, "+");
    return (
      "https://fonts.googleapis.com/css2?family=" +
      encoded +
      ":wght@300;400;500;600;700&display=swap"
    );
  }

  function requestSiteSettings(): Promise<FontSettings | null> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "get-site-settings", host: location.hostname },
        (response: any) => {
          if (chrome.runtime.lastError) {
            warn("get-site-settings error", chrome.runtime.lastError);
            resolve(null);
            return;
          }
          resolve(response && response.settings ? response.settings : null);
        }
      );
    });
  }

})();
