# Deutsch-Polnisch Realtime-Dolmetscher

Web-App fuer einen Zwei-Wege-Dolmetscher auf einem gemeinsamen Smartphone, Tablet oder Notebook.

Die Anwendung nutzt die OpenAI Realtime Translation API mit WebRTC und standardmaessig `gpt-realtime-translate`. Der dauerhafte OpenAI-API-Key bleibt ausschliesslich auf dem Server. Der Browser erhaelt nur kurzlebige Client-Zugangsdaten ueber `/interpreter-session`.

## Architektur

- Express liefert die statische App aus `public/`.
- `POST /interpreter-session` erzeugt serverseitig ein kurzlebiges Realtime-Client-Secret.
- Der Browser baut genau eine WebRTC-Verbindung zu `https://api.openai.com/v1/realtime/translations/calls` auf.
- Die Zielrichtung wird pro Turn per `session.update` gesetzt:
  - Polnisch -> Deutsch
  - Deutsch -> Polnisch
- Der Verlauf bleibt nur im Arbeitsspeicher des Browsers und wird beim Neuladen geloescht.
- Es werden keine Audioaufnahmen dauerhaft gespeichert und keine Gespraechsinhalte serverseitig geloggt.

## Modi

### Automatischer Dialog

Der Mikrofontrack bleibt aktiv. Die App erkennt Deutsch oder Polnisch aus dem Realtime-Input-Transkript mit lokalen Heuristiken und setzt die Zielrichtung automatisch. Bei neuer menschlicher Sprache wird laufende Audioausgabe stummgeschaltet, um Unterbrechung und Feedback-Reduktion zu ermoeglichen.

### Push-to-talk

Der Mikrofontrack ist standardmaessig stumm. Die grossen Schaltflaechen "Polnisch sprechen" und "Deutsch sprechen" aktivieren das Mikrofon nur waehrend des Drueckens und setzen die Zielrichtung explizit. Dieser Modus ist der zuverlaessigste Fallback fuer kurze Antworten, Zahlen, Namen und laute Umgebungen.

## Voraussetzungen

- Node.js 20 oder neuer
- OpenAI API-Key mit Zugriff auf Realtime Translation
- HTTPS im Produktivbetrieb, damit Browser Mikrofon und WebRTC zulassen

## Installation

```bash
npm install
cp .env.example .env
```

In `.env` mindestens setzen:

```env
OPENAI_API_KEY=sk-...
```

Optionale Variablen:

```env
PORT=3000
REALTIME_MODEL=gpt-realtime-translate
REALTIME_SESSION_TTL_SECONDS=300
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://translate.christian-galler.de
RATE_LIMIT_WINDOW_MS=600000
RATE_LIMIT_MAX=20
```

## Start

```bash
npm run dev
```

Danach:

```text
http://localhost:3000
```

## Tests und Checks

```bash
npm run check
npm test
npm run build
```

`npm test` prueft die lokale Sprachrichtungserkennung. Browser-, Mikrofon-, Echo- und iOS-Safari-Verhalten muessen zusaetzlich manuell geprueft werden.

## Deployment auf dem Server

Produktiver Pfad:

```text
/opt/openAI-translate
```

Aktueller Reverse Proxy:

```text
translate.christian-galler.de -> 127.0.0.1:3001
```

Typischer Ablauf:

```bash
ssh root@89.167.14.159
cd /opt/openAI-translate
git pull --ff-only origin main
npm install
```

Dann den laufenden Node-Prozess neu starten. Aktuell laeuft `node server.js` direkt auf Port 3001; eine systemd-Unit ist nicht im Repository enthalten.

## Sicherheitsmassnahmen

- Kein OpenAI-API-Key im Frontend.
- Kurzlebige Client-Secrets nur ueber same-origin Session-Endpunkt.
- In-Memory-Rate-Limit fuer `/interpreter-session`.
- CSP, Permissions-Policy, Referrer-Policy und `X-Content-Type-Options`.
- `X-Powered-By` wird deaktiviert.
- Keine serverseitige Protokollierung von Audio, Transkripten oder Uebersetzungen.

## Diagnose

Die technische Diagnose ist nur mit Query-Parameter sichtbar:

```text
https://translate.christian-galler.de/?debug=1
```

Sie zeigt Verbindungsstatus, Modell, Session-Dauer, erkannte Sprache, Audio-Eingangsstatus und letzten Fehler. Sie zeigt keine API-Schluessel und keine Gespraechsinhalte.

## Manueller Testsatz

Fuer jeden Test Original, erkannte Transkription und Uebersetzung vergleichen.

| Nr. | Richtung | Original | Erwartete sinngemaesse Uebersetzung |
| --- | --- | --- | --- |
| 1 | PL -> DE | Dzień dobry, potrzebuję pomocy. | Guten Tag, ich brauche Hilfe. |
| 2 | DE -> PL | Guten Tag, wie kann ich helfen? | Dzień dobry, jak mogę pomóc? |
| 3 | PL -> DE | Tak. | Ja. |
| 4 | PL -> DE | Nie. | Nein. |
| 5 | DE -> PL | Ja. | Tak. |
| 6 | DE -> PL | Nein. | Nie. |
| 7 | PL -> DE | Nazywam się Anna Kowalska. | Ich heisse Anna Kowalska. |
| 8 | DE -> PL | Mein Name ist Christian Galler. | Nazywam się Christian Galler. |
| 9 | PL -> DE | Jadę do Łodzi jutro rano. | Ich fahre morgen frueh nach Lodz. |
| 10 | DE -> PL | Ich fahre heute nach München. | Jadę dzisiaj do Monachium. |
| 11 | PL -> DE | Mój numer telefonu to plus czterdzieści osiem, pięćset jeden, dwieście trzydzieści cztery, pięćset sześćdziesiąt siedem. | Meine Telefonnummer ist +48 501 234 567. |
| 12 | DE -> PL | Meine Telefonnummer ist null dreissig, eins zwei drei vier fuenf sechs. | Mój numer telefonu to 030 123456. |
| 13 | PL -> DE | To kosztuje sto dwadzieścia złotych. | Das kostet einhundertzwanzig Zloty. |
| 14 | DE -> PL | Das kostet 49 Euro und 90 Cent. | To kosztuje 49 euro i 90 centów. |
| 15 | PL -> DE | Spotkanie jest piętnastego lipca o godzinie dziewiątej. | Das Treffen ist am 15. Juli um 9 Uhr. |
| 16 | DE -> PL | Der Termin ist am 3. August um 14 Uhr. | Termin jest 3 sierpnia o godzinie 14. |
| 17 | PL -> DE | Proszę mówić wolniej. | Bitte sprechen Sie langsamer. |
| 18 | DE -> PL | Können Sie das bitte wiederholen? | Czy może Pan/Pani to proszę powtórzyć? |
| 19 | PL -> DE | Szukam ulicy Długiej w Gdańsku. | Ich suche die Długa-Strasse in Danzig. |
| 20 | DE -> PL | Ich suche die Rezeption im Krankenhaus. | Szukam recepcji w szpitalu. |

Zusaetzlich manuell pruefen:

- Wechsel nach jedem Sprecherbeitrag.
- Unterbrechung waehrend der Audioausgabe.
- Hintergrundgeraeusche und Lautsprecher-Echo.
- Verweigerte Mikrofonberechtigung.
- Netzwerkabbruch.
- Erneuter Start nach Stop.
- iOS Safari und macOS Safari.
- Vermeidung mehrerer paralleler Sessions pro Browser.

## Einschraenkungen

- Automatische Sprachrichtung ist bei reinen Zahlen, Eigennamen und sehr kurzen mehrdeutigen Aeusserungen nicht perfekt. Push-to-talk ist dafuer vorgesehen.
- Live-Audio von WebRTC wird nicht dauerhaft gespeichert. Die Funktion "Erneut abspielen" nutzt deshalb Browser-Sprachausgabe aus dem angezeigten Uebersetzungstext.
- Die dokumentierte OpenAI-Translation-Architektur fuer mehrere Zielsprachen verwendet in Broadcast-Szenarien eine Session pro Zielsprache. Diese App bleibt bewusst bei einer aktiven Browser-Session, um parallele oder verwaiste Sessions zu vermeiden.
