# Analyse: Zwei-Wege-Echtzeitdolmetscher

Stand: 2026-07-10

## Ist-Architektur

- Repository: `cgallerhh/openAI-translate`, produktiver Arbeitsbaum auf `root@89.167.14.159:/opt/openAI-translate`.
- Runtime: Node.js/Express, ESM, statische Auslieferung aus `public/`.
- Hosting: Caddy terminiert HTTPS fuer `translate.christian-galler.de` und leitet an `127.0.0.1:3001` weiter.
- Prozess: `node server.js` laeuft direkt als Shell-Kindprozess, keine systemd-Unit mit dem Namen `openAI-translate`.
- Backend:
  - `server.js` stellt `POST /interpreter-session` bereit.
  - Der Endpunkt ruft serverseitig `https://api.openai.com/v1/realtime/translations/client_secrets` auf.
  - Der echte `OPENAI_API_KEY` liegt nur in `.env` auf dem Server.
  - Der Browser erhaelt ein kurzlebiges `client_secret`.
- Frontend:
  - `public/index.html`, `public/app.js`, `public/styles.css`.
  - Eine aktive WebRTC-Verbindung pro gewaehlter Richtung.
  - Browser verbindet sich direkt mit `https://api.openai.com/v1/realtime/translations/calls`.
  - Audioausgabe kommt als Remote-WebRTC-Audiostream in ein `<audio autoplay>`-Element.
- Modelle:
  - Default: `gpt-realtime-translate`.
  - Server-`.env` enthaelt `REALTIME_MODEL`; Prozessumgebung zeigt nur `PORT=3001`, weil das Modell per `dotenv` aus `.env` gelesen wird.
  - `.env.example` nennt nur `OPENAI_API_KEY` und optional `REALTIME_MODEL`.

## Aktueller Datenfluss

1. Nutzer waehlt zwei Sprachen und eine Richtung.
2. Klick auf Start ruft `navigator.mediaDevices.getUserMedia()` mit Echo-Unterdrueckung, Rauschunterdrueckung und automatischer Verstaerkungsregelung auf.
3. Browser fordert ueber `/interpreter-session` ein kurzlebiges OpenAI-Client-Secret an.
4. Server erzeugt das Client-Secret mit dem dauerhaften OpenAI-API-Key.
5. Browser erstellt eine `RTCPeerConnection`, fuegt den Mikrofontrack hinzu und erstellt ein SDP-Angebot.
6. Browser sendet SDP mit dem kurzlebigen Secret an `/v1/realtime/translations/calls`.
7. OpenAI liefert SDP-Antwort; WebRTC-Verbindung wird aktiv.
8. Realtime-Events auf dem DataChannel aktualisieren Original- und Uebersetzungstext.
9. Uebersetztes Audio wird als Remote-Track im Browser abgespielt.
10. Beim Richtungswechsel wird die WebRTC-Verbindung geschlossen und mit neuer Zielrichtung neu aufgebaut; das Mikrofon bleibt dabei bisher aktiv.

## Gefundene Probleme

- Die Anwendung ist aktuell kein automatischer Zwei-Wege-Dialog, sondern eine manuell umgeschaltete Ein-Richtungs-Session.
- Englisch ist noch als Sprache sichtbar, obwohl das Ziel nur Deutsch und Polnisch verlangt.
- Der Verlauf trennt Original und Uebersetzung in getrennte Bubbles statt in einem nachvollziehbaren Gespraechsbeitrag.
- Keine Zeitstempel, keine Wiederholen-Schaltflaeche, keine Korrektur der Sprachrichtung pro Beitrag.
- Keine Push-to-talk-Steuerung als eigener robuster Fallback.
- Keine sichtbaren Zustandswerte fuer alle geforderten Phasen.
- Keine technische Diagnoseansicht.
- Keine Session-Dauer oder nutzungsbezogene Telemetrie ohne Inhalte.
- Stop beendet zwar PeerConnection und Mikrofontracks, stoppt aber laufende Audioausgabe nicht hart genug ueber Pause/Reset.
- Verwaiste oder parallele Starts werden nur teilweise per Frontend-Flags verhindert; serverseitig gibt es keine Bremse.
- Fehlerbehandlung ist zu grob fuer Mikrofonverweigerung, nicht unterstuetzte Browser, API-Fehler und Netzwerkabbrueche.
- Browser-Audioausgabe kann wieder vom Mikrofon erfasst werden; es gibt keine explizite Feedback-Unterdrueckung ausser Browser-Echo-Cancellation.
- Keine automatisierten Tests und kein dokumentierter manueller Testsatz.
- Keine CSP oder weitere Sicherheitsheader; `X-Powered-By: Express` ist sichtbar.
- Kein Rate Limit fuer `/interpreter-session`.
- CORS ist nicht explizit begrenzt; Express liefert zwar same-origin aus, aber es gibt keine Host-/Origin-Pruefung fuer den Session-Endpunkt.

## Sicherheitsrisiken

- Kein dauerhafter OpenAI-API-Key im Frontend gefunden.
- Kurzlebige Client-Secrets werden korrekt serverseitig erstellt, aber der Endpunkt ist ungeschuetzt gegen automatisiertes Ausloesen vieler Sessions.
- Server-Fehlerdetails werden an den Browser durchgereicht; API-Fehler koennen zu viel Implementierungsdetail enthalten.
- Es gibt keine Content Security Policy, keine expliziten Permissions-Policy-Regeln und kein Entfernen von `X-Powered-By`.
- Caddy/Express-Logs protokollieren bisher keine Gespraechsinhalte; das sollte so bleiben.
- Caddy-Logs zeigen einzelne Reverse-Proxy-Abbrueche, aber keine Transkripte.

## Streaming/WebRTC-Pruefung

- Der aktive Code verwendet `RTCPeerConnection`, SDP Offer/Answer und `fetch()` mit `Content-Type: application/sdp` gegen `/v1/realtime/translations/calls`.
- Es wird kein `MediaRecorder` verwendet und keine blockweise Datei hochgeladen.
- Die Anwendung nutzt also WebRTC-Streaming und nicht reine Batch-Audioaufnahme.

## Remote-Pruefung

- Oeffentliche URL `https://translate.christian-galler.de` liefert HTTP 200.
- Header zeigen Caddy vor Express, aber keine CSP; `X-Powered-By: Express` ist sichtbar.
- `POST http://127.0.0.1:3001/interpreter-session` erzeugt auf dem Server ein kurzlebiges Secret fuer `pl -> de`; Secret wurde bei der Analyse redigiert.
- Echte Browser-Konsole, Mikrofonberechtigung und iOS-Safari-Verhalten konnten remote nicht vollautomatisch geprueft werden, weil kein steuerbarer Browser mit Mikrofon im Serverkontext verfuegbar ist. Diese Punkte muessen als manuelle Tests dokumentiert und nach Deployment praktisch ausgefuehrt werden.

## Vorgeschlagene Zielarchitektur

- Bestehende Express/WebRTC-App beibehalten; keine komplette Neuentwicklung.
- Eine aktive Realtime-Translation-Session pro Browserlauf halten.
- Session initial mit `gpt-realtime-translate` und Ziel `de` erstellen.
- Zielrichtung pro Turn ueber DataChannel-`session.update` umstellen:
  - Polnisch erkannt oder per PTT gewaehlt -> Ziel Deutsch.
  - Deutsch erkannt oder per PTT gewaehlt -> Ziel Polnisch.
- Automatischer Dialog:
  - Mikrofon laeuft kontinuierlich.
  - Sprache wird aus Realtime-Input-Transkript und einfachen Heuristiken fuer Deutsch/Polnisch erkannt.
  - Bei erkannter Sprache wird Zielrichtung gesetzt, Status sichtbar aktualisiert und der Beitrag entsprechend gespeichert.
  - Neue menschliche Sprache muted laufende Audioausgabe sofort, um Unterbrechung und Feedback-Reduktion zu ermoeglichen.
- Push-to-talk:
  - Nutzt dieselbe eine Realtime-Session.
  - Mikrofontrack ist standardmaessig deaktiviert.
  - Button "Polnisch sprechen" setzt Ziel Deutsch und aktiviert den Track nur waehrend des Drueckens/Toggle-Zeitraums.
  - Button "Deutsch sprechen" setzt Ziel Polnisch und aktiviert den Track analog.
- Backend:
  - Nur `de` und `pl` akzeptieren.
  - Einfaches In-Memory-Rate-Limit pro IP fuer Session-Erzeugung.
  - Sicherheitsheader und begrenzte Origin/Host-Pruefung.
  - Keine Inhaltslogs, keine Secrets in Fehlerantworten.
  - Diagnoseendpunkt nur fuer technische, inhaltsfreie Werte optional halten oder rein clientseitig anzeigen.
- Frontend:
  - Mobile-first UI mit zwei klaren Seiten/Farben plus Textlabels.
  - Beitrag als Einheit: erkannte Sprache, Original, Uebersetzung, Zeitstempel, Wiederholen, Richtung korrigieren.
  - Verlauf nur im Browser-Arbeitsspeicher; Reload loescht ihn.
  - Datenschutztext direkt sichtbar.

## Betroffene Dateien

- `ANALYSIS.md`: neue Analyse.
- `server.js`: Sicherheitsheader, Rate Limit, Sprachvalidierung, inhaltsfreie Session-Metadaten, robuste Fehler.
- `public/index.html`: neue UI-Struktur fuer Modi, Status, Verlauf, Diagnose, Datenschutz.
- `public/app.js`: Session-State-Machine, Auto-Modus, PTT-Modus, Fehlerbehandlung, Telemetrie, Wiederholen, Korrektur.
- `public/styles.css`: mobile-first Layout, Zustandsanzeigen, Touch-Ziele, Barrierefreiheit.
- `.env.example`: neue optionale Variablen fuer Host/Rate Limit/Modell.
- `README.md`: Setup, Deployment, Datenschutz, Testplan, manuelle Beispieldialoge.
- `package.json`: Testskripte/Checks, falls ohne neue Build-Pipeline moeglich.

## Umsetzungsreihenfolge

1. `ANALYSIS.md` erstellen.
2. Backend absichern: Header, Rate Limit, Sprache auf `de`/`pl`, Fehlerantworten reduzieren.
3. Frontend auf eine robuste Einzelsession umbauen.
4. Automatischen Dialog und Push-to-talk-Modus implementieren.
5. UI, Datenschutztext, Diagnose und Beitragshistorie ergaenzen.
6. `.env.example` und `README.md` aktualisieren.
7. Syntax-/Smoke-Tests und HTTP-Tests ausfuehren.
8. Aenderungen committen, pushen und per SSH auf `/opt/openAI-translate` deployen.
9. Produktiv-Header, Endpunkt und Prozess nach Deployment pruefen.
