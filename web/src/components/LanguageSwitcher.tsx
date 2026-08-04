import { useEffect, useState } from "react";

type LanguageCode = "fr" | "en" | "es";

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

const COOKIE_NAME = "googtrans";
const LANGUAGE_STORAGE_KEY = "plq.language";
const TRANSLATION_CACHE_PREFIX = "plq.translation";
const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CONCURRENT_TRANSLATIONS = 5;

type TranslationRecord = {
  language: Exclude<LanguageCode, "fr">;
  original: string;
  translated: string;
};

const originalByNode = new WeakMap<Text, string>();
const translatedByNode = new WeakMap<Text, TranslationRecord>();

function queryLanguage(): LanguageCode | undefined {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("lang") ?? params.get("tl") ?? params.get("_x_tr_tl");
  return target === "fr" || target === "en" || target === "es" ? target : undefined;
}

function storedLanguage(): LanguageCode | undefined {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "fr" || stored === "en" || stored === "es" ? stored : undefined;
  } catch {
    return undefined;
  }
}

function initialLanguage(): LanguageCode {
  return queryLanguage() ?? storedLanguage() ?? "fr";
}

function cookieDomains(): (string | undefined)[] {
  const hostname = window.location.hostname;
  const domains: (string | undefined)[] = [undefined, hostname];
  const parts = hostname.split(".");

  if (parts.length > 2) {
    domains.push(`.${parts.slice(-2).join(".")}`);
    domains.push(`.${parts.slice(-3).join(".")}`);
  }

  return Array.from(new Set(domains));
}

function clearTranslateCookie() {
  for (const domain of cookieDomains()) {
    const domainPart = domain ? `;domain=${domain}` : "";
    document.cookie = `${COOKIE_NAME}=;path=/;max-age=0;SameSite=Lax${domainPart}`;
    document.cookie = `${COOKIE_NAME}=;path=/;max-age=0${domainPart}`;
  }
}

function updateLanguageUrl(language: LanguageCode) {
  const url = new URL(window.location.href);
  url.searchParams.delete("tl");
  url.searchParams.delete("_x_tr_tl");
  url.searchParams.delete("_x_tr_sl");
  url.searchParams.delete("_x_tr_hl");

  if (language === "fr") {
    url.searchParams.delete("lang");
  } else {
    url.searchParams.set("lang", language);
  }

  window.history.replaceState(null, "", url);
}

function writeStoredLanguage(language: LanguageCode) {
  try {
    if (language === "fr") {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  } catch {
    // Storage can be unavailable in private browsing; the current state still works.
  }
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(language: Exclude<LanguageCode, "fr">, text: string): string {
  return `${TRANSLATION_CACHE_PREFIX}.${language}.${hashText(text)}`;
}

function readCachedTranslation(
  language: Exclude<LanguageCode, "fr">,
  text: string,
): string | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(language, text));
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { source?: string; translated?: string };
    return cached.source === text ? cached.translated : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedTranslation(
  language: Exclude<LanguageCode, "fr">,
  text: string,
  translated: string,
) {
  try {
    localStorage.setItem(
      cacheKey(language, text),
      JSON.stringify({ source: text, translated }),
    );
  } catch {
    // Cache pressure should never block the language switcher.
  }
}

async function translateText(
  text: string,
  language: Exclude<LanguageCode, "fr">,
): Promise<string> {
  const cached = readCachedTranslation(language, text);
  if (cached) return cached;

  const url = new URL(TRANSLATE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "fr");
  url.searchParams.set("tl", language);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Translation failed: ${response.status}`);
  const payload = (await response.json()) as unknown;
  const translated =
    Array.isArray(payload) && Array.isArray(payload[0])
      ? payload[0]
          .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? "") : ""))
          .join("")
      : text;

  const normalized = translated.trim() || text;
  writeCachedTranslation(language, text, normalized);
  return normalized;
}

function shouldTranslateText(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return false;
  if (/^[\d\s:.,/%°€+()-]+$/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  return /[A-Za-zÀ-ÿ]/.test(text);
}

function canTranslateNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest(".notranslate,[translate='no']")) return false;
  return !["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG"].includes(
    parent.tagName,
  );
}

function walkTextNodes(root: Node, visit: (node: Text) => void) {
  if (root.nodeType === Node.TEXT_NODE) {
    visit(root as Text);
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    visit(current as Text);
    current = walker.nextNode();
  }
}

function restoreFrench(root: Node = document.body) {
  walkTextNodes(root, (node) => {
    const original = originalByNode.get(node);
    if (original !== undefined) {
      node.nodeValue = original;
    }
  });
}

function sourceTextForNode(node: Text): string {
  const current = node.nodeValue ?? "";
  const record = translatedByNode.get(node);
  if (record && current === record.translated) {
    return record.original;
  }
  originalByNode.set(node, current);
  return current;
}

function applyLanguage(language: LanguageCode): () => void {
  document.documentElement.lang = language;
  document.body.dataset.language = language;
  clearTranslateCookie();
  restoreFrench();

  if (language === "fr") {
    return () => undefined;
  }

  let disposed = false;
  let timer: number | undefined;
  const queue = new Set<Text>();

  const enqueue = (node: Text) => {
    if (!canTranslateNode(node)) return;
    const source = sourceTextForNode(node);
    if (!shouldTranslateText(source)) return;
    queue.add(node);
  };

  const processQueue = async () => {
    const nodes = Array.from(queue);
    queue.clear();

    for (let index = 0; index < nodes.length; index += MAX_CONCURRENT_TRANSLATIONS) {
      if (disposed) return;
      const group = nodes.slice(index, index + MAX_CONCURRENT_TRANSLATIONS);
      await Promise.all(
        group.map(async (node) => {
          if (!node.isConnected) return;
          const source = sourceTextForNode(node);
          if (!shouldTranslateText(source)) return;
          const [, leading = "", core = "", trailing = ""] =
            source.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
          if (!core) return;

          try {
            const translatedCore = await translateText(core, language);
            if (disposed || !node.isConnected) return;
            const translated = `${leading}${translatedCore}${trailing}`;
            node.nodeValue = translated;
            translatedByNode.set(node, { language, original: source, translated });
          } catch {
            // Keep French text visible if the translation service is unavailable.
          }
        }),
      );
    }
  };

  const schedule = (root: Node) => {
    walkTextNodes(root, enqueue);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void processQueue();
    }, 80);
  };

  schedule(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        enqueue(mutation.target as Text);
      }
      for (const node of mutation.addedNodes) {
        schedule(node);
      }
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void processQueue();
    }, 120);
  });

  observer.observe(document.body, { characterData: true, childList: true, subtree: true });

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    observer.disconnect();
  };
}

export default function LanguageSwitcher() {
  const [activeLanguage, setActiveLanguage] = useState<LanguageCode>(() => initialLanguage());

  useEffect(() => {
    writeStoredLanguage(activeLanguage);
    updateLanguageUrl(activeLanguage);
    window.dispatchEvent(
      new CustomEvent("plq:languagechange", { detail: { language: activeLanguage } }),
    );
    return applyLanguage(activeLanguage);
  }, [activeLanguage]);

  return (
    <nav className="language-switcher notranslate" translate="no" aria-label="Langue">
      {LANGUAGES.map((language) => (
        <button
          key={language.code}
          type="button"
          className={activeLanguage === language.code ? "language-active" : ""}
          aria-pressed={activeLanguage === language.code}
          aria-label={language.label}
          onClick={() => setActiveLanguage(language.code)}
        >
          {language.code.toUpperCase()}
        </button>
      ))}
    </nav>
  );
}
