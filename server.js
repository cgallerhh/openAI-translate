import 'dotenv/config';

import express from 'express';

const PORT = process.env.PORT || 3000;
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const REALTIME_TRANSLATION_CLIENT_SECRET_URL = `${OPENAI_API_BASE}/realtime/translations/client_secrets`;
const SUPPORTED_LANGUAGES = new Set(['de', 'en', 'pl']);

const app = express();

app.use(express.json());
app.use(express.static('public'));

function requireApiKey(res) {
  if (process.env.OPENAI_API_KEY) return true;

  res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  return false;
}

function normalizeLanguage(value, fallback) {
  return SUPPORTED_LANGUAGES.has(value) ? value : fallback;
}

function readClientSecret(payload) {
  if (typeof payload?.value === 'string') return payload.value;
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value;
}

app.post('/interpreter-session', async (req, res) => {
  try {
    if (!requireApiKey(res)) return;

    const sourceLanguage = normalizeLanguage(req.body?.sourceLanguage, 'pl');
    const targetLanguage = normalizeLanguage(req.body?.targetLanguage, 'de');

    if (sourceLanguage === targetLanguage) {
      return res.status(400).json({ error: 'Please choose two different languages.' });
    }

    const response = await fetch(REALTIME_TRANSLATION_CLIENT_SECRET_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600,
        },
        session: {
          model: process.env.REALTIME_MODEL || 'gpt-realtime-translate',
          audio: {
            output: {
              language: targetLanguage,
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to create OpenAI Realtime translation session.',
        details: data?.error?.message || data?.error || data,
      });
    }

    return res.json({
      client_secret: readClientSecret(data),
      expires_at: data.expires_at,
      source_language: sourceLanguage,
      target_language: targetLanguage,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error while creating a translation session.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Realtime translation app running on http://localhost:${PORT}`);
});
