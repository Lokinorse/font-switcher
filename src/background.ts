(() => {
  const chrome = (globalThis as any).chrome;
  const SITE_SETTINGS_PREFIX = "siteSettings:";
  const SETTINGS_VERSION = 2;
  const DEBUG = false;
  const log = (...args: any[]) => {
    if (DEBUG) {
      console.log("[Font Switcher][background]", ...args);
    }
  };

  const normalizeHost = (host: string): string | null => {
    const trimmed = String(host || "").trim().toLowerCase();
    return trimmed ? trimmed : null;
  };

  const getSiteHost = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      return parsed.hostname ? parsed.hostname.toLowerCase() : null;
    } catch (error) {
      return null;
    }
  };

  const buildSiteSettingsKeyFromHost = (host: string | null): string | null => {
    const normalized = host ? normalizeHost(host) : null;
    if (!normalized) {
      return null;
    }
    return `${SITE_SETTINGS_PREFIX}${normalized}`;
  };

  const buildSiteSettingsKey = (url: string): string | null => {
    const host = getSiteHost(url);
    return buildSiteSettingsKeyFromHost(host);
  };

  chrome.runtime.onMessage.addListener(
    (
      message: { type?: string; tabId?: number; url?: string; host?: string },
      sender: { tab?: { id?: number; url?: string } },
      sendResponse: (
        response:
          | { ok: boolean; settings?: object | null }
          | { ok: boolean; error?: string }
      ) => void
    ) => {
      if (!message || !message.type) {
        return;
      }
      if (message.type === "get-site-settings" || message.type === "get-tab-settings") {
        const tabUrl = sender.tab && sender.tab.url ? sender.tab.url : null;
        const requestedHost =
          typeof message.host === "string" ? message.host : null;
        const requestedUrl =
          typeof message.url === "string" ? message.url : null;
        log("get-site-settings", { tabUrl, requestedHost, requestedUrl });
        const key =
          buildSiteSettingsKeyFromHost(requestedHost) ||
          (requestedUrl ? buildSiteSettingsKey(requestedUrl) : null) ||
          (tabUrl ? buildSiteSettingsKey(tabUrl) : null);
        if (!key) {
          sendResponse({ ok: false, settings: null });
          return;
        }
        chrome.storage.local.get({ [key]: null }, (data: any) => {
          const settings = data[key] || null;
          const hostFromKey = key.startsWith(SITE_SETTINGS_PREFIX)
            ? key.slice(SITE_SETTINGS_PREFIX.length)
            : null;
          const hasValidVersion =
            settings && settings.version === SETTINGS_VERSION;
          const hasValidHost =
            settings &&
            typeof settings.siteHost === "string" &&
            normalizeHost(settings.siteHost) === normalizeHost(hostFromKey || "");
          if (!settings || !hostFromKey || !hasValidVersion || !hasValidHost) {
            if (settings) {
              chrome.storage.local.remove([key], () => {
                log("site settings cleared", { key });
              });
            }
            sendResponse({ ok: true, settings: null });
            return;
          }
          log("site settings response", settings);
          sendResponse({ ok: true, settings });
        });
        return true;
      }

      if (message.type === "inject-content-script") {
        const tabId =
          typeof message.tabId === "number" ? message.tabId : null;
        log("inject-content-script", { tabId });
        if (!tabId) {
          sendResponse({ ok: false, error: "missing tab id" });
          return;
        }

        const scripting = (chrome as any).scripting;
        if (scripting && typeof scripting.executeScript === "function") {
          scripting.executeScript(
            { target: { tabId }, files: ["dist/contentScript.js"] },
            () => {
              if (chrome.runtime.lastError) {
                const errorMessage =
                  chrome.runtime.lastError.message || "executeScript failed";
                log("executeScript error", chrome.runtime.lastError);
                sendResponse({ ok: false, error: errorMessage });
                return;
              }
              log("executeScript ok");
              sendResponse({ ok: true });
            }
          );
          return true;
        }

        const tabsApi = (chrome as any).tabs;
        if (tabsApi && typeof tabsApi.executeScript === "function") {
          tabsApi.executeScript(tabId, { file: "dist/contentScript.js" }, () => {
            if (chrome.runtime.lastError) {
              const errorMessage =
                chrome.runtime.lastError.message || "executeScript failed";
              log("tabs.executeScript error", chrome.runtime.lastError);
              sendResponse({ ok: false, error: errorMessage });
              return;
            }
            log("tabs.executeScript ok");
            sendResponse({ ok: true });
          });
          return true;
        }

        sendResponse({ ok: false, error: "scripting API unavailable" });
        return;
      }
    }
  );
})();
