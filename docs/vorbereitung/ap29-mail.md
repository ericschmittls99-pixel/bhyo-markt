# Vorbereitung AP2.9 — Mail aus Cloudflare Workers

Nur Bestandsaufnahme und Vergleich (Nachtauftrag 08./09.10.2026). Kein Konto
angelegt, keine Secrets, keine DNS-Änderung. Abrufdatum aller Fakten:
09.10.2026, 06:13–06:35 UTC. Bedarf laut Auftrag: ~10 Nutzer × 1 Mail/Tag ≈
300 Mails/Monat, transaktional (Inbox-Hinweise), Versand per HTTP-API aus
dem Worker.

## 1. Bestand bhyo.de (nur gelesen)

Abgefragt mit `dig` am 09.10.2026, 06:13 UTC:

- MX: `10 bhyo-de.mail.protection.outlook.com` → Posteingang bei
  Microsoft 365 (Exchange Online).
- SPF (TXT @): `v=spf1 include:_spf.odoo.com include:spf.protection.outlook.com -all`
  → heute verschicken für bhyo.de **Microsoft 365** und **Odoo**
  (Odoo-Instanz, z. B. CRM/Rechnungen). `-all` = harter Fehler für alles
  andere.
- DMARC (TXT _dmarc): `v=DMARC1;p=reject;` → ohne ausgerichtetes SPF **oder**
  DKIM wird eine Mail von bhyo.de abgewiesen. Kein `rua`/`ruf`, also keine
  Berichte.
- DKIM: Selektor `odoo._domainkey.bhyo.de` → CNAME auf
  `odoo._domainkey.odoo.com` (Schlüssel vorhanden, d=bhyo.de über die
  Odoo-Signatur). Die Microsoft-365-Selektoren `selector1._domainkey` und
  `selector2._domainkey` existieren **nicht** (Nebenbefund, Abschnitt 6).
- Eine breitere Suche nach weiteren DKIM-Selektoren hat der
  Berechtigungsfilter der Sitzung blockiert; geprüft wurden nur die
  Standardnamen von M365 und Odoo.

### SPF-Lookups (Grenze 10, RFC 7208 §4.6.4)

Jeder `include`, `a`, `mx`, `ptr`, `exists`, `redirect` zählt; `ip4`/`ip6`
zählen nicht. Aufgelöst am 09.10.2026, 06:33 UTC:

- `include:_spf.odoo.com` = 1 Lookup; darin `include:_spf.mailsaas10.odoo.com`
  (nur ip4) = 1 und `include:_spf.mo1.odoo.com` (nur ip4) = 1 → **3**.
- `include:spf.protection.outlook.com` = 1 Lookup, darin nur ip4/ip6 → **1**.
- **Stand heute: 4 von 10.**

Nach Hinzufügen je Anbieter (nur die Anbieter mit SPF-Eintrag auf der
Hauptdomain):

- Brevo `include:spf.brevo.com` (nur ip4) → 4 + 1 = **5**.
- Mailjet `include:spf.mailjet.com` (nur ip4) → 4 + 1 = **5**.
- Amazon SES: kein Eintrag auf der Hauptdomain nötig, wenn eine eigene
  MAIL-FROM-Subdomain (z. B. `mail.bhyo.de`) genutzt wird; dort eigener
  SPF `v=spf1 include:amazonses.com ~all` (amazonses.com nur ip4, 1 Lookup
  auf der Subdomain). Auf @ **4** bleibt.
- Resend: SPF liegt auf der Return-Path-Subdomain (`send.bhyo.de`), nicht
  auf @ → @ **4** bleibt.
- Postmark: SPF-Ausrichtung über die Return-Path-CNAME
  `pm-bounces.bhyo.de`, kein Eintrag auf @ → **4** bleibt.
- Microsoft 365 per Graph: kein neuer Eintrag, M365 ist schon enthalten →
  **4** bleibt.

## 2. Anforderung aus DMARC p=reject

Jeder Anbieter muss DKIM **mit d=bhyo.de** signieren (DKIM-Ausrichtung), weil
SPF bei Weiterleitungen bricht und bei Return-Path-Subdomains nur „relaxed"
ausgerichtet ist. Ohne eigene DKIM-Signatur für bhyo.de ist ein Anbieter
ungeeignet. Alle sechs Optionen unten können das; die nötigen Einträge
stehen je Anbieter.

## 3. Anbieter im Vergleich

Je Anbieter: Quelle, EU/AVV, Preis beim Bedarf, DKIM/SPF-Einträge, Bounces,
Worker-Betrieb. Angaben sind Hersteller- bzw. Vergleichsseiten vom
09.10.2026; Preise können sich ändern.

### Brevo (ehem. Sendinblue)

- EU/AVV: Server in Frankreich und Deutschland, ISO 27001, Standard-AVV
  (DPA) für deutsche Firmen. Quellen: [Brevo Email API](https://www.brevo.com/features/email-api/),
  [Brevo Pricing DACH](https://chatarmin.com/en/blog/brevo-pricing).
- Preis: Free-Plan 300 Mails/Tag ohne Zeitlimit, API inklusive → Bedarf
  gedeckt (0 €). Quelle: [Brevo Free Plan 2026](https://www.fastlancer.org/en/fastlancer-blog/brevo-review/).
- DKIM mit d=bhyo.de: ja — zwei CNAME `brevo1._domainkey.bhyo.de` und
  `brevo2._domainkey.bhyo.de` (Ziele liefert das Dashboard, Schlüssel 2048,
  Rotation automatisch) oder alternativ ein TXT `mail._domainkey` (1024);
  dazu ein TXT `brevo-code=…` zur Domainprüfung. Quelle:
  [Authenticate your domain with Brevo](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC),
  [Suped: Brevo DMARC/DKIM/SPF](https://www.suped.com/learn/dmarc/how-to-set-up-dmarc-dkim-spf-for-brevo).
- SPF: `include:spf.brevo.com` auf @ (Lookups 5/10).
- Bounces: Webhooks (hard/soft bounce, blocked) per HTTPS → Worker-Route.
- Worker: REST `POST https://api.brevo.com/v3/smtp/email`, API-Key im
  Header, reines `fetch` — kein SDK nötig.

### Postmark (ActiveCampaign)

- EU/AVV: US-Hosting (AWS und Deft bei Chicago), ausdrücklich **keine
  EU-Server geplant**; AVV mit Standardvertragsklauseln ist seit 27.09.2021
  Teil der AGB. Quelle: [Postmark EU privacy](https://postmarkapp.com/eu-privacy).
- Preis: Developer-Plan 100 Mails/Monat kostenlos, darüber Basic 15 $/Monat
  (10.000 Mails) → Bedarf (~300/Monat) kostet **15 $/Monat**. Quelle:
  [Postmark Pricing](https://postmarkapp.com/pricing), [Vergleich 2026](https://klymentiev.com/blog/postmark-pricing).
- DKIM mit d=bhyo.de: ja — ein TXT `<selektor>pm._domainkey.bhyo.de`
  (Wert aus dem Dashboard); Return-Path-CNAME `pm-bounces.bhyo.de →
  pm.mtasv.net` für SPF-Ausrichtung. Quelle:
  [How do I verify a domain](https://postmarkapp.com/support/article/1046-how-do-i-verify-a-domain).
- SPF: kein Eintrag auf @ nötig (Return-Path-Subdomain).
- Bounces: Bounce-API und Webhooks; Inhalte 45 Tage gespeichert.
- Worker: REST `POST https://api.postmarkapp.com/email`, Server-Token im
  Header, `fetch`.
- Einordnung: technisch sehr gut, aber US-Verarbeitung und Kosten → für
  den Bedarf keine erste Wahl.

### Resend

- EU/AVV: AVV (Art. 28) ist in jedem Konto vorab unterschrieben, EU-US Data
  Privacy Framework; **Daten werden in den USA gespeichert**, die beim
  Anlegen der Domain gewählte Region (u. a. `eu-west-1` Irland) bestimmt nur,
  von wo gesendet wird. Quellen: [Resend GDPR](https://resend.com/security/gdpr),
  [Resend DPA](https://resend.com/legal/dpa), [Add a domain](https://resend.com/docs/add-a-domain).
- Preis: Free 3.000 Mails/Monat, 100/Tag, dauerhaft → Bedarf gedeckt (0 €).
  Quelle: [Resend Pricing 2026](https://nuntly.com/resend-pricing).
- DKIM mit d=bhyo.de: ja — TXT `resend._domainkey.bhyo.de`; dazu auf der
  Return-Path-Subdomain `send.bhyo.de` ein MX
  (`feedback-smtp.<region>.amazonses.com`) und ein TXT
  `v=spf1 include:amazonses.com ~all`. Quellen: [Cloudflare DNS bei Resend](https://resend.com/docs/knowledge-base/cloudflare),
  [Resend SPF/DKIM/DMARC](https://dmarcdkim.com/setup/how-to-setup-resend-spf-dkim-and-dmarc-records).
- SPF: kein Eintrag auf @ nötig.
- Bounces: Webhooks (`email.bounced`, `email.complained`), 1 Webhook im
  Free-Plan.
- Worker: REST `POST https://api.resend.com/emails`, Bearer-Token, `fetch`.
- Einordnung: einfachste API, aber Speicherung in den USA und Versand
  technisch über SES.

### Amazon SES (eu-central-1 Frankfurt)

- EU/AVV: Region Frankfurt, Daten bleiben in der Region; AWS-GDPR-DPA
  gilt automatisch über die Service Terms. Quellen: [SES Regions](https://www.mailblast.io/blog/ses/amazon-ses-regions-explained),
  [AWS DPA](https://docs.aws.amazon.com/whitepapers/latest/navigating-gdpr-compliance/aws-data-processing-addendum-dpa.html).
- Preis: 0,10 $ je 1.000 Mails (≈ 0,03 $/Monat beim Bedarf); 3.000
  Mails/Monat zwölf Monate frei für neue Konten. Sandbox zuerst: nur
  verifizierte Empfänger, 200/Tag, Produktionsfreigabe per Antrag. Quellen:
  [SES Pricing 2026](https://smtpedia.com/amazon-aws-ses-pricing/),
  [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
- DKIM mit d=bhyo.de: ja — Easy DKIM: drei CNAME
  `<token>._domainkey.bhyo.de → <token>.dkim.amazonses.com` (2048 Bit).
  Für SPF-Ausrichtung eigene MAIL-FROM-Subdomain (`mail.bhyo.de`) mit MX
  `feedback-smtp.eu-central-1.amazonses.com` und TXT
  `v=spf1 include:amazonses.com ~all`. Quelle: [Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html).
- SPF: kein Eintrag auf @ nötig (MAIL-FROM-Subdomain).
- Bounces: über SNS-Themen oder Event Destinations; ein HTTPS-Abonnement
  auf eine Worker-Route ist möglich, braucht aber SNS-Setup und
  Bestätigung.
- Worker: HTTP-API mit **SigV4-Signatur** (z. B. `aws4fetch`); mehr
  Einrichtung (IAM-Nutzer mit Minimalrechten, Region, Sandbox-Antrag).
- Einordnung: günstigster und EU-saubersten Betrieb, aber am meisten
  Einrichtung (IAM, SNS, Sandbox).

### Mailjet (Sinch)

- EU/AVV: Daten auf Google Cloud in Frankfurt und Saint-Ghislain (Belgien),
  ausschließlich EU; AVV ist Teil der Sinch-Email-AGB; ISO 27001, erste
  AFNOR-DSGVO-Zertifizierung. Quellen: [Where is my personal data stored?](https://documentation.mailjet.com/hc/en-us/articles/360042712274-Where-is-my-personal-data-stored),
  [DPA](https://documentation.mailjet.com/hc/en-us/articles/360042750094-Do-you-provide-a-Data-Processing-Agreement-for-your-clients).
- Preis: Free 6.000 Mails/Monat, 200/Tag → Bedarf gedeckt (0 €). Quelle:
  [Mailjet Pricing 2026](https://www.sequenzy.com/pricing/mailjet).
- DKIM mit d=bhyo.de: ja — TXT `mailjet._domainkey.bhyo.de` (Wert aus dem
  Konto). SPF-Ausrichtung nur mit eigener Return-Path-Subdomain
  (`bnc3.bhyo.de` CNAME → `bnc3.mailjet.com`), sonst nur DKIM ausgerichtet
  — für p=reject reicht DKIM. Quellen: [Mailjet: Authenticating domains](https://documentation.mailjet.com/hc/en-us/articles/360049641733-Authenticating-Domains-with-SPF-and-DKIM-A-Complete-Guide),
  [EasyDMARC: Mailjet](https://easydmarc.com/blog/setup-dkim-and-spf-for-mailjet/).
- SPF: `include:spf.mailjet.com` auf @ (Lookups 5/10) — nur nötig, wenn
  ohne Return-Path-Subdomain gesendet wird.
- Bounces: Event-API/Webhooks (bounce, blocked, spam).
- Worker: REST `POST https://api.mailjet.com/v3.1/send`, Basic-Auth mit
  Key/Secret, `fetch`.

### Microsoft 365 per Graph API (sendMail)

- Was: `POST /users/{postfach}/sendMail` mit App-Berechtigung `Mail.Send`
  (Client-Credentials, App-Registrierung in Entra ID). Mail landet im
  „Gesendet" des Postfachs (abschaltbar). Antwort `202`, Zustellung
  unterliegt den Exchange-Online-Grenzen. Quelle:
  [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
- Einschränkung auf ein Postfach: `Mail.Send` als App-Berechtigung gilt
  tenantweit; Begrenzung per Exchange **ApplicationAccessPolicy**
  (`New-ApplicationAccessPolicy -AppId … -PolicyScopeGroupId <mail-aktivierte
  Gruppe mit dem Postfach> -AccessRight RestrictAccess`), wirksam nach bis
  zu einer Stunde. Quellen: [Limit mailbox access](https://github.com/microsoft/microsoft-graph-docs-1/blob/main/concepts/auth-limit-mailbox-access.md),
  [Mindcore: App Access Policies](https://blog.mindcore.dk/2026/02/microsoft-graph-remembered-to-restict-mail-send-application-permission-app-access-policies/).
- Grenzen/Drosselung: 10.000 Empfänger je Postfach und Tag, 30 Mails je
  Minute, Graph 10.000 Requests je App und Postfach je 10 Minuten — für den
  Bedarf irrelevant. Quelle: [Exchange Online limits (Graph)](https://learn.microsoft.com/en-us/answers/questions/2123005/it-is-not-clear-to-me-the-exact-number-of-mails-i).
- EU/AVV: bestehender M365-Tenant (bhyo-IT), kein neuer Anbieter, keine
  neue AVV.
- DNS: **kein** neuer SPF-Eintrag (M365 ist schon im SPF). DKIM-Ausrichtung
  setzt voraus, dass bhyo-IT DKIM für bhyo.de in M365 einschaltet
  (selector1/selector2-CNAMEs, Abschnitt 6) — heute fehlt das; bis dahin
  trägt nur SPF die DMARC-Prüfung (reicht ohne Weiterleitung).
- Bounces: keine Webhooks; Unzustellbarkeiten (NDR) landen im Postfach und
  müssten per Graph gelesen werden.
- Worker: Token per `POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`
  (client_credentials), dann `fetch` auf Graph; zwei Secrets (Client-ID,
  Client-Secret oder Zertifikat) als Wrangler-Secrets. Aufwand: Entra-App
  anlegen, Admin-Consent, Access-Policy per PowerShell — alles bei bhyo-IT.

## 4. Empfehlung

**Brevo** als erste Wahl: EU-Hosting mit Standard-AVV, Free-Plan deckt den
Bedarf dauerhaft, DKIM mit d=bhyo.de per CNAME (Rotation automatisch),
SPF ein `include` (5/10 Lookups), Bounce-Webhooks, reines `fetch` im Worker
ohne Signaturbibliothek. Mailjet ist technisch gleichwertig (ebenfalls EU,
frei), braucht für SPF-Ausrichtung aber die Return-Path-Subdomain; SES ist
die sauberste Betriebslösung, kostet aber IAM/SNS/Sandbox-Einrichtung und
SigV4 im Worker. Postmark (US) und Resend (Speicherung US) nur, wenn EU-
Speicherung nicht gefordert ist. **M365 per Graph** ist die Option ohne
neuen Anbieter und ohne DNS-Änderung — empfehlenswert, wenn bhyo-IT die
Entra-App und die Access-Policy übernimmt und M365-DKIM ohnehin
eingerichtet wird; Nachteil: keine Bounce-Webhooks, Betrieb hängt am
Tenant.

Weggabelung für Eric: (a) Brevo (neuer Anbieter, drei DNS-Einträge) oder
(b) M365 Graph (kein neuer Anbieter, Entra-App bei bhyo-IT). Beide
erfüllen DMARC p=reject, sobald DKIM eingerichtet ist.

**Entschieden (E74, Eric 09.10.2026): Variante (b), Microsoft 365 per Graph
`sendMail`.** Absender ist das bestehende Postfach `news@bhyo.de` (Konto in
Entra vorhanden). Entra-App mit Anwendungsberechtigung `Mail.Send`, per
`ApplicationAccessPolicy` (oder RBAC for Applications) auf `news@`
beschränkt; Client-Credentials mit Secret, keine Redirect-URI. Tenant-ID,
Client-ID und Secret trägt Eric als Worker-Secrets ein; die Einrichtung in
M365 übernimmt die bhyo-IT, Eric meldet die Fertigstellung. Kein neuer
Anbieter, keine DNS-Änderung. Begründung: Empfänger sind ausschließlich
`@bhyo.de`-Postfächer, der Versand bleibt im eigenen Tenant. Der Nebenbefund
M365-DKIM (Abschnitt 6) ist an die IT gegangen. Brevo bleibt oben als
Vergleich stehen, falls später externe Empfänger dazukommen.

## 5. DNS-Einträge, die Eric setzen müsste (Muster, keine echten Werte)

Variante Brevo:

```
bhyo.de                 TXT   "brevo-code:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
brevo1._domainkey       CNAME b1.<kennung>.dkim.brevo.com
brevo2._domainkey       CNAME b2.<kennung>.dkim.brevo.com
bhyo.de                 TXT   "v=spf1 include:_spf.odoo.com include:spf.protection.outlook.com include:spf.brevo.com -all"
```
(Der bestehende SPF-Eintrag wird ersetzt, nicht ergänzt — es darf nur einen
geben. Lookups danach 5/10.)

Variante M365 Graph: keine neuen Einträge für den Versand; nur die ohnehin
fälligen M365-DKIM-CNAMEs (Abschnitt 6).

Optional für beide: DMARC-Berichte `v=DMARC1; p=reject; rua=mailto:dmarc@bhyo.de`
(Postfach bei bhyo-IT), damit Ausrichtungsfehler sichtbar werden.

## 6. Nebenbefund für bhyo-IT (nicht unser Paket)

Microsoft 365 signiert Mails von bhyo.de heute nicht mit DKIM für bhyo.de:
die CNAMEs `selector1._domainkey.bhyo.de` und `selector2._domainkey.bhyo.de`
(Ziele `selector1-bhyo-de._domainkey.<tenant>.onmicrosoft.com` usw.) fehlen,
DKIM für die Domain ist im M365-Admin-Center also nicht aktiviert. Mit DMARC
`p=reject` hängt die Zustellbarkeit der normalen Firmenmail allein am SPF —
weitergeleitete Mails (z. B. über private Postfächer) scheitern dann.
Empfehlung an bhyo-IT: DKIM für bhyo.de in Exchange Online einschalten und
die beiden CNAMEs setzen; unabhängig davon, welcher Anbieter für die App
gewählt wird.

## 7. Nächste Schritte (nach Entscheidung)

1. Entschieden: Variante (b), siehe E74 in Abschnitt 4. bhyo-IT richtet
   Postfach-Prüfung, Entra-App, Admin-Zustimmung und Access-Policy ein
   (Anleitung folgt in `docs/betrieb/m365-mail.md`); Eric trägt Tenant-ID,
   Client-ID und Secret als Worker-Secrets ein.
2. AP2.9 baut `lib/mail/` mit dem Graph-Adapter (Token per
   client_credentials, `sendMail` mit `saveToSentItems=false`, Absender als
   Konfiguration `MAIL_ABSENDER`), eine Schreibstelle, Protokoll-Ereignis
   ohne Inhalte, Probemodus `MAIL_MODUS=protokoll` als Standard (nur loggen),
   Tests mit Mock, Logs ohne Token (E73). Entwurf parallel, ohne Secrets.
3. Roundup-Weggabelungen (Uhrzeit, Wochenende, Zähler, „nur bei Neuem",
   Abmeldung, Link-Ziel, Graph-Fehler, Secret-Ablauf) als Punkt-4-Bericht
   mit Empfehlung je Punkt; Eric macht daraus eine Vorlage.
4. Keine Bounce-Webhooks bei Graph: Zustellfehler kommen als
   Unzustellbarkeits-Mail ins Postfach `news@`; Umgang mit Graph-Fehlern
   gehört zu den Weggabelungen in Schritt 3.
