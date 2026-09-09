import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // The geocoder spaces real requests a second apart to respect Nominatim's
      // policy. Tests never reach the network, so waiting for that would add
      // minutes of sleep and test nothing.
      GEOCODER_SPACING_MS: "0",
    },
  },
});
