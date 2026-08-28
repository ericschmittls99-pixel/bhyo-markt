import { headers } from "next/headers";

import { ACCESS_EMAIL_HEADER } from "@/lib/access";

// Liest die von der Middleware verifizierte Identität; nie aus dem Cache.
export const dynamic = "force-dynamic";

/**
 * Gibt die eingeloggte E-Mail zurück. Die Verifikation ist in der Middleware
 * passiert — fehlt der autoritative Header, gilt der Request als nicht
 * authentifiziert und wird mit 403 abgewiesen.
 */
export async function GET() {
  const email = (await headers()).get(ACCESS_EMAIL_HEADER);
  if (!email) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  return Response.json({ email });
}
