import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Nur fuer `drizzle-kit migrate` noetig; der direkte Neon-Connection-String
  // kommt aus der Umgebung (Secret), nie aus dem Repo.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
