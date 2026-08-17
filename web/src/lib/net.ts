const DEFAULT_TIMEOUT_MS = 8000;

/** Every source this site reads is a third party. Without a deadline a stalled
    connection leaves its panel on "Chargement…" for the life of the page, with
    no error and no retry, so each request gets one. */
export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // Guarded because an older browser without AbortSignal.timeout would throw on
  // the property access and take every panel down with it.
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  return fetch(input, signal ? { ...init, signal } : init);
}
