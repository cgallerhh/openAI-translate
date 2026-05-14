import 'dotenv/config';

import express from 'express';

const PORT = process.env.PORT || 3000;
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const REALTIME_CLIENT_SECRET_URL = `${OPENAI_API_BASE}/realtime/client_secrets`;
const SUPPORTED_LANGUAGES = new Set(['de', 'en', 'pl']);
const LANGUAGE_LABELS = {
  de: 'German',
  en: 'English',
  pl: 'Polish',
};

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

function buildInterpreterInstructions(myLanguage, partnerLanguage) {
  const mine = LANGUAGE_LABELS[myLanguage];
  const partner = LANGUAGE_LABELS[partnerLanguage];

  return `You are a simultaneous spoken interpreter for a two-person conversation.

Languages:
- Person A speaks ${mine}.
- Person B speaks ${partner}.

Your job:
- If you hear ${mine}, translate it into ${partner}.
- If you hear ${partner}, translate it into ${mine}.
- Translate spoken meaning only. Do not answer questions yourself.
- Do not explain, summarize, greet, add commentary, or roleplay.
- Preserve tone, intent, names, numbers, and level of formality.
- If the speaker pauses briefly, wait for enough context, then translate naturally.
- If speech is unclear, briefly say the translation-language equivalent of "I did not catch that.".
- Output only the translation, spoken aloud.`;
}

function readClientSecret(payload) {
  if (typeof payload?.value === 'string') return payload.value;
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value;
}

app.post('/interpreter-session', async (req, res) => {
  try {
    if (!requireApiKey(res)) return;

    const myLanguage = normalizeLanguage(req.body?.myLanguage, 'de');
    const partnerLanguage = normalizeLanguage(req.body?.partnerLanguage, 'en');

    if (myLanguage === partnerLanguage) {
      return res.status(400).json({ error: 'Please choose two different languages.' });
    }

    const response = await fetch(REALTIME_CLIENT_SECRET_URL, {
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
          type: 'realtime',
          model: process.env.REALTIME_MODEL || 'gpt-realtime',
          instructions: buildInterpreterInstructions(myLanguage, partnerLanguage),
          output_modalities: ['audio'],
          audio: {
            input: {
              transcription: {
                model: process.env.REALTIME_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
              },
              noise_reduction: { type: 'near_field' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.45,
                prefix_padding_ms: 300,
                silence_duration_ms: 450,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              voice: process.env.REALTIME_VOICE || 'marin',
              speed: 1.05,
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to create OpenAI Realtime interpreter session.',
        details: data?.error?.message || data?.error || data,
      });
    }

    return res.json({
      client_secret: readClientSecret(data),
      expires_at: data.expires_at,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Unexpected server error while creating an interpreter session.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Realtime interpreter app running on http://localhost:${PORT}`);
});
