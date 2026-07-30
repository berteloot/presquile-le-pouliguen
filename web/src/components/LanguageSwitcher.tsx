type LanguageCode = "fr" | "en" | "es";

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

const CANONICAL_URL = "https://presquile-le-pouliguen.berteloot.org/";
const COOKIE_NAME = "googtrans";

function translatedUrl(language: Exclude<LanguageCode, "fr">): string {
  const url = new URL("https://translate.google.com/translate");
  url.searchParams.set("sl", "fr");
  url.searchParams.set("tl", language);
  url.searchParams.set("u", CANONICAL_URL);
  return url.toString();
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

function activeLanguage(): LanguageCode {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("tl") ?? params.get("_x_tr_tl");
  if (target === "en" || target === "es") return target;
  return "fr";
}

export default function LanguageSwitcher() {
  const active = activeLanguage();

  return (
    <nav className="language-switcher notranslate" translate="no" aria-label="Langue">
      {LANGUAGES.map((language) => {
        const isFrench = language.code === "fr";
        const href =
          language.code === "en" || language.code === "es"
            ? translatedUrl(language.code)
            : CANONICAL_URL;

        return (
          <a
            key={language.code}
            className={active === language.code ? "language-active" : ""}
            aria-current={active === language.code ? "true" : undefined}
            aria-label={language.label}
            href={href}
            target="_top"
            onClick={isFrench ? clearTranslateCookie : undefined}
          >
            {language.code.toUpperCase()}
          </a>
        );
      })}
    </nav>
  );
}
