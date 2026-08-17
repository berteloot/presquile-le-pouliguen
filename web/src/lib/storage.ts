/** A browser that blocks storage (iOS with "Block All Cookies", some managed
    profiles) throws SecurityError from localStorage instead of returning null.
    Thrown from a state initialiser that is what blanks the page, so every access
    goes through here. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Losing the preference is fine; the current session still works.
  }
}
