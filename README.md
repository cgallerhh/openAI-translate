# Deutsch-Polnisch-Dolmetscher

Einfache Web-App fuer ein gemeinsames Smartphone, Tablet oder Notebook.

- **Polnisch sprechen**: nimmt Polnisch auf und gibt Deutsch aus.
- **Deutsch sprechen**: nimmt Deutsch auf und gibt Polnisch aus.
- **Stop**: beendet Mikrofon, WebRTC-Verbindung und Wiedergabe.

Der OpenAI-API-Key bleibt auf dem Server. Der Browser bekommt nur ein kurzlebiges Realtime-Client-Secret.

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

## Bedienung

1. Auf **Polnisch sprechen** tippen, wenn Polnisch gesprochen wird.
2. Auf **Deutsch sprechen** tippen, wenn Deutsch gesprochen wird.
3. Die App zeigt Original und Übersetzung an und spielt die Übersetzung vor.
4. Mit **Stop** alles sofort beenden.

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

## Optionale `.env`-Werte

```env
PORT=3000
REALTIME_MODEL=gpt-realtime-translate
REALTIME_SESSION_TTL_SECONDS=300
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://translate.christian-galler.de
RATE_LIMIT_WINDOW_MS=600000
RATE_LIMIT_MAX=20
```

## Tests

```bash
npm run check
npm test
npm run build
npm audit
```

## Datenschutz

Die gesprochenen Inhalte werden zur Echtzeitverarbeitung an OpenAI übertragen. Audio wird von dieser Anwendung nicht dauerhaft gespeichert. Der Verlauf bleibt nur im Browser-Arbeitsspeicher und wird beim Neuladen gelöscht.
