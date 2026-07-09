# OpenAI Realtime Translate Web App

Minimale Web-App fuer einen Zwei-Wege-Dolmetscher zwischen Deutsch, Englisch und Polnisch.

Die App nutzt den dedizierten OpenAI Realtime-Translation-Endpoint mit `gpt-realtime-translate`. Eine aktive WebRTC-Session uebersetzt immer in genau eine Zielrichtung. Fuer ein Gespraech auf einem Geraet wird die Richtung ueber zwei Buttons gewechselt, zum Beispiel Polnisch -> Deutsch und danach Deutsch -> Polnisch.

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
REALTIME_MODEL=gpt-realtime-translate
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

1. **Meine Sprache** auswaehlen.
2. **Andere Sprache** auswaehlen.
3. Die aktive Richtung waehlen, zum Beispiel **Polnisch -> Deutsch**.
4. **Start** klicken und Mikrofon erlauben.
5. Wenn die andere Person spricht, die Richtung auf deren Sprache -> meine Sprache stellen.
6. Vor der Antwort die Richtung auf meine Sprache -> deren Sprache wechseln.
7. Mit **Stop** wird die Realtime-Verbindung beendet.

## Architektur

- Der Server erstellt kurzlebige Client Secrets ueber `/realtime/translations/client_secrets`.
- Der Browser verbindet sich per WebRTC mit `/realtime/translations/calls`.
- Beim Richtungswechsel wird die aktive WebRTC-Verbindung beendet und eine neue Translation-Session mit der neuen Zielsprache erstellt.
- Das Mikrofon bleibt beim Richtungswechsel aktiv, damit der Wechsel schnell bleibt.

## Praktische Hinweise

- Fuer ein einziges Handy sind Kopfhoerer oder Abstand zum Lautsprecher hilfreich, damit die App ihre eigene Sprachausgabe nicht wieder aufnimmt.
- Fuer echte Mehrpersonen-Setups mit getrennten Audio-Spuren sollte pro Sprecher/Zielsprache eine eigene Translation-Session genutzt werden.
- `gpt-realtime-translate` ist fuer live gesprochene Uebersetzung geeignet. `gpt-realtime-2.1` ist besser fuer Voice Agents, die selbst antworten oder Tools nutzen.
- Feste weibliche oder maennliche Stimmen pro Sprecher sind mit diesem einfachen Translation-Endpoint nicht steuerbar. Dafuer waere eine getrennte Pipeline aus Transkription, Uebersetzung und Text-to-Speech mit fest gewaehlten Stimmen noetig.

## Sicherheit

- Der echte `OPENAI_API_KEY` wird nur serverseitig in `server.js` genutzt.
- Der Browser erhaelt nur einen kurzlebigen Client Secret.
- Audio- und Transkript-Daten werden von dieser App nicht dauerhaft gespeichert.
- Den API-Key nicht committen, nicht in Logs ausgeben und nicht in Browser-Code einbauen.
