(() => {
  const chrome = (globalThis as any).chrome;
  const manifest =
    chrome &&
    chrome.runtime &&
    typeof chrome.runtime.getManifest === "function"
      ? chrome.runtime.getManifest()
      : null;
  const IS_DEV_BUILD =
    Boolean(manifest && typeof manifest.version_name === "string") &&
    /(^|[._-])dev([._-]|$)/i.test(String(manifest.version_name));
  const DEBUG_OVERRIDE = Boolean((globalThis as any).__FONT_SWITCHER_DEBUG__);
  const DEBUG = IS_DEV_BUILD || DEBUG_OVERRIDE;
  const SCAN_DEBUG = IS_DEV_BUILD || DEBUG_OVERRIDE;
  const log = (...args: any[]) => {
    if (DEBUG) {
      console.log("[Font Switcher][popup]", ...args);
    }
  };
  const warn = (...args: any[]) => {
    if (DEBUG) {
      console.warn("[Font Switcher][popup]", ...args);
    }
  };
  const scanLog = (...args: any[]) => {
    if (SCAN_DEBUG) {
      console.log("[Font Switcher][system-scan]", ...args);
    }
  };
  const scanWarn = (...args: any[]) => {
    if (SCAN_DEBUG) {
      console.warn("[Font Switcher][system-scan]", ...args);
    }
  };

  const DEFAULT_FONT_VALUE = "__default__";
  const DEFAULT_SIZE = 16;
  const DEFAULT_LANG = "ru";
  const SETTINGS_VERSION = 2;
  const SITE_SETTINGS_PREFIX = "siteSettings:";
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

  const POPULAR_FONTS = [
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Raleway",
    "Oswald",
    "Playfair Display",
    "Merriweather",
    "Nunito"
  ];

  const FALLBACK_FONTS = [
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Oswald",
    "Source Sans 3",
    "Raleway",
    "Nunito",
    "Poppins",
    "Merriweather",
    "Playfair Display",
    "PT Sans",
    "PT Serif",
    "Ubuntu",
    "Rubik",
    "Inter",
    "Noto Sans",
    "Noto Serif",
    "Fira Sans",
    "Fira Code"
  ];

  type Lang = "ru" | "en" | "de";
  type FontSource = "web" | "system";

  type FontSettings = {
    hasCustomFont: boolean;
    hasCustomSize: boolean;
    fontFamily: string | null;
    fontSize: number;
    siteHost?: string;
    version?: number;
    fontSource?: FontSource;
  };

  const I18N: Record<
    Lang,
    {
      title: string;
      subtitle: string;
      labelFont: string;
      labelSystemFont: string;
      labelSize: string;
      labelReset: string;
      placeholder: string;
      systemPlaceholder: string;
      systemApply: string;
      systemScan: string;
      systemHint: string;
      systemEmpty: string;
      systemScanUnavailable: string;
      systemScanDenied: string;
      systemScanReady: string;
      currentLabel: string;
      statusApplied: string;
      statusReset: string;
      statusError: string;
      webFontsBlocked: string;
      noResults: string;
      defaultFont: string;
    }
  > = {
    ru: {
      title: "Шрифты",
      subtitle: "Google Fonts для текущей страницы",
      labelFont: "Google Fonts",
      labelSystemFont: "Системный шрифт",
      labelSize: "Размер",
      labelReset: "Сбросить",
      placeholder: "Поиск Google Fonts",
      systemPlaceholder: "Введите системный шрифт",
      systemApply: "Применить",
      systemScan: "Сканировать",
      systemHint:
        "Введите название или нажмите Сканировать, чтобы показать установленные шрифты.",
      systemEmpty: "Нажмите Сканировать, чтобы показать установленные шрифты",
      systemScanUnavailable: "Сканирование недоступно",
      systemScanDenied: "Доступ к системным шрифтам отклонен",
      systemScanReady: "Шрифты загружены",
      currentLabel: "Выбран:",
      statusApplied: "Применено",
      statusReset: "Сброшено",
      statusError: "Нельзя применить на этой странице",
      webFontsBlocked:
        "Этот сайт блокирует Google Fonts. Используйте системный шрифт ниже.",
      noResults: "Ничего не найдено",
      defaultFont: "По умолчанию"
    },
    en: {
      title: "Fonts",
      subtitle: "Google Fonts for the current page",
      labelFont: "Google font",
      labelSystemFont: "System font",
      labelSize: "Size",
      labelReset: "Reset",
      placeholder: "Search Google Fonts",
      systemPlaceholder: "Type a system font",
      systemApply: "Apply",
      systemScan: "Scan",
      systemHint: "Type a font name or scan installed fonts.",
      systemEmpty: "Click Scan to list installed fonts",
      systemScanUnavailable: "Scan not available",
      systemScanDenied: "Font access denied",
      systemScanReady: "Fonts loaded",
      currentLabel: "Selected:",
      statusApplied: "Applied",
      statusReset: "Reset",
      statusError: "Can't apply on this page",
      webFontsBlocked:
        "This site blocks Google Fonts. Use the system font below.",
      noResults: "No results",
      defaultFont: "Default"
    },
    de: {
      title: "Schriften",
      subtitle: "Google Fonts für die aktuelle Seite",
      labelFont: "Google Fonts",
      labelSystemFont: "Systemschrift",
      labelSize: "Größe",
      labelReset: "Zurücksetzen",
      placeholder: "Google-Schrift suchen",
      systemPlaceholder: "Systemschrift eingeben",
      systemApply: "Anwenden",
      systemScan: "Scannen",
      systemHint: "Name eingeben oder installierte Schriften scannen.",
      systemEmpty: "Scannen, um installierte Schriften zu laden",
      systemScanUnavailable: "Scan nicht verfügbar",
      systemScanDenied: "Schriftzugriff verweigert",
      systemScanReady: "Schriften geladen",
      currentLabel: "Ausgewählt:",
      statusApplied: "Angewendet",
      statusReset: "Zurückgesetzt",
      statusError: "Auf dieser Seite nicht möglich",
      webFontsBlocked:
        "Diese Seite blockiert Google Fonts. Verwende unten eine Systemschrift.",
      noResults: "Keine Treffer",
      defaultFont: "Standard"
    }

  };

  const fontSearch = document.getElementById("fontSearch") as HTMLInputElement;
  const fontList = document.getElementById("fontList") as HTMLDivElement;
  const webFontNotice = document.getElementById("webFontNotice") as HTMLDivElement;
  const systemFontSearch = document.getElementById(
    "systemFontSearch"
  ) as HTMLInputElement;
  const systemFontList = document.getElementById(
    "systemFontList"
  ) as HTMLDivElement;
  const currentFont = document.getElementById("currentFont") as HTMLSpanElement;
  const sizeRange = document.getElementById("fontSize") as HTMLInputElement;
  const sizeNumber = document.getElementById("fontSizeNumber") as HTMLInputElement;
  const statusEl = document.getElementById("status") as HTMLDivElement;
  const fontCombo = document.getElementById("fontCombo") as HTMLDivElement;
  const systemFontCombo = document.getElementById(
    "systemFontCombo"
  ) as HTMLDivElement;
  const systemFontApply = document.getElementById(
    "systemFontApply"
  ) as HTMLButtonElement;
  const systemFontScan = document.getElementById(
    "systemFontScan"
  ) as HTMLButtonElement;
  const systemFontHint = document.getElementById(
    "systemFontHint"
  ) as HTMLDivElement;
  const titleEl = document.getElementById("title") as HTMLDivElement;
  const subtitleEl = document.getElementById("subtitle") as HTMLDivElement;
  const labelFontEl = document.getElementById(
    "labelFont"
  ) as HTMLLabelElement;
  const labelSystemFontEl = document.getElementById(
    "labelSystemFont"
  ) as HTMLLabelElement;
  const labelSizeEl = document.getElementById(
    "labelSize"
  ) as HTMLLabelElement;
  const resetButton = document.getElementById(
    "resetButton"
  ) as HTMLButtonElement;
  const currentLabelEl = document.getElementById(
    "currentLabel"
  ) as HTMLSpanElement;
  const langButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".langButton")
  );

  let allFonts: string[] = [];
  let selectedFont = DEFAULT_FONT_VALUE;
  let selectedSystemFont = "";
  let fontSource: FontSource = "web";
  let selectedSize = DEFAULT_SIZE;
  let hasCustomFont = false;
  let hasCustomSize = false;
  let listOpen = false;
  let systemListOpen = false;
  let systemFonts: string[] = [];
  let webFontsBlocked = false;
  let systemHintMessage: string | null = null;
  let systemScanMessage: string | null = null;
  let currentLang: Lang = DEFAULT_LANG;
  let activeTabId: number | null = null;
  let activeTabUrl: string | null = null;
  let pageDefaultSize: number | null = null;

  init().catch((error) => {
    console.error("[Font Switcher][popup]", error);
  });

  async function init(): Promise<void> {
    const tab = await getActiveTab();
    activeTabId = tab && tab.id ? tab.id : null;
    activeTabUrl = tab && tab.url ? tab.url : null;
    log("init", { activeTabId, url: activeTabUrl });

    const stored = await storageSyncGet({
      uiLang: DEFAULT_LANG
    });

    currentLang = (stored.uiLang as Lang) || DEFAULT_LANG;
    const initialSettings = await loadSiteSettings(activeTabUrl);

    applySettingsToState(initialSettings);
    await syncDefaultSizeFromPage();
    log("initial settings", initialSettings, {
      selectedFont,
      selectedSize,
      hasCustomFont,
      hasCustomSize,
      pageDefaultSize
    });

    webFontsBlocked = false;
    applyLanguage();
    setFontInputValue(selectedFont);
    setSystemFontInputValue(selectedSystemFont);
    updateCurrentFontLabel();
    sizeRange.value = String(selectedSize);
    sizeNumber.value = String(selectedSize);
    updateWebFontAvailability();

    await loadFonts();
    renderList("");
    renderSystemList("");
    wireEvents();
  }

  function wireEvents(): void {
    fontSearch.addEventListener("input", (event) => {
      const value = (event.target as HTMLInputElement).value;
      renderList(value);
      openList();
    });

    fontSearch.addEventListener("focus", () => {
      renderList("");
      openList();
      fontSearch.select();
    });

    fontSearch.addEventListener("click", () => {
      if (!listOpen) {
        renderList("");
        openList();
      }
    });

    fontCombo.addEventListener("click", (event) => {
      if (event.target === fontSearch) {
        return;
      }
      renderList("");
      openList();
      fontSearch.focus();
    });

    systemFontSearch.addEventListener("input", (event) => {
      const value = (event.target as HTMLInputElement).value;
      if (systemScanMessage) {
        systemScanMessage = null;
        setSystemHint(null);
      }
      const matchesCount = renderSystemList(value);
      if (matchesCount > 0) {
        openSystemList();
      } else {
        closeSystemList();
      }
    });

    systemFontSearch.addEventListener("focus", () => {
      const matchesCount = renderSystemList("");
      if (matchesCount > 0) {
        openSystemList();
      }
      systemFontSearch.select();
    });

    systemFontSearch.addEventListener("click", () => {
      if (!systemListOpen) {
        const matchesCount = renderSystemList("");
        if (matchesCount > 0) {
          openSystemList();
        }
      }
    });

    systemFontSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        selectSystemFont(systemFontSearch.value);
      }
    });

    systemFontCombo.addEventListener("click", (event) => {
      if (
        event.target === systemFontSearch ||
        event.target === systemFontApply ||
        event.target === systemFontScan
      ) {
        return;
      }
      const matchesCount = renderSystemList("");
      if (matchesCount > 0) {
        openSystemList();
      }
      systemFontSearch.focus();
    });

    document.addEventListener("click", (event) => {
      if (
        !fontCombo.contains(event.target as Node) &&
        !fontList.contains(event.target as Node)
      ) {
        closeList();
      }
      if (
        !systemFontCombo.contains(event.target as Node) &&
        !systemFontList.contains(event.target as Node)
      ) {
        closeSystemList();
      }
    });

    fontList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest(
        "button[data-font]"
      ) as HTMLButtonElement | null;
      if (!button) {
        return;
      }
      selectFont(button.dataset.font || DEFAULT_FONT_VALUE);
    });

    systemFontList.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest(
        "button[data-font]"
      ) as HTMLButtonElement | null;
      if (!button) {
        return;
      }
      selectSystemFont(button.dataset.font || "");
    });

    systemFontApply.addEventListener("click", () => {
      selectSystemFont(systemFontSearch.value);
    });

    systemFontScan.addEventListener("click", () => {
      scanLog("scan button clicked");
      void scanSystemFonts();
    });

    sizeRange.addEventListener("input", (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      updateSize(value);
    });

    sizeNumber.addEventListener("change", (event) => {
      const value = clampSize(Number((event.target as HTMLInputElement).value));
      updateSize(value);
    });

    resetButton.addEventListener("click", () => {
      void resetAll();
    });

    langButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setLanguage(button.dataset.lang as Lang);
      });
    });
  }

  function setLanguage(lang: Lang): void {
    if (!I18N[lang]) {
      return;
    }
    currentLang = lang;
    applyLanguage();
    renderList(fontSearch.value);
    chrome.storage.sync.set({ uiLang: currentLang });
  }

  function applyLanguage(): void {
    const dict = I18N[currentLang] || I18N[DEFAULT_LANG];
    titleEl.textContent = dict.title;
    subtitleEl.textContent = dict.subtitle;
    labelFontEl.textContent = dict.labelFont;
    labelSystemFontEl.textContent = dict.labelSystemFont;
    labelSizeEl.textContent = dict.labelSize;
    resetButton.textContent = dict.labelReset;
    fontSearch.placeholder = dict.placeholder;
    systemFontSearch.placeholder = dict.systemPlaceholder;
    systemFontApply.textContent = dict.systemApply;
    systemFontScan.textContent = dict.systemScan;
    systemFontHint.textContent = systemHintMessage || dict.systemHint;
    currentLabelEl.textContent = dict.currentLabel;
    if (webFontsBlocked) {
      webFontNotice.textContent = dict.webFontsBlocked;
      webFontNotice.classList.remove("hidden");
    } else {
      webFontNotice.textContent = "";
      webFontNotice.classList.add("hidden");
    }
    updateLangButtons();
    if (isDefaultFont(selectedFont)) {
      setFontInputValue(selectedFont);
      updateCurrentFontLabel();
    }
  }

  function updateLangButtons(): void {
    langButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.lang === currentLang);
    });
  }

  function updateSize(value: number): void {
    const clamped = clampSize(value);
    selectedSize = clamped;
    hasCustomSize = true;
    sizeRange.value = String(clamped);
    sizeNumber.value = String(clamped);
    void applySettings();
  }

  function clampSize(value: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_SIZE;
    }
    return Math.min(Math.max(value, 10), 72);
  }

  function normalizeFontSize(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return clampSize(parsed);
  }

  function getBaselineSize(): number {
    return pageDefaultSize ?? DEFAULT_SIZE;
  }

  function openList(): void {
    closeSystemList();
    fontList.classList.remove("hidden");
    listOpen = true;
  }

  function closeList(): void {
    fontList.classList.add("hidden");
    listOpen = false;
  }

  function openSystemList(): void {
    closeList();
    systemFontList.classList.remove("hidden");
    systemListOpen = true;
  }

  function closeSystemList(): void {
    systemFontList.classList.add("hidden");
    systemListOpen = false;
  }

  function renderList(query: string): void {
    const normalizedQuery = (query || "").trim().toLowerCase();
    const source = getOrderedFonts();
    const matches = source
      .filter((font) =>
        fontToDisplayName(font).toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 120);

    fontList.innerHTML = "";

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "listItem";
      empty.textContent = t("noResults");
      empty.setAttribute("aria-disabled", "true");
      fontList.appendChild(empty);
      return;
    }

    for (const font of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "listItem";
      if (font === selectedFont) {
        button.classList.add("selected");
      }
      button.textContent = fontToDisplayName(font);
      button.dataset.font = font;
      fontList.appendChild(button);
    }
  }

  function renderSystemList(query: string): number {
    const normalizedQuery = (query || "").trim().toLowerCase();
    const source = systemFonts.length ? systemFonts : [];
    const matches = source
      .filter((font) => font.toLowerCase().includes(normalizedQuery))
      .slice(0, 120);

    systemFontList.innerHTML = "";

    if (!matches.length) {
      return 0;
    }

    for (const font of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "listItem";
      if (font === selectedSystemFont) {
        button.classList.add("selected");
      }
      button.textContent = font;
      button.dataset.font = font;
      systemFontList.appendChild(button);
    }
    return matches.length;
  }

  function selectFont(font: string): void {
    selectedFont = font || DEFAULT_FONT_VALUE;
    hasCustomFont = !isDefaultFont(selectedFont);
    fontSource = "web";
    if (hasCustomFont && !hasCustomSize) {
      hasCustomSize = true;
    }
    setFontInputValue(selectedFont);
    updateCurrentFontLabel();

    renderList(fontSearch.value);
    closeList();
    void applySettings();
  }

  function setFontInputValue(font: string): void {
    fontSearch.value = fontToDisplayName(font);
  }

  function setSystemFontInputValue(font: string): void {
    systemFontSearch.value = font || "";
  }

  function selectSystemFont(font: string): void {
    const normalized = String(font || "").trim();
    const wasSystem = fontSource === "system";
    if (normalized) {
      selectedSystemFont = normalized;
      fontSource = "system";
      hasCustomFont = true;
      if (!hasCustomSize) {
        hasCustomSize = true;
      }
    } else {
      selectedSystemFont = "";
      if (wasSystem) {
        hasCustomFont = false;
        fontSource = "web";
      }
    }

    setSystemFontInputValue(selectedSystemFont);
    updateCurrentFontLabel();
    renderSystemList(systemFontSearch.value);
    closeSystemList();
    if (normalized || wasSystem) {
      void applySettings();
    }
  }

  function updateCurrentFontLabel(): void {
    currentFont.textContent = fontToDisplayName(getActiveFont() || "");
  }

  function getActiveFont(): string | null {
    if (!hasCustomFont) {
      return null;
    }
    if (fontSource === "system") {
      return selectedSystemFont || null;
    }
    return isDefaultFont(selectedFont) ? null : selectedFont;
  }

  function updateWebFontAvailability(): void {
    fontCombo.classList.toggle("disabled", webFontsBlocked);
    fontSearch.disabled = webFontsBlocked;
    if (webFontsBlocked) {
      closeList();
      webFontNotice.textContent = t("webFontsBlocked");
      webFontNotice.classList.remove("hidden");
    } else {
      webFontNotice.textContent = "";
      webFontNotice.classList.add("hidden");
    }
  }

  function setSystemHint(message: string | null): void {
    systemHintMessage = message;
    systemFontHint.textContent = message || t("systemHint");
  }

  function normalizeFontLabel(value: unknown): string {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }
    return text.replace(/\s+/g, " ");
  }

  function extractLocalFontLabel(font: any): string {
    if (!font || typeof font !== "object") {
      return "";
    }
    const primary = normalizeFontLabel(font.family);
    if (primary) {
      return primary;
    }
    const secondary = normalizeFontLabel(font.fullName);
    if (secondary) {
      return secondary;
    }
    return normalizeFontLabel(font.postscriptName);
  }

  function sortUniqueFonts(fonts: string[]): string[] {
    return Array.from(new Set(fonts.filter((font) => font))).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  async function scanSystemFonts(): Promise<void> {
    const fontSettingsApi = (chrome as any).fontSettings as
      | undefined
      | {
          getFontList: () => Promise<
            Array<{ fontId?: string; displayName?: string }>
          >;
        };
    const queryLocalFonts = (window as any).queryLocalFonts as
      | undefined
      | (() => Promise<Array<{ family?: string; fullName?: string; postscriptName?: string }>>);
    const userActivation = (navigator as any).userActivation;
    scanLog("start", {
      secureContext: window.isSecureContext,
      hasFontSettingsApi: Boolean(
        fontSettingsApi && typeof fontSettingsApi.getFontList === "function"
      ),
      hasQueryLocalFonts: Boolean(queryLocalFonts),
      permissionState: "not-queried",
      userActivation: {
        isActive: userActivation ? Boolean(userActivation.isActive) : null,
        hasBeenActive: userActivation ? Boolean(userActivation.hasBeenActive) : null
      }
    });

    let labels: string[] = [];
    let source = "none";

    if (fontSettingsApi && typeof fontSettingsApi.getFontList === "function") {
      try {
        const fonts = await fontSettingsApi.getFontList();
        source = "chrome.fontSettings.getFontList";
        scanLog("fontSettings raw result", {
          count: fonts.length,
          sample: fonts.slice(0, 8).map((font) => ({
            fontId: font?.fontId || null,
            displayName: font?.displayName || null
          }))
        });
        labels = fonts
          .map((font) => normalizeFontLabel(font?.displayName || font?.fontId))
          .filter((label) => label);
      } catch (error) {
        scanWarn("fontSettings.getFontList threw", {
          name: (error as any)?.name || null,
          message: (error as any)?.message || String(error)
        });
      }
    }

    if (!labels.length && queryLocalFonts) {
      try {
        const fonts = await queryLocalFonts();
        source = "window.queryLocalFonts";
        scanLog("queryLocalFonts raw result", {
          count: fonts.length,
          sample: fonts.slice(0, 8).map((font: any) => ({
            family: font?.family || null,
            fullName: font?.fullName || null,
            postscriptName: font?.postscriptName || null,
            style: font?.style || null
          }))
        });
        labels = fonts
          .map((font) => extractLocalFontLabel(font))
          .filter((label) => label);
      } catch (error) {
        scanWarn("queryLocalFonts threw", {
          name: (error as any)?.name || null,
          message: (error as any)?.message || String(error)
        });
      }
    }

    const unique = sortUniqueFonts(labels);
    scanLog("normalized result", {
      source,
      rawCount: labels.length,
      normalizedCount: unique.length,
      normalizedSample: unique.slice(0, 12)
    });

    if (!unique.length) {
      systemFonts = [];
      systemScanMessage =
        source === "none" && !queryLocalFonts
          ? t("systemScanUnavailable")
          : t("noResults");
      setSystemHint(systemScanMessage);
      renderSystemList("");
      closeSystemList();
      scanWarn("no fonts after normalization");
      return;
    }

    systemFonts = unique;
    systemScanMessage = null;
    setSystemHint(`${t("systemScanReady")}: ${unique.length}`);
    setSystemFontInputValue("");
    const matchesCount = renderSystemList("");
    if (matchesCount > 0) {
      openSystemList();
    } else {
      closeSystemList();
    }
  }


  async function applySettings(): Promise<void> {
    const isReset = !hasCustomFont && !hasCustomSize;
    const activeFont = getActiveFont();
    log("applySettings", {
      isReset,
      selectedFont,
      selectedSystemFont,
      fontSource,
      selectedSize,
      hasCustomFont,
      hasCustomSize
    });

    const canStore =
      Boolean(activeTabUrl) && !isRestrictedUrl(activeTabUrl || "");
    if (canStore) {
      if (isReset) {
        await removeSiteSettings(activeTabUrl);
      } else {
        await saveSiteSettings(activeTabUrl, {
          hasCustomFont,
          hasCustomSize,
          fontFamily: activeFont,
          fontSource: activeFont ? fontSource : undefined,
          fontSize: hasCustomSize ? selectedSize : DEFAULT_SIZE
        });
      }
    }

    await applyToActiveTab();
  }

  async function applyToActiveTab(): Promise<void> {
    const tab = await getActiveTab();
    const isReset = !hasCustomFont && !hasCustomSize;
    const activeFont = getActiveFont();

    if (!tab || !tab.id || isRestrictedUrl(tab.url)) {
      warn("applyToActiveTab blocked", { tab });
      const reason = !tab
        ? "no active tab"
        : !tab.id
          ? "missing tab id"
          : `restricted url: ${tab.url || "unknown"}`;
      setStatus(withErrorDetails(t("statusError"), reason), true);
      return;
    }

    const message = isReset
      ? { type: "reset-font" }
      : {
          type: "apply-font",
          fontFamily: activeFont,
          fontSource: activeFont ? fontSource : undefined,
          fontSize: hasCustomSize ? selectedSize : null
        };

    log("sendMessageToTab", { tabId: tab.id, message });
    let sendResult = await sendMessageToTab(tab.id, message);
    if (!sendResult.ok) {
      warn("sendMessage failed, injecting contentScript", { tabId: tab.id });
      const injected = await injectContentScript(tab.id);
      if (injected.ok) {
        sendResult = await sendMessageToTab(tab.id, message);
      } else {
        sendResult.error = injected.error || "inject failed";
      }
    }

    if (sendResult.ok) {
      if (
        hasCustomFont &&
        fontSource === "web" &&
        typeof sendResult.fontBlocked === "boolean"
      ) {
        webFontsBlocked = sendResult.fontBlocked;
        updateWebFontAvailability();
        if (sendResult.fontBlocked) {
          setStatus(t("webFontsBlocked"), true);
          return;
        }
      }
      setStatus(isReset ? t("statusReset") : t("statusApplied"));
    } else {
      setStatus(
        withErrorDetails(t("statusError"), sendResult.error || "unknown error"),
        true
      );
    }
  }

  async function syncDefaultSizeFromPage(): Promise<void> {
    if (hasCustomSize) {
      return;
    }
    const pageSize = await getPageFontSize();
    if (pageSize === null) {
      return;
    }
    pageDefaultSize = clampSize(pageSize);
    selectedSize = pageDefaultSize;
  }

  async function getPageFontSize(): Promise<number | null> {
    const tab = await getActiveTab();
    if (!tab || !tab.id || isRestrictedUrl(tab.url)) {
      warn("getPageFontSize blocked", { tab });
      return null;
    }

    const message = { type: "get-page-font-size" };
    let sendResult = await sendMessageToTab(tab.id, message);
    if (!sendResult.ok) {
      const injected = await injectContentScript(tab.id);
      if (injected.ok) {
        sendResult = await sendMessageToTab(tab.id, message);
      }
    }

    if (!sendResult.ok) {
      warn("getPageFontSize failed", sendResult.error || "unknown error");
      return null;
    }

    const normalized = normalizeFontSize(sendResult.fontSize);
    return normalized === null ? null : normalized;
  }

  async function loadFonts(): Promise<void> {
    log("loadFonts start");
    const { fontsCache, fontsCacheTs } = await storageLocalGet({
      fontsCache: null,
      fontsCacheTs: 0
    });

    if (
      Array.isArray(fontsCache) &&
      fontsCache.length &&
      typeof fontsCacheTs === "number" &&
      Date.now() - fontsCacheTs < CACHE_TTL_MS
    ) {
      allFonts = fontsCache;
      log("fonts from cache", allFonts.length);
      return;
    }

    try {
      const response = await fetch("https://fonts.google.com/metadata/fonts");
      if (!response.ok) {
        throw new Error("Bad response");
      }
      const text = await response.text();
      const cleaned = text.replace(/^\)\]\}'\s*/, "");
      const data = JSON.parse(cleaned);
      const families = (data.familyMetadataList || []).map(
        (item: { family: string }) => item.family
      );
      allFonts = families;
      if (allFonts.length) {
        await storageLocalSet({
          fontsCache: allFonts,
          fontsCacheTs: Date.now()
        });
      }
      log("fonts fetched", allFonts.length);
    } catch (error) {
      warn("fonts fetch failed, fallback list", error);
      allFonts = FALLBACK_FONTS;
    }
  }

  function getOrderedFonts(): string[] {
    const source = allFonts.length ? allFonts : FALLBACK_FONTS;
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const font of source) {
      if (seen.has(font)) {
        continue;
      }
      seen.add(font);
      unique.push(font);
    }

    const sourceSet = new Set(unique);
    const popular = POPULAR_FONTS.filter((font) => sourceSet.has(font));
    const popularSet = new Set(popular);
    const rest = unique
      .filter((font) => !popularSet.has(font))
      .sort((a, b) => a.localeCompare(b));

    return [DEFAULT_FONT_VALUE, ...popular, ...rest];
  }

  function applySettingsToState(settings: FontSettings): void {
    hasCustomFont = settings.hasCustomFont;
    hasCustomSize = settings.hasCustomSize;
    fontSource = settings.fontSource === "system" ? "system" : "web";
    if (hasCustomFont && settings.fontFamily) {
      if (fontSource === "system") {
        selectedSystemFont = settings.fontFamily;
        selectedFont = DEFAULT_FONT_VALUE;
      } else {
        selectedFont = settings.fontFamily;
        selectedSystemFont = "";
      }
    } else {
      selectedFont = DEFAULT_FONT_VALUE;
      selectedSystemFont = "";
    }
    const normalizedSize = normalizeFontSize(settings.fontSize);
    selectedSize = hasCustomSize ? normalizedSize ?? DEFAULT_SIZE : DEFAULT_SIZE;
  }

  function getSiteHost(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname ? parsed.hostname.toLowerCase() : null;
    } catch (error) {
      return null;
    }
  }

  function buildSiteSettingsKey(url: string): string | null {
    const host = getSiteHost(url);
    if (!host) {
      return null;
    }
    return `${SITE_SETTINGS_PREFIX}${host}`;
  }

  async function loadSiteSettings(url: string | null): Promise<FontSettings> {
    if (!url || isRestrictedUrl(url)) {
      return {
        hasCustomFont: false,
        hasCustomSize: false,
        fontFamily: null,
        fontSize: DEFAULT_SIZE,
        fontSource: "web"
      };
    }
    const key = buildSiteSettingsKey(url);
    const expectedHost = getSiteHost(url);
    if (!key) {
      return {
        hasCustomFont: false,
        hasCustomSize: false,
        fontFamily: null,
        fontSize: DEFAULT_SIZE,
        fontSource: "web"
      };
    }
    const stored = await storageLocalGet<Record<string, any>>({ [key]: null });
    const data = stored[key];
    const hasValidVersion = data && data.version === SETTINGS_VERSION;
    const hasValidHost =
      data && typeof data.siteHost === "string" && data.siteHost === expectedHost;
    if (!data || !expectedHost || !hasValidVersion || !hasValidHost) {
      if (data) {
        await storageLocalRemove([key]);
      }
      return {
        hasCustomFont: false,
        hasCustomSize: false,
        fontFamily: null,
        fontSize: DEFAULT_SIZE,
        fontSource: "web"
      };
    }
    const normalizedSize = normalizeFontSize(data.fontSize);
    const hasSize = Boolean(data.hasCustomSize) && normalizedSize !== null;
    return {
      hasCustomFont: Boolean(data.hasCustomFont),
      hasCustomSize: hasSize,
      fontFamily: data.fontFamily || null,
      fontSize: normalizedSize ?? DEFAULT_SIZE,
      fontSource: data.fontSource === "system" ? "system" : "web"
    };
  }

  async function saveSiteSettings(
    url: string | null,
    settings: FontSettings
  ): Promise<void> {
    if (!url || isRestrictedUrl(url)) {
      return;
    }
    const key = buildSiteSettingsKey(url);
    const siteHost = getSiteHost(url);
    if (!key || !siteHost) {
      return;
    }
    const storedSettings: FontSettings = {
      ...settings,
      siteHost,
      version: SETTINGS_VERSION
    };
    await storageLocalSet({ [key]: storedSettings });
  }

  async function removeSiteSettings(url: string | null): Promise<void> {
    if (!url || isRestrictedUrl(url)) {
      return;
    }
    const key = buildSiteSettingsKey(url);
    if (!key) {
      return;
    }
    await storageLocalRemove([key]);
  }

  function setStatus(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
    if (!message) {
      return;
    }
    window.clearTimeout((setStatus as any)._timer);
    (setStatus as any)._timer = window.setTimeout(() => {
      statusEl.textContent = "";
      statusEl.classList.remove("error");
    }, 2000);
  }

  function t(key: keyof (typeof I18N)["ru"]): string {
    const dict = I18N[currentLang] || I18N[DEFAULT_LANG];
    return dict[key] || "";
  }

  function fontToDisplayName(font: string): string {
    if (isDefaultFont(font)) {
      return t("defaultFont");
    }
    return font;
  }

  function isDefaultFont(font: string): boolean {
    return !font || font === DEFAULT_FONT_VALUE;
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

  function isRestrictedUrl(url?: string): boolean {
    if (!url) {
      return true;
    }
    return (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("view-source:")
    );
  }

  function getActiveTab(): Promise<{ id?: number; url?: string } | null> {
    return new Promise((resolve) => {
      chrome.tabs.query(
        { active: true, currentWindow: true },
        (tabs: any[]) => {
          if (chrome.runtime.lastError) {
            warn("tabs.query error", chrome.runtime.lastError);
            resolve(null);
            return;
          }
          resolve(tabs && tabs.length ? tabs[0] : null);
        }
      );
    });
  }

  function sendMessageToTab(
    tabId: number,
    message: {
      type: string;
      fontFamily?: string | null;
      fontSource?: FontSource;
      fontSize?: number | null;
    }
  ): Promise<{
    ok: boolean;
    error?: string;
    fontSize?: number | null;
    fontBlocked?: boolean;
  }> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        message,
        (response: {
          ok?: boolean;
          fontSize?: number | null;
          fontBlocked?: boolean;
        }) => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || "sendMessage failed";
            warn("tabs.sendMessage error", chrome.runtime.lastError);
            resolve({ ok: false, error: errorMessage });
            return;
          }
          log("tabs.sendMessage response", response);
          resolve({
            ok: Boolean(response && response.ok),
            fontSize: response && "fontSize" in response ? response.fontSize : null,
            fontBlocked:
              response && "fontBlocked" in response ? response.fontBlocked : undefined
          });
        }
      );
    });
  }

  function injectContentScript(
    tabId: number
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "inject-content-script", tabId },
        (response: { ok?: boolean; error?: string }) => {
          if (chrome.runtime.lastError) {
            const errorMessage =
              chrome.runtime.lastError.message || "inject message failed";
            warn("injectContentScript message error", chrome.runtime.lastError);
            resolve({ ok: false, error: errorMessage });
            return;
          }
          resolve({ ok: Boolean(response && response.ok), error: response?.error });
        }
      );
    });
  }

  function withErrorDetails(base: string, details: string): string {
    if (!details) {
      return base;
    }
    const trimmed = String(details).trim().slice(0, 140);
    return `${base}: ${trimmed}`;
  }

  function storageSyncGet<T extends object>(defaults: T): Promise<T> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(defaults, (data: T) => resolve(data));
    });
  }

  function storageLocalGet<T extends object>(defaults: T): Promise<T> {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (data: T) => resolve(data));
    });
  }

  function storageLocalSet(data: object): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }

  function storageLocalRemove(keys: string[]): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  async function resetAll(): Promise<void> {
    selectedFont = DEFAULT_FONT_VALUE;
    selectedSystemFont = "";
    fontSource = "web";
    selectedSize = DEFAULT_SIZE;
    hasCustomFont = false;
    hasCustomSize = false;

    await syncDefaultSizeFromPage();

    setFontInputValue(selectedFont);
    setSystemFontInputValue(selectedSystemFont);
    updateCurrentFontLabel();
    sizeRange.value = String(selectedSize);
    sizeNumber.value = String(selectedSize);
    closeList();
    closeSystemList();

    await applySettings();
  }
})();
