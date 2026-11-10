import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions, defaultServerConditions, type ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Keep the browser's Host header (Vite's shorthand `"/api": url` rewrites it to the
 * target), so the server's Origin check sees the same origin as in production.
 *
 * When the server dies mid-response the proxy would leave the browser's side open,
 * so an event stream never notices and never reconnects; end it as the server's
 * side ends, as a direct connection would.
 */
const server: ProxyOptions = {
  target: "http://127.0.0.1:4317",
  changeOrigin: false,
  configure: (proxy) => {
    proxy.on("proxyRes", (proxyRes, _request, response) => {
      proxyRes.on("close", () => {
        if (!response.writableEnded) response.destroy();
      });
    });
  },
};

export default defineConfig({
  plugins: [
    sveltekit({
      // A pure client: no server code. The Effect server serves `build/` in production.
      adapter: adapter({ fallback: "index.html" }),
    }),
  ],
  // Resolve @wiki-agents/contracts from TypeScript source; Vite compiles it.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  server: {
    host: "127.0.0.1",
    // Single origin in development, like production: never bake server URLs into the bundle.
    proxy: {
      "/api": server,
      "/events": server,
      "/mcp": server,
      "/health": server,
    },
  },
  test: {
    projects: [
      // Pure logic.
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.browser.test.ts"] } },
      // Stores with real state, in a real browser (Nix's Chromium, see flake.nix).
      {
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.ts"],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
});
