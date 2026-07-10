import { directionText, LANGUAGE_LABELS, targetLanguage } from './language.js';

const elements = {
  status: document.querySelector('#status'),
  polishButton: document.querySelector('#polishButton'),
  germanButton: document.querySelector('#germanButton'),
  stopButton: document.querySelector('#stopButton'),
  clearButton: document.querySelector('#clearButton'),
  directionLabel: document.querySelector('#directionLabel'),
  originalLabel: document.querySelector('#originalLabel'),
  translationLabel: document.querySelector('#translationLabel'),
  originalText: document.querySelector('#originalText'),
  translationText: document.querySelector('#translationText'),
  historyCount: document.querySelector('#historyCount'),
  historyList: document.querySelector('#historyList'),
  remoteAudio: document.querySelector('#remoteAudio'),
};

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/translations/calls';

const state = {
  clientSessionId: createClientSessionId(),
  serial: 0,
  isConnecting: false,
  isRunning: false,
  activeLanguage: undefined,
  peerConnection: undefined,
  dataChannel: undefined,
  microphoneStream: undefined,
  currentTurn: emptyTurn(),
  history: [],
  model: 'gpt-realtime-translate',
};

function createClientSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyTurn() {
  return {
    sourceLanguage: undefined,
    targetLanguage: undefined,
    original: '',
    translation: '',
    startedAt: undefined,
  };
}

function setStatus(text, kind = 'idle') {
  elements.status.textContent = text;
  elements.status.dataset.kind = kind;
}

function supportsApp() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia &&
      window.RTCPeerConnection &&
      window.fetch,
  );
}

function classifyError(error) {
  const name = error?.name || '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Mikrofon wurde blockiert.';
  }

  if (name === 'NotFoundError') return 'Kein Mikrofon gefunden.';
  if (name === 'NotReadableError') return 'Mikrofon ist nicht verfügbar.';
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) return 'Netzwerkfehler.';
  return message || 'Fehler.';
}

function setButtons() {
  const busy = state.isConnecting;
  elements.polishButton.disabled = busy;
  elements.germanButton.disabled = busy;
  elements.stopButton.disabled = !state.isRunning && !state.isConnecting;
  elements.polishButton.classList.toggle('active', state.activeLanguage === 'pl');
  elements.germanButton.classList.toggle('active', state.activeLanguage === 'de');
  elements.polishButton.setAttribute('aria-pressed', String(state.activeLanguage === 'pl'));
  elements.germanButton.setAttribute('aria-pressed', String(state.activeLanguage === 'de'));
}

function setMicrophone(enabled) {
  const tracks = state.microphoneStream?.getAudioTracks() || [];
  for (const track of tracks) {
    if (track.readyState === 'live') track.enabled = enabled;
  }
}

function unmuteRemoteAudio() {
  elements.remoteAudio.muted = false;
  elements.remoteAudio.volume = 1;
}

async function ensureMicrophone() {
  const liveTrack = state.microphoneStream
    ?.getAudioTracks()
    .find((track) => track.readyState === 'live');

  if (liveTrack) return state.microphoneStream;

  state.microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  for (const track of state.microphoneStream.getAudioTracks()) {
    track.enabled = false;
  }

  return state.microphoneStream;
}

async function createSession(language) {
  const response = await fetch('/interpreter-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Session-Id': state.clientSessionId,
    },
    body: JSON.stringify({ targetLanguage: targetLanguage(language) }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.details || payload.error || 'Session konnte nicht erstellt werden.');

  state.model = payload.model || state.model;
  const secret = payload.client_secret?.value || payload.client_secret || payload.value;
  if (!secret) throw new Error('Kein Client-Secret erhalten.');
  return secret;
}

function sendSessionLanguage(language) {
  if (state.dataChannel?.readyState !== 'open') return;

  state.dataChannel.send(
    JSON.stringify({
      type: 'session.update',
      session: {
        audio: {
          output: {
            language: targetLanguage(language),
          },
        },
      },
    }),
  );
}

async function connect(language) {
  const stream = await ensureMicrophone();
  const secret = await createSession(language);
  const serial = state.serial + 1;
  state.serial = serial;

  const peerConnection = new RTCPeerConnection();
  state.peerConnection = peerConnection;

  peerConnection.ontrack = (event) => {
    if (serial !== state.serial) return;
    unmuteRemoteAudio();
    elements.remoteAudio.srcObject = event.streams[0];
    elements.remoteAudio.play().catch(() => {});
  };

  peerConnection.onconnectionstatechange = () => {
    if (serial !== state.serial) return;
    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
      setStatus('Verbindung unterbrochen', 'error');
      setMicrophone(false);
      state.activeLanguage = undefined;
      setButtons();
    }
  };

  state.dataChannel = peerConnection.createDataChannel('oai-events');
  state.dataChannel.addEventListener('open', () => sendSessionLanguage(language));
  state.dataChannel.addEventListener('message', (event) => handleRealtimeEvent(event, serial));
  state.dataChannel.addEventListener('close', () => {
    if (serial !== state.serial || !state.isRunning) return;
    setStatus('Verbindung unterbrochen', 'error');
    setMicrophone(false);
    state.activeLanguage = undefined;
    setButtons();
  });

  for (const track of stream.getAudioTracks()) {
    peerConnection.addTrack(track, stream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(REALTIME_CALL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/sdp',
      Accept: 'application/sdp',
    },
    body: offer.sdp,
  });

  if (!sdpResponse.ok) {
    const text = await sdpResponse.text();
    throw new Error(text || 'WebRTC-Verbindung fehlgeschlagen.');
  }

  await peerConnection.setRemoteDescription({
    type: 'answer',
    sdp: await sdpResponse.text(),
  });

  state.isRunning = true;
}

async function chooseLanguage(language) {
  if (state.isConnecting) return;

  if (!supportsApp()) {
    setStatus('Browser nicht unterstützt', 'error');
    return;
  }

  try {
    state.isConnecting = true;
    setButtons();
    setStatus('Mikrofon wird geöffnet', 'busy');

    if (!state.isRunning) {
      await connect(language);
    }

    startListening(language);
  } catch (error) {
    stopAll();
    setStatus(classifyError(error), 'error');
  } finally {
    state.isConnecting = false;
    setButtons();
  }
}

function startListening(language) {
  if (state.currentTurn.original || state.currentTurn.translation) {
    pushCurrentToHistory();
  }

  state.activeLanguage = language;
  state.currentTurn = {
    sourceLanguage: language,
    targetLanguage: targetLanguage(language),
    original: '',
    translation: '',
    startedAt: new Date(),
  };

  sendSessionLanguage(language);
  unmuteRemoteAudio();
  setMicrophone(true);
  setStatus(`Hört ${LANGUAGE_LABELS[language]}`, 'live');
  renderCurrent();
  setButtons();
}

function stopListeningForOutput() {
  setMicrophone(false);
  state.activeLanguage = undefined;
  setButtons();
}

function pushCurrentToHistory() {
  const turn = state.currentTurn;
  if (!turn.original && !turn.translation) return;
  state.history.unshift(turn);
  state.currentTurn = emptyTurn();
  renderHistory();
}

function stopAll() {
  state.serial += 1;

  if (state.dataChannel?.readyState === 'open') {
    try {
      state.dataChannel.send(JSON.stringify({ type: 'session.close' }));
    } catch {
      // Stop must stay immediate even if the data channel is already closing.
    }
  }

  state.dataChannel?.close();
  state.peerConnection?.close();
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  elements.remoteAudio.pause();
  elements.remoteAudio.srcObject = null;
  elements.remoteAudio.muted = false;

  state.dataChannel = undefined;
  state.peerConnection = undefined;
  state.microphoneStream = undefined;
  state.isRunning = false;
  state.isConnecting = false;
  state.activeLanguage = undefined;
  setStatus('Bereit', 'idle');
  setButtons();
}

function clearHistory() {
  state.history = [];
  state.currentTurn = emptyTurn();
  renderCurrent();
  renderHistory();
}

function isDeltaEvent(type) {
  return type.endsWith('.delta') || type.endsWith('_delta');
}

function isDoneEvent(type) {
  return type.endsWith('.done') || type.endsWith('.completed') || type.endsWith('_done');
}

function isAudioOnlyEvent(type) {
  return type.includes('audio') && !type.includes('transcript') && !type.includes('transcription');
}

function isInputTranscriptEvent(type) {
  return (
    type.includes('input_transcript') ||
    type.includes('input_audio_transcription') ||
    type.includes('speech_transcription')
  );
}

function isOutputTranscriptEvent(type) {
  return (
    type.includes('output_transcript') ||
    type.includes('audio_transcript') ||
    type.includes('output_text') ||
    (type.includes('output') && type.includes('transcript'))
  );
}

function findText(value, depth = 0) {
  if (!value || depth > 5) return '';
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value.map((item) => findText(item, depth + 1)).join('');
  }

  if (typeof value !== 'object') return '';

  const direct = ['transcript', 'text', 'output_text'];
  for (const key of direct) {
    if (typeof value[key] === 'string') return value[key];
  }

  if (typeof value.delta === 'string') return value.delta;

  const nested = ['delta', 'output', 'item', 'response', 'content', 'parts', 'message'];
  for (const key of nested) {
    const text = findText(value[key], depth + 1);
    if (text) return text;
  }

  return '';
}

function getText(payload, type) {
  if (isAudioOnlyEvent(type)) return '';
  return findText(payload);
}

function ensureCurrentTurn() {
  if (state.currentTurn.sourceLanguage) return true;
  if (!state.activeLanguage) return false;

  state.currentTurn = {
    sourceLanguage: state.activeLanguage,
    targetLanguage: targetLanguage(state.activeLanguage),
    original: '',
    translation: '',
    startedAt: new Date(),
  };
  return true;
}

function updateInputTranscript(payload, type, text) {
  if (!ensureCurrentTurn()) return;

  if (isDeltaEvent(type)) {
    state.currentTurn.original += text;
  } else if (isDoneEvent(type)) {
    state.currentTurn.original = (text || state.currentTurn.original).trim();
    setStatus('Übersetzt', 'busy');
  } else if (text && !state.currentTurn.original) {
    state.currentTurn.original = text;
  }

  renderCurrent();
}

function updateOutputTranscript(payload, type, text) {
  if (!ensureCurrentTurn()) return;

  stopListeningForOutput();
  unmuteRemoteAudio();

  if (isDeltaEvent(type)) {
    state.currentTurn.translation += text;
    setStatus(`Spricht ${LANGUAGE_LABELS[state.currentTurn.targetLanguage]}`, 'live');
  } else if (isDoneEvent(type)) {
    state.currentTurn.translation = (text || state.currentTurn.translation).trim();
    setStatus('Bereit', 'idle');
  } else if (text && !state.currentTurn.translation) {
    state.currentTurn.translation = text;
    setStatus(`Spricht ${LANGUAGE_LABELS[state.currentTurn.targetLanguage]}`, 'live');
  }

  renderCurrent();
}

function handleRealtimeEvent(event, serial) {
  if (serial !== state.serial) return;

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  const type = payload.type || '';
  const text = getText(payload, type);

  if (type === 'error') {
    setStatus(payload.error?.message || 'Realtime-Fehler', 'error');
    return;
  }

  if (type === 'session.closed') {
    setStatus('Bereit', 'idle');
    return;
  }

  if (isInputTranscriptEvent(type)) {
    updateInputTranscript(payload, type, text);
    return;
  }

  if (isOutputTranscriptEvent(type)) {
    updateOutputTranscript(payload, type, text);
    return;
  }

  if (type.includes('output_audio')) {
    stopListeningForOutput();
    unmuteRemoteAudio();
    setStatus(`Spricht ${LANGUAGE_LABELS[state.currentTurn.targetLanguage]}`, 'live');
  }
}

function renderCurrent() {
  const turn = state.currentTurn;

  if (!turn.sourceLanguage) {
    elements.directionLabel.textContent = 'Keine Aufnahme';
    elements.originalLabel.textContent = 'Original';
    elements.translationLabel.textContent = 'Übersetzung';
    elements.originalText.textContent = 'Bereit.';
    elements.translationText.textContent = 'Noch keine Übersetzung.';
    return;
  }

  elements.directionLabel.textContent = directionText(turn.sourceLanguage);
  elements.originalLabel.textContent = `Original (${LANGUAGE_LABELS[turn.sourceLanguage]})`;
  elements.translationLabel.textContent = `Übersetzung (${LANGUAGE_LABELS[turn.targetLanguage]})`;
  elements.originalText.textContent = turn.original.trim() || 'Hört zu...';
  elements.translationText.textContent = turn.translation.trim() || 'Wartet auf Übersetzung.';
}

function renderHistory() {
  elements.historyCount.textContent = String(state.history.length);
  elements.historyList.innerHTML = '';

  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Noch kein Beitrag.';
    elements.historyList.append(empty);
    return;
  }

  for (const turn of state.history) {
    const item = document.createElement('article');
    item.className = `history-item ${turn.sourceLanguage}`;

    const title = document.createElement('h3');
    title.textContent = directionText(turn.sourceLanguage);

    const original = document.createElement('p');
    original.textContent = turn.original.trim() || 'Kein Originaltext.';

    const translation = document.createElement('strong');
    translation.textContent = turn.translation.trim() || 'Keine Übersetzung.';

    item.append(title, original, translation);
    elements.historyList.append(item);
  }
}

elements.polishButton.addEventListener('click', () => chooseLanguage('pl'));
elements.germanButton.addEventListener('click', () => chooseLanguage('de'));
elements.stopButton.addEventListener('click', stopAll);
elements.clearButton.addEventListener('click', clearHistory);
window.addEventListener('pagehide', stopAll);

renderCurrent();
renderHistory();
setButtons();
