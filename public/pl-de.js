const elements = {
  status: document.querySelector('#status'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  clearButton: document.querySelector('#clearButton'),
  timeline: document.querySelector('#timeline'),
  remoteAudio: document.querySelector('#remoteAudio'),
};

const TRANSLATION_CALL_URL = 'https://api.openai.com/v1/realtime/translations/calls';
const FINALIZE_IDLE_MS = 4500;
const SPEAKING_IDLE_MS = 450;
const UNSUPPORTED_SCRIPT =
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff\u0500-\u052f\u0600-\u06ff\u0750-\u077f\u0590-\u05ff\u0900-\u097f\u0e00-\u0e7f]/u;

const state = {
  clientSessionId: createClientSessionId(),
  serial: 0,
  isConnecting: false,
  isRunning: false,
  peerConnection: undefined,
  dataChannel: undefined,
  microphoneStream: undefined,
  turns: [],
  liveTurn: undefined,
  finalizeTimer: undefined,
  speakingTimer: undefined,
};

function createClientSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pl-de-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function supportsApp() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia &&
      window.RTCPeerConnection &&
      window.fetch,
  );
}

function setStatus(text, kind = 'idle') {
  elements.status.textContent = text;
  elements.status.dataset.kind = kind;
}

function setControls() {
  elements.startButton.disabled = state.isConnecting || state.isRunning;
  elements.stopButton.disabled = !state.isConnecting && !state.isRunning;
  elements.clearButton.disabled = !state.turns.length && !state.liveTurn;
}

function classifyError(error) {
  const name = error?.name || '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Mikrofon wurde blockiert.';
  if (name === 'NotFoundError') return 'Kein Mikrofon gefunden.';
  if (name === 'NotReadableError') return 'Mikrofon ist nicht verfügbar.';
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) return 'Netzwerkfehler.';
  return message || 'Fehler.';
}

function safeDelta(text) {
  if (!text) return '';
  if (UNSUPPORTED_SCRIPT.test(text)) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function appendReadableDelta(current, delta) {
  const value = safeDelta(delta);
  if (!value) return current;
  if (!current.trim()) return value;

  const last = current.at(-1) || '';
  const first = value[0] || '';
  const noSpaceBefore = /[.,!?;:%)\]}]/.test(first);
  const noSpaceAfter = /[(\[{]/.test(last);
  const needsSpace = !/\s/.test(last) && !noSpaceBefore && !noSpaceAfter;
  return `${current}${needsSpace ? ' ' : ''}${value}`;
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

  return state.microphoneStream;
}

async function createSession() {
  const response = await fetch('/polish-german-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Session-Id': state.clientSessionId,
    },
    body: JSON.stringify({}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.details || payload.error || 'Session konnte nicht erstellt werden.');

  const secret = payload.client_secret?.value || payload.client_secret || payload.value;
  if (!secret) throw new Error('Kein Client-Secret erhalten.');
  return secret;
}

async function connect() {
  const stream = await ensureMicrophone();
  const secret = await createSession();
  const serial = state.serial + 1;
  state.serial = serial;

  const peerConnection = new RTCPeerConnection();
  state.peerConnection = peerConnection;

  peerConnection.ontrack = (event) => {
    if (serial !== state.serial) return;
    elements.remoteAudio.muted = false;
    elements.remoteAudio.volume = 1;
    elements.remoteAudio.srcObject = event.streams[0];
    elements.remoteAudio.play().catch(() => {});
  };

  peerConnection.onconnectionstatechange = () => {
    if (serial !== state.serial) return;
    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
      markConnectionInterrupted();
    }
  };

  state.dataChannel = peerConnection.createDataChannel('oai-events');
  state.dataChannel.addEventListener('open', () => {
    if (serial !== state.serial) return;
    setStatus('Hört Polnisch ...', 'live');
  });
  state.dataChannel.addEventListener('message', (event) => handleRealtimeEvent(event, serial));
  state.dataChannel.addEventListener('close', () => {
    if (serial !== state.serial || !state.isRunning) return;
    markConnectionInterrupted();
  });

  for (const track of stream.getAudioTracks()) {
    track.enabled = true;
    peerConnection.addTrack(track, stream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(TRANSLATION_CALL_URL, {
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

async function startTranslation() {
  if (state.isConnecting || state.isRunning) return;

  if (!supportsApp()) {
    setStatus('Browser nicht unterstützt', 'error');
    return;
  }

  try {
    state.isConnecting = true;
    setControls();
    setStatus('Mikrofon wird geöffnet ...', 'busy');
    await connect();
    setStatus('Hört Polnisch ...', 'live');
  } catch (error) {
    stopTranslation();
    setStatus(classifyError(error), 'error');
  } finally {
    state.isConnecting = false;
    setControls();
  }
}

function stopTranslation() {
  state.serial += 1;
  clearTimeout(state.finalizeTimer);
  clearTimeout(state.speakingTimer);
  finalizeLiveTurn();

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
  setStatus('Bereit', 'idle');
  setControls();
  renderConversation();
}

function markConnectionInterrupted() {
  state.serial += 1;
  state.dataChannel?.close();
  state.peerConnection?.close();
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  elements.remoteAudio.pause();
  elements.remoteAudio.srcObject = null;

  state.dataChannel = undefined;
  state.peerConnection = undefined;
  state.microphoneStream = undefined;
  state.isRunning = false;
  state.isConnecting = false;
  setStatus('Verbindung unterbrochen', 'error');
  setControls();
  renderConversation();
}

function clearHistory() {
  clearTimeout(state.finalizeTimer);
  state.turns = [];
  state.liveTurn = undefined;
  renderConversation();
}

function ensureLiveTurn() {
  if (state.liveTurn) return state.liveTurn;

  state.liveTurn = {
    id: `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source: '',
    translation: '',
  };
  return state.liveTurn;
}

function appendSource(text) {
  const turn = ensureLiveTurn();
  const next = appendReadableDelta(turn.source, text);
  if (next === turn.source) return;

  turn.source = next;
  scheduleFinalize();
  renderConversation();
}

function appendTranslation(text) {
  const turn = ensureLiveTurn();
  const next = appendReadableDelta(turn.translation, text);
  if (next === turn.translation) return;

  turn.translation = next;
  setStatus('Übersetzt ...', 'busy');
  scheduleFinalize();
  renderConversation();
}

function scheduleFinalize() {
  clearTimeout(state.finalizeTimer);
  state.finalizeTimer = window.setTimeout(finalizeLiveTurn, FINALIZE_IDLE_MS);
}

function finalizeLiveTurn() {
  clearTimeout(state.finalizeTimer);
  const turn = state.liveTurn;
  if (!turn) return;

  if (turn.source.trim() || turn.translation.trim()) {
    state.turns.push({
      ...turn,
      source: turn.source.trim(),
      translation: turn.translation.trim(),
    });
  }

  state.liveTurn = undefined;
  if (state.isRunning) setStatus('Hört Polnisch ...', 'live');
  setControls();
  renderConversation();
}

function markSpeaking() {
  setStatus('Spricht Deutsch ...', 'live');
  clearTimeout(state.speakingTimer);
  state.speakingTimer = window.setTimeout(() => {
    if (state.isRunning) setStatus('Hört Polnisch ...', 'live');
  }, SPEAKING_IDLE_MS);
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
  const delta = typeof payload.delta === 'string' ? payload.delta : '';

  if (type === 'error') {
    setStatus(payload.error?.message || 'Realtime-Fehler', 'error');
    return;
  }

  if (type === 'session.input_transcript.delta') {
    appendSource(delta);
    return;
  }

  if (type === 'session.output_transcript.delta') {
    appendTranslation(delta);
    return;
  }

  if (type === 'session.output_audio.delta') {
    markSpeaking();
    return;
  }

  if (type === 'session.closed') {
    finalizeLiveTurn();
    return;
  }
}

function renderConversation() {
  elements.timeline.innerHTML = '';
  const turns = state.liveTurn ? [...state.turns, state.liveTurn] : state.turns;

  if (!turns.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Starten und polnische Sprache übersetzen lassen.';
    elements.timeline.append(empty);
    setControls();
    return;
  }

  for (const turn of turns) {
    const item = document.createElement('article');
    item.className = 'bubble de';

    const label = document.createElement('p');
    label.className = 'bubble-label';
    label.textContent = 'Deutsch';

    const source = document.createElement('p');
    source.className = 'original';
    source.textContent = turn.source.trim() ? `Polnisch: ${turn.source.trim()}` : 'Polnisch: Hört zu ...';

    const translation = document.createElement('p');
    translation.className = 'translation';
    translation.textContent = turn.translation.trim() || 'Übersetzt ...';

    item.append(label, source, translation);
    elements.timeline.append(item);
  }

  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  setControls();
}

elements.startButton.addEventListener('click', startTranslation);
elements.stopButton.addEventListener('click', stopTranslation);
elements.clearButton.addEventListener('click', clearHistory);
window.addEventListener('pagehide', stopTranslation);

renderConversation();
setControls();
