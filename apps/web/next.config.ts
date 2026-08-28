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
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
