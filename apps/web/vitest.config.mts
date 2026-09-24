import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Minimalkonfiguration mit genau einem Zweck (F8/E30): Die Rechtetests rufen
 * die Server-Actions ECHT auf, nicht die Oberfläche. Dafür muss vitest den
 * `@/`-Alias aus der tsconfig auflösen, den die Actions untereinander nutzen.
 * Bewusst nichts weiter — kein Environment, kein Setup, keine Coverage.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
