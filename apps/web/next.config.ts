import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// Ermöglicht den Zugriff auf `getCloudflareContext()` bereits in `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
