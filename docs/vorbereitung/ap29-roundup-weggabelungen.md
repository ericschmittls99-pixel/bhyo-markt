# AP2.9 Roundup — Weggabelungen mit Empfehlung (Punkt 4)

Stand 09.10.2026. Grundlage: E74 (Versand über M365 Graph aus `news@bhyo.de`),
der Adapter `apps/web/lib/mail/` mit Probemodus. Das Roundup selbst ist noch
nicht gebaut; diese Liste ist die Vorlage für Erics Entscheidung je Punkt.

| Nr. | Frage | Empfehlung |
|---|---|---|
| 1 | Uhrzeit | 07:07 Berlin, täglich (nach dem Hinweis-Job 05:00, vor Arbeitsbeginn; krumme Minute wie die anderen Jobs). |
| 2 | Wochenende | Kein Versand Sa/So. Der Montags-Roundup deckt Fr–So ab, weil er „seit letztem Versand" zählt. |
| 3 | Welche Zähler | Je Typ die offenen Einträge des Empfängers: Kommentare, Erwähnungen, Änderungen an eigenen Einträgen, weitergegebene Aufgaben (mit Fälligkeit), Job-Hinweise (Verifikation läuft ab/abgelaufen, wird frei, verwaister Akteur, Löschprüfung). Je Typ zwei Zahlen: offen gesamt, davon neu seit letztem Roundup. Keine Inhalte, keine Namen Dritter (E73). |
| 4 | „nur bei Neuem" | Versand nur, wenn seit dem letzten erfolgreichen Roundup mindestens ein neuer offener Eintrag entstanden ist oder eine Aufgabe fällig wird. Bloß ungelesener Altbestand löst keine Mail aus (sonst tägliches Rauschen). Deaktivierte Nutzer und Betrachter ohne Einträge nie. |
| 5 | Abmeldung | Einstellung je Nutzer (`benutzer.roundup`, Standard an) in *einstellungen.*; Admin sieht sie. Kein Abmelde-Link in der Mail (interner Kreis hinter Access, Einstellung in der App). |
| 6 | Link-Ziel | Genau ein Link auf `/inbox` der Production-URL. Keine Einzel-Links je Eintrag — Inhalt bleibt in der App, die Mail ist nur der Anstoß. Preview sendet nie (`MAIL_MODUS=protokoll`). |
| 7 | Verhalten bei Graph-Fehlern | Der Job bricht nicht ab; je Empfänger ein Ergebnis. `gedrosselt`: einmal nach Retry-After wiederholen, sonst nächster Tag. `secret_abgelaufen`, `secret_ungueltig`, `zugriff_verweigert`, `postfach_unbekannt`: Admin-Hinweis in der Inbox (zustandsbasiert, einmal je Störung) plus Log. Kein Protokoll-Ereignis bei Fehlschlag; „letzter Roundup" wird nur bei Erfolg gesetzt, damit nichts verloren geht. |
| 8 | Secret-Ablauf erkennen | Reaktiv: Entra-Antwort AADSTS7000222 → `secret_abgelaufen` → Admin-Hinweis (wie 7). Proaktiv: Ablaufdatum als Variable `M365_SECRET_ABLAUF` (Datum, kein Secret); der Job meldet 30 und 7 Tage vorher. Beides; Graph selbst kann den Ablauf ohne weitere Berechtigung (`Application.Read.All`) nicht abfragen, die wollen wir nicht. |

Weitere Festlegungen im Adapter, zur Bestätigung:

- **Urheber des Ereignisses:** Die Mail wird am Empfänger protokolliert, mit
  dem Empfänger als Urheber (`benutzer`, `mail_gesendet`). Alternative wäre
  ein Systemnutzer, den es bisher nicht gibt. Text nennt Art, Modus und
  Längen, nie Betreff oder Inhalt.
- **„Letzter Roundup"** je Nutzer als Spalte `benutzer.roundup_zuletzt_am`
  (nur bei Erfolg gesetzt) — Grundlage für „neu seit".
- **Betreff und Text:** Betreff „bhyo: n neue Hinweise", Text als reine
  Textmail (kein HTML), Zähler je Typ in Zeilen, ein Link. Keine
  Personendaten Dritter, keine Stromnamen.
- **Reihenfolge der Umsetzung:** Spalten `benutzer.roundup` und
  `roundup_zuletzt_am` (Migration), Job `roundup` im Worker (Cron 07:07
  Berlin, Mo–Fr), Zähler-Abfrage, Text-Baustein, Versand über `sendeMail`,
  Admin-Hinweise für Störungen, Einstellung in der Oberfläche.
