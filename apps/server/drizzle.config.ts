import { defineConfig } from "drizzle-kit";

// Each feature owns its tables in features/<feature>/table.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/features/*/table.ts",
  out: "./drizzle",
});
