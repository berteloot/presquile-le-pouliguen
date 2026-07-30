import { useEffect, useState } from "react";

type LanguageCode = "fr" | "en" | "es";

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

const SCRIPT_ID = "google-translate-script";
const COOKIE_NAME = "googtrans";
const COOKIE_MAX_AGE = 31_536_000;

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate?: {
        TranslateElement?: new (
          options: Record<string, unknown>,
          elementId: string,
        ) => unknown;
      };
    };
  }
}

function currentLanguage(): LanguageCode {
  const match = document.cookie.match(/(?:^|;\s*)googtrans=\/(?:fr|auto)\/(fr|en|es)(?:;|$)/);
  return (match?.[1] as LanguageCode | undefined) ?? "fr";
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

function writeTranslateCookie(value: string, maxAge: number) {
  for (const domain of cookieDomains()) {
    const domainPart = domain ? `;domain=${domain}` : "";
    document.cookie = `${COOKIE_NAME}=${value};path=/;max-age=${maxAge};SameSite=Lax${domainPart}`;
    document.cookie = `${COOKIE_NAME}=${value};path=/;max-age=${maxAge}${domainPart}`;
  }
}

function setTranslateCookie(language: Exclude<LanguageCode, "fr">) {
  writeTranslateCookie(`/fr/${language}`, COOKIE_MAX_AGE);
}

function clearTranslateCookie() {
  writeTranslateCookie("", 0);
  writeTranslateCookie("/fr/fr", 0);
}

function reloadWithoutGoogleHash() {
  const url = new URL(window.location.href);
  if (url.hash.includes("googtrans")) {
    url.hash = "";
  }
  window.location.replace(url.toString());
}

function applyGoogleLanguage(language: LanguageCode) {
  try {
    localStorage.setItem("plq.language", language);
  } catch {
    // Storage can be disabled in strict privacy modes; cookies drive translation.
  }
  document.documentElement.lang = language;

  if (language === "fr") {
    clearTranslateCookie();
    reloadWithoutGoogleHash();
    return;
  }

  setTranslateCookie(language);
  window.location.reload();
}

export default function LanguageSwitcher() {
  const [activeLanguage, setActiveLanguage] = useState<LanguageCode>(() => currentLanguage());

  useEffect(() => {
    window.googleTranslateElementInit = () => {
      if (!window.google?.translate?.TranslateElement) return;
      const root = document.getElementById("google_translate_element");
      if (root && root.childElementCount > 0) {
        return;
      }
      new window.google.translate.TranslateElement(
        {
          pageLanguage: "fr",
          includedLanguages: "fr,en,es",
          autoDisplay: false,
        },
        "google_translate_element",
      );
    };

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src =
        "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.async = true;
      document.body.appendChild(script);
    } else {
      window.googleTranslateElementInit();
    }
  }, []);

  const chooseLanguage = (language: LanguageCode) => {
    if (language === activeLanguage && language === currentLanguage()) return;
    setActiveLanguage(language);
    applyGoogleLanguage(language);
  };

  return (
    <div className="language-switcher notranslate" translate="no" aria-label="Langue">
      {LANGUAGES.map((language) => (
        <button
          key={language.code}
          type="button"
          className={activeLanguage === language.code ? "language-active" : ""}
          aria-pressed={activeLanguage === language.code}
          aria-label={language.label}
          onClick={() => chooseLanguage(language.code)}
        >
          {language.code.toUpperCase()}
        </button>
      ))}
      <div id="google_translate_element" className="google-translate-root" aria-hidden="true" />
    </div>
  );
}
