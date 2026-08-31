import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Commit-SHA zur Buildzeit fest ins Bundle inlinen. Im Cloudflare-Worker gibt
  // es zur Laufzeit kein process.env vom Build-Host; die CI setzt COMMIT_SHA beim
  // Build. Ohne gesetzten Wert (lokal) bleibt es "dev".
  env: {
    COMMIT_SHA: process.env.COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;

// Ermöglicht den Zugriff auf `getCloudflareContext()` bereits in `next dev`.
// Nur im Dev-Modus initialisieren: Beim `next build` (NODE_ENV=production) würde
// der lokale Miniflare-Kontext wegen der Hyperdrive-Bindung sonst einen lokalen
// Postgres-String verlangen und den Build (und die CI) abbrechen.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}
