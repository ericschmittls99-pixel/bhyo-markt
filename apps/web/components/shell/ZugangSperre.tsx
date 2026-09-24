import { EmptyState } from "@/components/shell/EmptyState";

/**
 * F8/E30: Die Seite, die eine angemeldete Person ohne Zugang sieht.
 *
 * Kein Randfall, sondern Regelfall: Die Access-Policy ist eine Domänenregel
 * (jede `@bhyo.de`-Adresse kommt durch), die Rolle steht aber in der
 * Datenbank — wer neu dazukommt, landet zuerst hier. Deshalb nennt die Seite
 * die angemeldete Adresse (damit klar ist, WELCHE gemeint ist — man ist
 * womöglich mit dem falschen Konto angemeldet) und die Kontaktadresse.
 *
 * Die Kontaktadresse wird aus der Datenbank gelesen (erster aktiver Admin),
 * nicht fest eingetragen — sie soll auch dann stimmen, wenn sich die Admins
 * ändern. Gibt es keinen aktiven Admin, steht dort ein neutraler Hinweis
 * statt einer leeren Zeile.
 */
export function ZugangSperre({
  grund,
  email,
  adminKontakt,
}: {
  grund: "unbekannt" | "deaktiviert";
  email: string;
  adminKontakt: string | null;
}) {
  const deaktiviert = grund === "deaktiviert";

  return (
    <div className="zugang-sperre">
      <EmptyState
        icon={deaktiviert ? "lock-simple" : "user-circle-dashed"}
        titel={deaktiviert ? "zugang deaktiviert." : "kein zugang eingerichtet."}
        beschreibung={
          deaktiviert
            ? "Der Zugang für diese Adresse wurde deaktiviert."
            : "Für diese Adresse ist noch kein Zugang eingerichtet."
        }
      />
      {/* Bewusst NEBEN dem EmptyState, nicht als dessen `children`: Dort
          landete der Block im Aktionen-Container und schrumpfte auf
          Inhaltsbreite zusammen. Hier trägt er die volle Breite. */}
      <div className="zs-details">
        <p className="zs-zeile">
          <span className="zs-label">Angemeldet als</span>
          <span className="zs-wert">{email}</span>
        </p>
        <p className="zs-zeile">
          <span className="zs-label">Kontakt</span>
          {adminKontakt ? (
            <a className="zs-wert" href={`mailto:${adminKontakt}`}>
              {adminKontakt}
            </a>
          ) : (
            <span className="zs-wert zs-wert--leer">
              Zurzeit ist keine Ansprechperson hinterlegt.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
