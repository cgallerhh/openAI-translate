# OpenAI Realtime Interpreter Web App

Minimale Web-App fuer einen Advanced-Audio-aehnlichen Simultanuebersetzer zwischen Deutsch, Englisch und Polnisch.

Die App oeffnet eine durchgehende WebRTC-Session mit `gpt-realtime`. Das Modell bekommt einen strengen Interpreter-Prompt: Es soll nichts beantworten, sondern nur zwischen den beiden gewaehlten Sprachen dolmetschen.

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

Optional:

```env
REALTIME_MODEL=gpt-realtime
REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
REALTIME_VOICE=marin
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

1. **Meine Sprache** auswaehlen: Deutsch, Englisch oder Polnisch.
2. **Partnersprache** auswaehlen: Deutsch, Englisch oder Polnisch.
3. **Start** klicken und Mikrofon erlauben.
4. Beide Personen sprechen normal in ihrer Sprache.
5. Die App spricht die Uebersetzung direkt aus und zeigt Live-Text fuer gesprochenen Text und Dolmetscher-Ausgabe.
6. Mit **Stop** wird die Realtime-Verbindung beendet.

## Praktische Hinweise

- Fuer Gespräche auf einem einzigen Handy sind Kopfhoerer oder Abstand zum Lautsprecher hilfreich, damit die App ihre eigene Sprachausgabe nicht wieder aufnimmt.
- Das ist ein Interpreter-Prompt auf `gpt-realtime`, nicht der spezialisierte `gpt-realtime-translate`-Flow. Grund: `gpt-realtime-translate` ist stark fuer Ein-Richtungs-Simultanuebersetzung, unterstuetzt Polnisch aber nicht als Ziel-Audiosprache.
- Der Modus ist naeher an ChatGPT Advanced Audio: eine laufende Sprachsession, automatische Sprachaktivitaet, direkte Audioantwort.

## Sicherheit

- Der echte `OPENAI_API_KEY` wird nur serverseitig in `server.js` genutzt.
- Der Browser erhaelt nur einen kurzlebigen Client Secret.
- Audio- und Transkript-Daten werden von dieser App nicht dauerhaft gespeichert.
- Den API-Key nicht committen, nicht in Logs ausgeben und nicht in Browser-Code einbauen.
