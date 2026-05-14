# OpenAI Realtime Translation Web App

Minimale Web-App fuer Live-Uebersetzung mit OpenAI Realtime Translation und `gpt-realtime-translate`.

## Voraussetzungen

- Node.js 20 oder neuer
- OpenAI API-Key
- Browser mit Mikrofonzugriff

## Installation

```bash
npm install
```

## `.env` anlegen

```bash
cp .env.example .env
```

Dann `.env` oeffnen und den echten API-Key eintragen:

```env
OPENAI_API_KEY=sk-...
```

Der API-Key gehoert nur in die `.env` und niemals in Frontend-Dateien.

## Start

```bash
npm run dev
```

Danach im Browser oeffnen:

```text
http://localhost:3000
```

In GitHub Codespaces wird der Port meistens automatisch erkannt. Dann einfach auf **Open in Browser** klicken.

## Bedienung

1. Zielsprache waehlen:
   - Englisch: Deutsch sprechen, Englisch hoeren
   - Deutsch: Englisch sprechen, Deutsch hoeren
2. **Start** klicken.
3. Mikrofonfreigabe erlauben.
4. Sprechen.
5. Die Uebersetzung wird als Audio abgespielt und als Live-Text angezeigt.
6. Mit **Stop** wird die Verbindung beendet und das Mikrofon gestoppt.

## Sicherheit

- Der echte `OPENAI_API_KEY` wird nur serverseitig in `server.js` genutzt.
- Der Browser erhaelt nur einen kurzlebigen Client Secret.
- Audio- und Transkript-Daten werden von dieser App nicht gespeichert.
- Den API-Key nicht committen, nicht in Logs ausgeben und nicht in Browser-Code einbauen.

## Hinweis

Der Browser braucht Mikrofonfreigabe. Ohne Mikrofonzugriff kann die WebRTC-Verbindung keine Sprache an die Realtime Translation API senden.
