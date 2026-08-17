export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Leaflet renders string tooltip and popup content through innerHTML, so any
    upstream text passed as a string is parsed as markup. Ship names come off an
    AIS radio broadcast and stop names off a transit feed; both go through here
    instead, which takes Leaflet's appendChild path. */
export function textContent(text: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

/** Only http(s) links survive. Beach, circuit, bike-share and cinema URLs all
    arrive from open data portals or scraped pages, and escapeHtml leaves
    "javascript:" untouched because it holds none of the characters it escapes. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
