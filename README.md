# Deutsch-Polnisch-Dolmetscher

Einfache Web-App fuer ein gemeinsames Smartphone, Tablet oder Notebook am Tisch.

Bedienung:

1. **Gespraech starten** druecken.
2. Deutsch oder Polnisch sprechen.
3. Die App zeigt Original und Uebersetzung als Sprachblasen an und liest die Uebersetzung vor.
4. Mit **Gespraech beenden** werden Mikrofon, WebRTC-Verbindung und Wiedergabe geschlossen.

Es gibt keine manuelle Richtungsauswahl, keine Modi, keine Profile und keine Diagnoseoberflaeche.

## Technik

- Browser-Audio per WebRTC zur OpenAI Realtime API.
- Der OpenAI-API-Key bleibt auf dem Server.
- Der Browser bekommt nur ein kurzlebiges Realtime-Client-Secret.
- Audio wird von dieser Anwendung nicht dauerhaft gespeichert.
- Der Verlauf bleibt nur im Browser-Arbeitsspeicher und wird beim Neuladen geloescht.

## Lokal starten

```bash
npm install
cp .env.example .env
```

In `.env` setzen:

```env
OPENAI_API_KEY=sk-...
```

Start:

```bash
npm run dev
```

Dann öffnen:

```text
http://localhost:3000
```

## Optionale `.env`-Werte

```env
PORT=3000
REALTIME_MODEL=gpt-realtime-2.1
REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
REALTIME_VOICE=marin
REALTIME_SESSION_TTL_SECONDS=300
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://translate.christian-galler.de
RATE_LIMIT_WINDOW_MS=600000
RATE_LIMIT_MAX=20
```

## Server

Produktiver Pfad:

```text
/opt/openAI-translate
```

Caddy leitet weiter:

```text
translate.christian-galler.de -> 127.0.0.1:3001
```

Deployment:

```bash
ssh root@89.167.14.159
cd /opt/openAI-translate
git pull --ff-only origin main
npm install
PORT=3001 npm start
```

## Tests

```bash
npm run check
npm test
npm run build
npm audit
```

Manuell im Browser pruefen:

- Deutsch zu Polnisch.
- Polnisch zu Deutsch.
- mehrere polnische Sprecher nacheinander.
- schneller Sprachwechsel.
- kurze Antworten: ja, nein, tak, nie.
- Namen, Telefonnummern, Zahlen, Preise und Uhrzeiten.
- Stoppen und erneutes Starten.
- keine erneute Uebersetzung der eigenen Audioausgabe.
- iPhone Safari und iPad Safari.
