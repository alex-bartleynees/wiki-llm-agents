import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

const server = "http://127.0.0.1:4317";

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
});
