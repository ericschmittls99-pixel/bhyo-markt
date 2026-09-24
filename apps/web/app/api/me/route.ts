import { aktuellerZugang } from "@/lib/wache";

// Liest die von der Middleware verifizierte Identität; nie aus dem Cache.
export const dynamic = "force-dynamic";

/**
 * Gibt Identität UND Rolle zurück (F8/E30). Die E-Mail ist in der Middleware
 * gegen den JWKS verifiziert worden, die Rolle kommt aus der Datenbank.
 * Fail closed: Eine Adresse ohne Eintrag oder mit `aktiv = false` bekommt
 * keinen Zugang — der Zustand wird benannt, nicht in einen Lesezugriff
 * umgedeutet.
 */
export async function GET() {
  const zugang = await aktuellerZugang();
  switch (zugang.art) {
    case "erlaubt":
      return Response.json({
        email: zugang.email,
        name: zugang.name,
        rolle: zugang.rolle,
      });
    case "nicht_angemeldet":
      return Response.json({ error: "Nicht authentifiziert" }, { status: 401 });
    case "unbekannt":
      return Response.json(
        { error: "Kein Zugang eingerichtet", email: zugang.email, grund: "unbekannt" },
        { status: 403 },
      );
    case "deaktiviert":
      return Response.json(
        { error: "Zugang deaktiviert", email: zugang.email, grund: "deaktiviert" },
        { status: 403 },
      );
  }
}
