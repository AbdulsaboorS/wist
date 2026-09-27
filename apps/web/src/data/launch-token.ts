/*
 * The daemon opens the dashboard at `http://127.0.0.1:<port>/#token=<token>` and requires that
 * token on every `/api` request. Keep it in tab-scoped session storage so a reload can recover it,
 * then remove it from the address bar so it never lands in history, bookmarks, or a copied link.
 * A new daemon uses a different port and launch token; a new tab needs the CLI launch link.
 */

const TOKEN_KEY = "token";

const SESSION_TOKEN_KEY = "wist-launch-token";

let launchToken: string | undefined;

export function captureLaunchToken(): void {
  const hash = window.location.hash;

  if (hash.startsWith("#")) {
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get(TOKEN_KEY);

    if (token !== null && token.length > 0) {
      launchToken = token;

      try {
        window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      } catch {
        // Storage may be disabled; the current page still works with the in-memory token.
      }

      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(window.history.state, "", cleanUrl);

      return;
    }
  }

  try {
    launchToken = window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? undefined;
  } catch {
    launchToken = undefined;
  }
}

export function getLaunchToken(): string | undefined {
  return launchToken;
}
