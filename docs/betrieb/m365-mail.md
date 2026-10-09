# Mail-Versand über Microsoft 365 (E74) — Einrichtung für die bhyo-IT

Stand 09.10.2026, AP2.9. Die App sendet Inbox-Roundups per Microsoft Graph
`sendMail` aus dem bestehenden Postfach `news@bhyo.de`. Kein neuer Anbieter,
keine DNS-Änderung. Empfänger sind ausschließlich `@bhyo.de`-Postfächer.

Was die IT einrichtet (Abschnitte 1–4), was Eric einträgt (Abschnitt 5),
was die App daraus macht (Abschnitt 6). Platzhalter in spitzen Klammern.

## 1. Postfach prüfen

- `news@bhyo.de` existiert als Benutzerpostfach oder freigegebenes Postfach
  in Exchange Online (ein freigegebenes Postfach braucht keine Lizenz, solange
  es unter 50 GB bleibt und kein Archiv hat).
- Das Postfach darf senden (kein Sendeverbot, keine Transportregel, die
  ausgehende Mail von `news@` blockiert).
- Unzustellbarkeits-Mails (Bounces) landen in diesem Postfach — jemand sollte
  es gelegentlich lesen oder eine Weiterleitung setzen.

## 2. App-Registrierung in Entra (Microsoft Entra Admin Center)

1. *Identity → Applications → App registrations → New registration*
   - Name: `bhyo-markt-mail`
   - Supported account types: *Accounts in this organizational directory only*
     (single tenant)
   - Redirect URI: **keine** (Client-Credentials-Fluss, kein Login)
2. Auf der Übersichtsseite notieren:
   - **Directory (tenant) ID** → `M365_TENANT_ID`
   - **Application (client) ID** → `M365_CLIENT_ID`
3. *API permissions → Add a permission → Microsoft Graph → Application
   permissions → Mail → `Mail.Send`* hinzufügen, dann **Grant admin consent
   for <Tenant>** (Status: Granted). Keine delegierten Berechtigungen.
4. *Certificates & secrets → Client secrets → New client secret*
   - Description: `bhyo-markt worker`
   - Expires: 12 Monate (Empfehlung; 24 ist das Maximum). **Ablaufdatum
     notieren** und als Termin eintragen — siehe Abschnitt 4.
   - Den **Value** (nicht die Secret ID) sofort kopieren; er ist nur einmal
     sichtbar → `M365_CLIENT_SECRET`. Sicher an Eric übergeben (nicht per
     Chat oder unverschlüsselter Mail).

## 3. Zugriff auf `news@` beschränken (Pflicht)

Ohne Beschränkung darf eine App mit `Mail.Send` aus **jedem** Postfach des
Tenants senden. Deshalb eine Application Access Policy in Exchange Online
PowerShell (`Connect-ExchangeOnline`):

```powershell
New-ApplicationAccessPolicy -AppId <M365_CLIENT_ID> `
  -PolicyScopeGroupId news@bhyo.de `
  -AccessRight RestrictAccess `
  -Description "bhyo-markt: Versand nur aus news@bhyo.de"
```

Prüfen (beides ausführen, erwartete Ergebnisse in Klammern):

```powershell
Test-ApplicationAccessPolicy -Identity news@bhyo.de -AppId <M365_CLIENT_ID>
#   AccessCheckResult : Granted
Test-ApplicationAccessPolicy -Identity <irgendein-anderes-postfach>@bhyo.de -AppId <M365_CLIENT_ID>
#   AccessCheckResult : Denied
```

Die Policy greift nach bis zu 30 Minuten. Alternative mit gleicher Wirkung:
*RBAC for Applications* (Exchange) mit `New-ManagementRoleAssignment -App
<M365_CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope <Scope auf
news@>` — eine der beiden Varianten reicht.

## 4. Secret-Laufzeit

- Das Secret läuft ab (Abschnitt 2, Schritt 4). Vor dem Ablauf ein neues
  Secret anlegen, an Eric geben; Eric tauscht das Worker-Secret, danach das
  alte in Entra löschen.
- Die App erkennt ein abgelaufenes Secret an der Entra-Antwort
  (AADSTS7000222) und meldet `secret_abgelaufen` im Log; ein Roundup fällt
  dann aus, bis das Secret getauscht ist. Ein Termin 30 Tage vor Ablauf ist
  der zuverlässigere Weg.

## 5. Was Eric einträgt (Worker-Secrets, je Umgebung)

```
wrangler secret put M365_TENANT_ID
wrangler secret put M365_CLIENT_ID
wrangler secret put M365_CLIENT_SECRET
wrangler secret put M365_TENANT_ID --env preview      # dto. für die Preview
```

Variablen stehen in `apps/web/wrangler.jsonc` (kein Secret):
`MAIL_ABSENDER = news@bhyo.de`, `MAIL_MODUS = protokoll`. Erst nach einem
Probelauf wird `MAIL_MODUS` in Production auf `graph` gestellt; auf der
Preview bleibt er dauerhaft `protokoll` (kein Versand aus der Preview).

## 6. Was die App daraus macht

- Token per `client_credentials` gegen
  `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, Scope
  `https://graph.microsoft.com/.default`.
- Versand `POST https://graph.microsoft.com/v1.0/users/news@bhyo.de/sendMail`
  mit `saveToSentItems = false` (kein Abbild im Postfach).
- Jede Mail hinterlässt ein Protokoll-Ereignis `mail_gesendet` am Empfänger
  (nur Art, Modus und Längen, nie Betreff oder Text, E73). Logs nennen den
  Empfänger maskiert (`e***@bhyo.de`), nie Token oder Secret.
- Fehlerbilder im Log: `secret_abgelaufen`, `secret_ungueltig`,
  `app_unbekannt` (Entra), `zugriff_verweigert` (Access Policy oder fehlende
  Zustimmung), `postfach_unbekannt`, `gedrosselt` (429 mit Retry-After).

Nebenbefund aus der DNS-Bestandsaufnahme (`docs/vorbereitung/ap29-mail.md`,
Abschnitt 6): Für Mail aus Microsoft 365 fehlen die DKIM-Einträge
`selector1`/`selector2` für `bhyo.de`. Das betrifft alle Mails des Tenants,
nicht nur die der App, und ist an die IT gegangen.
