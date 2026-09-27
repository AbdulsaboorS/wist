import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/*
 * The daemon (apps/cli) serves `dist/` from the published package behind its per-launch local
 * token and keeps every API route under `/api`. In development Vite serves the app instead and
 * proxies `/api` to a running daemon.
 *
 * The daemon accepts a request only when `Origin` equals its own loopback origin exactly, so the
 * proxy rewrites the browser's Vite origin to the daemon's. Point `WIST_DAEMON_ORIGIN`
 * at the origin printed by `npx wist-cli`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "WIST_");
  const daemonOrigin = env.WIST_DAEMON_ORIGIN ?? "http://127.0.0.1:7878";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: daemonOrigin,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyRequest) => {
              proxyRequest.setHeader("Origin", daemonOrigin);
            });
          },
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
    },
  };
});
