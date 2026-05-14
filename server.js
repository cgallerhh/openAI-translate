import 'dotenv/config';

import express from 'express';

const PORT = process.env.PORT || 3000;
const TRANSLATION_CLIENT_SECRET_URL =
  'https://api.openai.com/v1/realtime/translations/client_secrets';
const SUPPORTED_TARGET_LANGUAGES = new Set(['de', 'en']);

const app = express();

app.use(express.json());
app.use(express.static('public'));

app.post('/session', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const requestedLanguage = req.body?.targetLanguage || 'en';
    const targetLanguage = SUPPORTED_TARGET_LANGUAGES.has(requestedLanguage)
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
  console.log(`Realtime Translation app running on http://localhost:${PORT}`);
});
