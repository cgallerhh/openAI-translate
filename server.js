import 'dotenv/config';

import express from 'express';

const PORT = process.env.PORT || 3000;
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const TRANSLATION_CLIENT_SECRET_URL =
  `${OPENAI_API_BASE}/realtime/translations/client_secrets`;
const SUPPORTED_DIALOGUE_LANGUAGES = new Set(['de', 'en', 'pl']);
const SUPPORTED_REALTIME_TARGET_LANGUAGES = new Set(['de', 'en']);

const app = express();

app.use(express.json());
app.use(express.static('public'));

function requireApiKey(res) {
  if (process.env.OPENAI_API_KEY) return true;

  res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  return false;
}

function normalizeLanguage(value, fallback) {
  return SUPPORTED_DIALOGUE_LANGUAGES.has(value) ? value : fallback;
}

async function openaiJson(path, body) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `OpenAI request failed: ${response.status}`);
  }

  return data;
}

async function transcribeAudio(audioBuffer, mimeType, sourceLanguage) {
  const form = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });

  form.append('file', audioBlob, 'speech.webm');
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('language', sourceLanguage);
  form.append('response_format', 'json');

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `Transcription failed: ${response.status}`);
  }

  return data.text?.trim() || '';
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const data = await openaiJson('/chat/completions', {
    model: process.env.TRANSLATION_TEXT_MODEL || 'gpt-4.1-mini',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise dialogue interpreter. Translate only the user text. Keep meaning, tone, names, numbers, and intent. Do not answer the text and do not add explanations.',
      },
      {
        role: 'user',
        content: `Translate from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`,
      },
    ],
  });

  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function synthesizeSpeech(text) {
  const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.TTS_VOICE || 'alloy',
      input: text,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.error || `Speech generation failed: ${response.status}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return audio.toString('base64');
}

app.post('/turn', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  try {
    if (!requireApiKey(res)) return;

    const sourceLanguage = normalizeLanguage(req.query.sourceLanguage, 'de');
    const targetLanguage = normalizeLanguage(req.query.targetLanguage, 'en');

    if (sourceLanguage === targetLanguage) {
      return res.status(400).json({ error: 'Source and target language must be different.' });
    }

    if (!req.body?.length) {
      return res.status(400).json({ error: 'No audio was received.' });
    }

    const original = await transcribeAudio(
      req.body,
      req.headers['content-type'],
      sourceLanguage,
    );

    if (!original) {
      return res.status(400).json({ error: 'No speech could be transcribed.' });
    }

    const translation = await translateText(original, sourceLanguage, targetLanguage);
    const audioBase64 = await synthesizeSpeech(translation);

    return res.json({
      sourceLanguage,
      targetLanguage,
      original,
      translation,
      audio: {
        mimeType: 'audio/mpeg',
        base64: audioBase64,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Dialogue turn could not be translated.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/session', async (req, res) => {
  try {
    if (!requireApiKey(res)) return;

    const requestedLanguage = req.body?.targetLanguage || 'en';
    const targetLanguage = SUPPORTED_REALTIME_TARGET_LANGUAGES.has(requestedLanguage)
      ? requestedLanguage
      : 'en';

    const response = await fetch(TRANSLATION_CLIENT_SECRET_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-realtime-translate',
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
              noise_reduction: { type: 'near_field' },
            },
            output: { language: targetLanguage },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to create OpenAI Realtime Translation client secret.',
        details: data?.error?.message || data?.error || data,
      });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error while creating a translation session.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Dialogue translator app running on http://localhost:${PORT}`);
});
