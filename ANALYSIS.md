# Analyse

Stand: 2026-07-10

## Ist-Architektur

- Repository: `cgallerhh/openAI-translate`.
- Produktion: `/opt/openAI-translate` auf `root@89.167.14.159`.
- Hosting: Caddy fuer `translate.christian-galler.de`, Reverse Proxy auf `127.0.0.1:3001`.
- Backend: Node.js/Express in `server.js`.
- Frontend: statische Dateien in `public/`.
- OpenAI-Modell: standardmaessig `gpt-realtime-translate`.
- API-Key: nur serverseitig in `.env`.
- Browser: nutzt kurzlebige Client-Secrets und verbindet per WebRTC zu OpenAI.

## Datenfluss

1. Nutzer tippt auf **Polnisch sprechen** oder **Deutsch sprechen**.
2. Browser oeffnet das Mikrofon mit Echo-Unterdrueckung, Rauschunterdrueckung und Auto-Gain.
3. Browser ruft `/interpreter-session` auf.
4. Server erzeugt mit dem echten OpenAI-API-Key ein kurzlebiges Realtime-Client-Secret.
5. Browser erstellt eine WebRTC-Verbindung zu OpenAI.
6. Die gewaehlte Taste setzt die feste Richtung:
   - Polnisch -> Deutsch
   - Deutsch -> Polnisch
7. OpenAI liefert Input-Transkript, Uebersetzungstext und Audioausgabe.
8. Stop beendet Mikrofon, WebRTC-Verbindung und Wiedergabe.

## Gefundene Probleme vor der Vereinfachung

- Die UI war zu komplex: Auto-Modus, Korrekturbuttons, Diagnose und verschachtelte Karten waren fuer den eigentlichen Zweck zu viel.
- Die Bedienung war nicht klar genug fuer ein gemeinsam genutztes Smartphone.
- Die App wirkte wie ein Debug-Tool statt wie ein Dolmetscher.
- Sicherheitsheader und Rate Limit fehlten im urspruenglichen Stand.

## Sicherheitsstand

- Kein dauerhafter OpenAI-API-Key im Frontend.
- `/interpreter-session` ist per Origin-Pruefung und einfachem IP-Rate-Limit begrenzt.
- CSP, Permissions-Policy, Referrer-Policy und `X-Content-Type-Options` sind gesetzt.
- Gespraechsinhalte werden nicht serverseitig geloggt.
- Audio wird von dieser Anwendung nicht dauerhaft gespeichert.

## Zielarchitektur

Bewusst einfache Einzelsession:

- Zwei grosse Tasten statt Moduslogik.
- Nutzer waehlt die Sprache selbst.
- Keine automatische Sprachheuristik in der Bedienoberflaeche.
- Eine aktive WebRTC-Session pro Browser.
- Zielrichtung wird per `session.update` gesetzt.
- Der Verlauf bleibt nur im Browser-Arbeitsspeicher.

## Betroffene Dateien

- `server.js`
- `public/index.html`
- `public/app.js`
- `public/language.js`
- `public/styles.css`
- `.env.example`
- `README.md`
- `tests/language.test.js`
