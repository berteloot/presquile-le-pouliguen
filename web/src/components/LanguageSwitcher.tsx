import { useEffect, useState } from "react";

type LanguageCode = "fr" | "en" | "es";

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

const SCRIPT_ID = "google-translate-script";
const COOKIE_PREFIX = "googtrans=/fr/";

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
  const match = document.cookie.match(/(?:^|;\s*)googtrans=\/fr\/(fr|en|es)(?:;|$)/);
  return (match?.[1] as LanguageCode | undefined) ?? "fr";
}

function setTranslateCookie(language: LanguageCode) {
  document.cookie = `${COOKIE_PREFIX}${language};path=/;max-age=31536000`;
}

function applyGoogleLanguage(language: LanguageCode, attempt = 0) {
  const previousLanguage = currentLanguage();
  setTranslateCookie(language);
  document.documentElement.lang = language === "fr" ? "fr" : language;

  if (language === "fr" && previousLanguage !== "fr") {
    window.location.reload();
    return;
  }

  const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
  if (!combo) {
    if (attempt < 10) {
      window.setTimeout(() => applyGoogleLanguage(language, attempt + 1), 250);
    }
    return;
  }

  if (combo.value !== language) {
    combo.value = language;
    combo.dispatchEvent(new Event("change"));
  }
}

export default function LanguageSwitcher() {
  const [activeLanguage, setActiveLanguage] = useState<LanguageCode>(() => currentLanguage());

  useEffect(() => {
    window.googleTranslateElementInit = () => {
      if (!window.google?.translate?.TranslateElement) return;
      const root = document.getElementById("google_translate_element");
      if (root && root.childElementCount > 0) {
        applyGoogleLanguage(currentLanguage());
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
      applyGoogleLanguage(currentLanguage());
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
