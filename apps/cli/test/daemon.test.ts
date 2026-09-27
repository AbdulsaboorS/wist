import { afterEach, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalDaemonHandler, startLocalDaemon } from "../src/index.js";

const port = 43123;

const token = "test-local-token-with-enough-entropy-for-the-handler";

const origin = `http://127.0.0.1:${port}`;

function localRequest(options: { host?: string; origin?: string; token?: string } = {}): Request {
  const headers = new Headers();
  headers.set("Host", options.host ?? `127.0.0.1:${port}`);

  if (options.origin !== undefined) {
    headers.set("Origin", options.origin);
  }

  if (options.token !== undefined) {
    headers.set("X-Wist-Local-Token", options.token);
  }

  return new Request(`${origin}/api/bootstrap`, { headers });
}

describe("loopback daemon security", () => {
  const running: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map(async (daemon) => await daemon.close()));
  });

  it("accepts only the exact loopback host, origin, and per-launch token", async () => {
    const handle = createLocalDaemonHandler({ port, token });

    const accepted = await handle(localRequest({ origin, token }));
    const browserGet = await handle(localRequest({ token }));
    const missingToken = await handle(localRequest({ origin }));
    const invalidToken = await handle(localRequest({ origin, token: `${token}-wrong` }));
    const rebinding = await handle(localRequest({ host: "attacker.example", origin, token }));
    const csrf = await handle(localRequest({ origin: "https://attacker.example", token }));

    expect(accepted.status).toBe(200);
    expect(browserGet.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ status: "ready" });
    expect(missingToken.status).toBe(401);
    expect(invalidToken.status).toBe(401);
    expect(rebinding.status).toBe(403);
    expect(csrf.status).toBe(403);
    expect(accepted.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("binds a live server only to 127.0.0.1 with a high-entropy launch URL", async () => {
    const daemon = await startLocalDaemon();
    running.push(daemon);
    const dashboardUrl = new URL(daemon.dashboardUrl);

    expect(dashboardUrl.hostname).toBe("127.0.0.1");
    expect(daemon.token.length).toBeGreaterThanOrEqual(43);

    const response = await fetch(`${dashboardUrl.origin}/api/bootstrap`, {
      headers: {
        Origin: dashboardUrl.origin,
        "X-Wist-Local-Token": daemon.token,
      },
    });

    expect(response.status).toBe(200);
  });

  it("serves only the inert dashboard shell without a token, never API data", async () => {
    const daemon = await startLocalDaemon({
      dashboardDirectory: resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
    });

    running.push(daemon);

    const origin = new URL(daemon.dashboardUrl).origin;

    const page = await fetch(`${origin}/share`);
    const api = await fetch(`${origin}/api/projects`);
    const traversal = await fetch(`${origin}/assets/../private.txt`);

    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
    expect(await page.text()).toContain("Wist");
    expect(api.status).toBe(401);
    expect(traversal.status).toBe(404);
  });
});
