import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server environment; tests run
      // server modules in plain Node, so swap in the package's no-op entry.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["*.test.ts", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    unstubEnvs: true,
  },
})
