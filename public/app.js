import {
  detectLanguage,
  directionText,
  hasUnsupportedScript,
  LANGUAGE_LABELS,
  repeatRequest,
  targetLanguage,
} from './language.js';

const elements = {
  status: document.querySelector('#status'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  clearButton: document.querySelector('#clearButton'),
  timeline: document.querySelector('#timeline'),
  remoteAudio: document.querySelector('#remoteAudio'),
};

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/calls';

const state = {
  clientSessionId: createClientSessionId(),
  serial: 0,
  isConnecting: false,
  isRunning: false,
  isModelSpeaking: false,
  isReplaying: false,
  peerConnection: undefined,
  dataChannel: undefined,
  microphoneStream: undefined,
  turns: [],
  pendingOutputTurnIds: [],
  activeOutputTurnId: undefined,
  lastSourceLanguage: undefined,
};

function createClientSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTurn(itemId) {
  return {
    id: itemId || `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceLanguage: undefined,
    targetLanguage: undefined,
    original: '',
    translation: '',
    originalComplete: false,
    translationComplete: false,
  };
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
  elements.clearButton.disabled = !state.turns.length;
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

function setMicrophone(enabled) {
  const tracks = state.microphoneStream?.getAudioTracks() || [];
  for (const track of tracks) {
    if (track.readyState === 'live') track.enabled = enabled;
  }
}

function resumeMicrophoneIfSafe() {
  if (!state.isRunning || state.isModelSpeaking || state.isReplaying) return;
  setMicrophone(true);
}

function setModelSpeaking(speaking) {
  if (state.isModelSpeaking === speaking) return;

  state.isModelSpeaking = speaking;
  if (speaking) {
    unmuteRemoteAudio();
    elements.remoteAudio.play().catch(() => {});
    setMicrophone(false);
    const turn = getActiveOutputTurn();
    const label = turn?.targetLanguage ? `Spricht ${LANGUAGE_LABELS[turn.targetLanguage]} ...` : 'Spricht ...';
    setStatus(label, 'live');
    return;
  }

  resumeMicrophoneIfSafe();
  if (state.isRunning) setStatus('Hört zu ...', 'live');
}

function unmuteRemoteAudio() {
  elements.remoteAudio.muted = false;
  elements.remoteAudio.volume = 1;
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
  state.isModelSpeaking = false;
  state.isReplaying = false;
  state.pendingOutputTurnIds = [];
  state.activeOutputTurnId = undefined;
  setStatus('Verbindung unterbrochen', 'error');
  setControls();
  renderConversation();
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
  const response = await fetch('/interpreter-session', {
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
    unmuteRemoteAudio();
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
    setStatus('Hört zu ...', 'live');
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

async function startConversation() {
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
    setStatus('Hört zu ...', 'live');
  } catch (error) {
    stopConversation();
    setStatus(classifyError(error), 'error');
  } finally {
    state.isConnecting = false;
    setControls();
  }
}

function stopConversation() {
  state.serial += 1;

  if (state.dataChannel?.readyState === 'open') {
    try {
      state.dataChannel.send(JSON.stringify({ type: 'response.cancel' }));
    } catch {
      // Stop must stay immediate even if the data channel is already closing.
    }
  }

  state.dataChannel?.close();
  state.peerConnection?.close();
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  window.speechSynthesis?.cancel();
  elements.remoteAudio.pause();
  elements.remoteAudio.srcObject = null;
  elements.remoteAudio.muted = false;

  state.dataChannel = undefined;
  state.peerConnection = undefined;
  state.microphoneStream = undefined;
  state.isRunning = false;
  state.isConnecting = false;
  state.isModelSpeaking = false;
  state.isReplaying = false;
  state.pendingOutputTurnIds = [];
  state.activeOutputTurnId = undefined;
  setStatus('Bereit', 'idle');
  setControls();
  renderConversation();
}

function clearHistory() {
  state.turns = [];
  state.pendingOutputTurnIds = [];
  state.activeOutputTurnId = undefined;
  renderConversation();
}

function isDeltaEvent(type) {
  return type.endsWith('.delta') || type.endsWith('_delta');
}

function isDoneEvent(type) {
  return type.endsWith('.done') || type.endsWith('.completed') || type.endsWith('_done');
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
    type.includes('output_audio_transcript') ||
    type.includes('audio_transcript') ||
    type.includes('output_text') ||
    type.includes('response.text') ||
    (type.includes('output') && type.includes('transcript'))
  );
}

function isAudioOutputEvent(type) {
  return (
    type.includes('response.audio') ||
    type.includes('output_audio') ||
    type.includes('output_audio_buffer')
  );
}

function findText(value, depth = 0) {
  if (!value || depth > 6) return '';
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

function getText(payload) {
  return findText(payload);
}

function getInputItemId(payload) {
  return payload.item_id || payload.item?.id || payload.conversation_item_id || payload.id;
}

function findTurn(id) {
  return state.turns.find((turn) => turn.id === id);
}

function getOrCreateTurn(itemId) {
  const id = itemId || `turn-${state.turns.length + 1}`;
  const existing = findTurn(id);
  if (existing) return existing;

  const turn = createTurn(id);
  state.turns.push(turn);
  return turn;
}

function markTurnReadyForOutput(turn) {
  if (!state.pendingOutputTurnIds.includes(turn.id)) {
    state.pendingOutputTurnIds.push(turn.id);
  }
}

function cancelModelOutput() {
  if (state.dataChannel?.readyState !== 'open') return;

  try {
    state.dataChannel.send(JSON.stringify({ type: 'response.cancel' }));
  } catch {
    // Cancelling must not break the visible conversation state.
  }
}

function getActiveOutputTurn() {
  if (state.activeOutputTurnId) return findTurn(state.activeOutputTurnId);
  return undefined;
}

function getTurnForOutput() {
  const active = getActiveOutputTurn();
  if (active) return active;

  while (state.pendingOutputTurnIds.length) {
    const id = state.pendingOutputTurnIds.shift();
    const turn = findTurn(id);
    if (turn && !turn.translationComplete) {
      state.activeOutputTurnId = id;
      return turn;
    }
  }

  const unfinished = [...state.turns].reverse().find((turn) => !turn.translationComplete);
  if (unfinished) {
    state.activeOutputTurnId = unfinished.id;
    return unfinished;
  }

  const turn = createTurn();
  turn.sourceLanguage = state.lastSourceLanguage;
  turn.targetLanguage = turn.sourceLanguage ? targetLanguage(turn.sourceLanguage) : undefined;
  state.turns.push(turn);
  state.activeOutputTurnId = turn.id;
  return turn;
}

function completeTurnLanguages(turn) {
  if (!turn.sourceLanguage) {
    turn.sourceLanguage = detectLanguage(turn.original);
  }

  if (!turn.targetLanguage && turn.sourceLanguage) {
    turn.targetLanguage = targetLanguage(turn.sourceLanguage);
  }

  if (!turn.sourceLanguage && turn.translation) {
    const translatedLanguage = detectLanguage(turn.translation);
    if (translatedLanguage) {
      turn.targetLanguage = translatedLanguage;
      turn.sourceLanguage = targetLanguage(translatedLanguage);
    }
  }

  if (turn.sourceLanguage) state.lastSourceLanguage = turn.sourceLanguage;
}

function updateInputTranscript(payload, type, text) {
  const turn = getOrCreateTurn(getInputItemId(payload));

  if (isDeltaEvent(type)) {
    turn.original += text;
  } else if (isDoneEvent(type)) {
    turn.original = (text || turn.original).trim();
    turn.originalComplete = true;
    completeTurnLanguages(turn);
    markTurnReadyForOutput(turn);
    setStatus('Übersetzt ...', 'busy');
  } else if (text && !turn.original) {
    turn.original = text;
  }

  renderConversation();
}

function updateOutputTranscript(type, text) {
  const turn = getTurnForOutput();
  setModelSpeaking(true);

  if (text && hasUnsupportedScript(text)) {
    cancelUnsupportedOutput(turn);
    return;
  }

  if (isDeltaEvent(type)) {
    turn.translation += text;
  } else if (isDoneEvent(type)) {
    turn.translation = (text || turn.translation).trim();
    turn.translationComplete = true;
    completeTurnLanguages(turn);
    state.activeOutputTurnId = undefined;
  } else if (text && !turn.translation) {
    turn.translation = text;
  }

  renderConversation();
}

function cancelUnsupportedOutput(turn) {
  cancelModelOutput();
  turn.translation = repeatRequest(turn.targetLanguage || 'de');
  turn.translationComplete = true;
  turn.rejectedUnsupportedLanguage = true;
  state.activeOutputTurnId = undefined;
  state.pendingOutputTurnIds = state.pendingOutputTurnIds.filter((id) => id !== turn.id);
  setModelSpeaking(false);
  setStatus('Nur Deutsch oder Polnisch', 'error');
  renderConversation();
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
  const text = getText(payload);

  if (type === 'error') {
    setStatus(payload.error?.message || 'Realtime-Fehler', 'error');
    return;
  }

  if (type.includes('speech_started')) {
    setStatus('Hört zu ...', 'live');
    return;
  }

  if (type.includes('speech_stopped')) {
    setStatus('Übersetzt ...', 'busy');
    return;
  }

  if (isInputTranscriptEvent(type)) {
    updateInputTranscript(payload, type, text);
    return;
  }

  if (isOutputTranscriptEvent(type)) {
    updateOutputTranscript(type, text);
    return;
  }

  if (isAudioOutputEvent(type)) {
    if (isDeltaEvent(type) || type.includes('started')) setModelSpeaking(true);
    return;
  }

  if (type === 'response.done' || type === 'response.cancelled' || type === 'response.interrupted') {
    const turn = getActiveOutputTurn();
    if (turn && text && !turn.translation) {
      if (hasUnsupportedScript(text)) {
        cancelUnsupportedOutput(turn);
        return;
      }

      turn.translation = text.trim();
      turn.translationComplete = true;
      completeTurnLanguages(turn);
    }
    state.activeOutputTurnId = undefined;
    setModelSpeaking(false);
    renderConversation();
  }
}

function replayTurn(turnId) {
  const turn = findTurn(turnId);
  if (!turn?.translation.trim()) return;

  if (!('speechSynthesis' in window)) {
    setStatus('Nochmal abspielen nicht unterstützt', 'error');
    return;
  }

  window.speechSynthesis.cancel();
  state.isReplaying = true;
  setMicrophone(false);
  setControls();
  renderConversation();

  const utterance = new SpeechSynthesisUtterance(turn.translation.trim());
  utterance.lang = turn.targetLanguage === 'pl' ? 'pl-PL' : 'de-DE';
  utterance.onstart = () => setStatus(`Spricht ${LANGUAGE_LABELS[turn.targetLanguage] || ''} ...`, 'live');
  utterance.onend = () => finishReplay();
  utterance.onerror = () => finishReplay();
  window.speechSynthesis.speak(utterance);
}

function finishReplay() {
  state.isReplaying = false;
  resumeMicrophoneIfSafe();
  setStatus(state.isRunning ? 'Hört zu ...' : 'Bereit', state.isRunning ? 'live' : 'idle');
  setControls();
  renderConversation();
}

function renderConversation() {
  elements.timeline.innerHTML = '';

  if (!state.turns.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Gespräch starten und einfach sprechen.';
    elements.timeline.append(empty);
    setControls();
    return;
  }

  for (const turn of state.turns) {
    completeTurnLanguages(turn);

    const sourceLanguage = turn.sourceLanguage || 'unknown';
    const target = turn.targetLanguage || (turn.sourceLanguage ? targetLanguage(turn.sourceLanguage) : undefined);
    const bubbleLanguage = target || sourceLanguage;
    const item = document.createElement('article');
    item.className = `bubble ${bubbleLanguage}`;

    const label = document.createElement('p');
    label.className = 'bubble-label';
    label.textContent = target ? LANGUAGE_LABELS[target] : 'Übersetzung';

    const original = document.createElement('p');
    original.className = 'original';
    original.textContent = turn.sourceLanguage
      ? `${LANGUAGE_LABELS[turn.sourceLanguage]}: ${turn.original.trim() || 'Hört zu ...'}`
      : turn.original.trim() || 'Hört zu ...';

    const translation = document.createElement('p');
    translation.className = 'translation';
    translation.textContent = turn.translation.trim() || 'Übersetzt ...';

    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'replay';
    replay.textContent = 'Nochmal abspielen';
    replay.disabled = !turn.translation.trim() || state.isReplaying;
    replay.setAttribute(
      'aria-label',
      target ? `${LANGUAGE_LABELS[target]} nochmal abspielen` : 'Übersetzung nochmal abspielen',
    );
    replay.addEventListener('click', () => replayTurn(turn.id));

    const direction = document.createElement('span');
    direction.className = 'sr-only';
    direction.textContent = turn.sourceLanguage ? directionText(turn.sourceLanguage) : '';

    item.append(label, direction, original, translation, replay);
    elements.timeline.append(item);
  }

  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  setControls();
}

elements.startButton.addEventListener('click', startConversation);
elements.stopButton.addEventListener('click', stopConversation);
elements.clearButton.addEventListener('click', clearHistory);
window.addEventListener('pagehide', stopConversation);

renderConversation();
setControls();
