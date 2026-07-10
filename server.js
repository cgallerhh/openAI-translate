import 'dotenv/config';

import crypto from 'node:crypto';
import express from 'express';

const PORT = process.env.PORT || 3000;
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const REALTIME_TRANSLATION_CLIENT_SECRET_URL = `${OPENAI_API_BASE}/realtime/translations/client_secrets`;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime-translate';
const SESSION_SECRET_TTL_SECONDS = Number(process.env.REALTIME_SESSION_TTL_SECONDS || 300);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'https://translate.christian-galler.de',
];
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const SUPPORTED_LANGUAGES = new Set(['de', 'pl']);
const TRANSLATION_RULES = {
  de: 'pl',
  pl: 'de',
};
const SESSION_RATE_LIMITS = new Map();

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12kb' }));
app.use(securityHeaders);
app.use(express.static('public'));

function securityHeaders(req, res, next) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://api.openai.com",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "media-src 'self' blob: mediastream:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function requireApiKey(res) {
  if (process.env.OPENAI_API_KEY) return true;

  res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  return false;
}

function isAllowedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function requireAllowedOrigin(req, res) {
  if (isAllowedOrigin(req)) return true;

  res.status(403).json({ error: 'Origin is not allowed for session creation.' });
  return false;
}

function rateLimitKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(req, res) {
  const now = Date.now();
  const key = rateLimitKey(req);
  const entry = SESSION_RATE_LIMITS.get(key);

  if (!entry || entry.resetAt <= now) {
    SESSION_RATE_LIMITS.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count += 1;

  if (entry.count <= RATE_LIMIT_MAX) return true;

  const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: 'Too many session requests. Please try again later.' });
  return false;
}

function normalizeTargetLanguage(value) {
  if (SUPPORTED_LANGUAGES.has(value)) return value;
  return 'de';
}

function inferSourceLanguage(targetLanguage) {
  return TRANSLATION_RULES[targetLanguage];
}

function sanitizeClientId(value) {
  if (typeof value !== 'string') return 'anonymous';
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'anonymous';
}

function safetyIdentifier(req) {
  const clientId = sanitizeClientId(req.get('x-client-session-id'));
  return crypto
    .createHash('sha256')
    .update(`${rateLimitKey(req)}:${clientId}`)
    .digest('hex');
}

function readClientSecret(payload) {
  if (typeof payload?.value === 'string') return payload.value;
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value;
}

app.options('/interpreter-session', (req, res) => {
  if (!requireAllowedOrigin(req, res)) return;
  res.status(204).end();
});

app.post('/interpreter-session', async (req, res) => {
  try {
    if (!requireApiKey(res)) return;
    if (!requireAllowedOrigin(req, res)) return;
    if (!checkRateLimit(req, res)) return;

    const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
    const sourceLanguage = inferSourceLanguage(targetLanguage);

    if (!sourceLanguage) {
      return res.status(400).json({ error: 'Unsupported target language.' });
    }

    const response = await fetch(REALTIME_TRANSLATION_CLIENT_SECRET_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': safetyIdentifier(req),
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: SESSION_SECRET_TTL_SECONDS,
        },
        session: {
          model: REALTIME_MODEL,
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
        details: data?.error?.message || 'OpenAI session request failed.',
      });
    }

    return res.json({
      client_secret: readClientSecret(data),
      expires_at: data.expires_at,
      model: REALTIME_MODEL,
      source_language: sourceLanguage,
      target_language: targetLanguage,
    });
  } catch (error) {
    console.error('Session creation failed:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({
      error: 'Unexpected server error while creating a translation session.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Realtime translation app running on http://localhost:${PORT}`);
});
