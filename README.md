# OpenAI Dialogue Translator Web App

Minimale Web-App fuer turn-basierten Dialog zwischen Deutsch, Englisch und Polnisch.

Die App nimmt einen gesprochenen Beitrag auf, transkribiert ihn, uebersetzt ihn in die Zielsprache und spielt die Uebersetzung als Audio ab. Dadurch eignet sie sich besser fuer Gespraeche als eine reine Ein-Richtungs-Live-Uebersetzung.

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

Optional koennen Text- und Sprachmodelle konfiguriert werden:

```env
TRANSLATION_TEXT_MODEL=gpt-4.1-mini
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
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
3. Wenn du sprichst: **Ich spreche** klicken, Satz sagen, **Aufnahme stoppen** klicken.
4. Wenn dein Gegenueber spricht: **Partner spricht** klicken, Satz sagen lassen, **Aufnahme stoppen** klicken.
5. Die App zeigt pro Beitrag **Original** und **Uebersetzung** und spielt die Uebersetzung als Audio ab.

## Warum turn-basiert?

Ein echter Dialog auf einem einzelnen Geraet ist sonst schnell unpraktisch, weil die App die eigene Audioausgabe wieder ueber das Mikrofon aufnehmen kann. Der turn-basierte Modus trennt klar, wer gerade spricht, und welche Richtung uebersetzt werden soll.

## Sicherheit

- Der echte `OPENAI_API_KEY` wird nur serverseitig in `server.js` genutzt.
- Audio wird nur fuer die aktuelle Uebersetzung an OpenAI gesendet und von dieser App nicht gespeichert.
- Transkripte werden nur im Browser angezeigt und von dieser App nicht dauerhaft gespeichert.
- Den API-Key nicht committen, nicht in Logs ausgeben und nicht in Browser-Code einbauen.

## Hinweis

Der Browser braucht Mikrofonfreigabe. Ohne Mikrofonzugriff kann die App keine Sprache aufnehmen.
