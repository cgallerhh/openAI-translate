import { detectLanguage, directionLabel, LANGUAGE_LABELS, otherLanguage } from './language.js';

const elements = {
  status: document.querySelector('#status'),
  connectionDot: document.querySelector('#connectionDot'),
  autoModeButton: document.querySelector('#autoModeButton'),
  pttModeButton: document.querySelector('#pttModeButton'),
  detectedLanguage: document.querySelector('#detectedLanguage'),
  activeDirection: document.querySelector('#activeDirection'),
  audioInputState: document.querySelector('#audioInputState'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  clearButton: document.querySelector('#clearButton'),
  autoControls: document.querySelector('#autoControls'),
  pttControls: document.querySelector('#pttControls'),
  detectionHint: document.querySelector('#detectionHint'),
  forcePolishButton: document.querySelector('#forcePolishButton'),
  forceGermanButton: document.querySelector('#forceGermanButton'),
  polishTalkButton: document.querySelector('#polishTalkButton'),
  germanTalkButton: document.querySelector('#germanTalkButton'),
  currentTimestamp: document.querySelector('#currentTimestamp'),
  currentCard: document.querySelector('#currentCard'),
  historyList: document.querySelector('#historyList'),
  historyCount: document.querySelector('#historyCount'),
  diagnosticsPanel: document.querySelector('#diagnosticsPanel'),
  diagConnection: document.querySelector('#diagConnection'),
  diagModel: document.querySelector('#diagModel'),
  diagDuration: document.querySelector('#diagDuration'),
  diagLanguage: document.querySelector('#diagLanguage'),
  diagAudio: document.querySelector('#diagAudio'),
  diagError: document.querySelector('#diagError'),
  diagUsage: document.querySelector('#diagUsage'),
  remoteAudio: document.querySelector('#remoteAudio'),
};

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/translations/calls';
const STATUS = {
  ready: 'Bereit',
  openingMic: 'Mikrofon wird geöffnet',
  connecting: 'Realtime-Verbindung wird aufgebaut',
  listeningPl: 'Hört Polnisch',
  listeningDe: 'Hört Deutsch',
  translating: 'Übersetzt',
  speakingDe: 'Spricht Deutsch',
  speakingPl: 'Spricht Polnisch',
  disconnected: 'Verbindung unterbrochen',
  error: 'Fehler',
};

const state = {
  mode: 'auto',
  clientSessionId: createClientSessionId(),
  connectionSerial: 0,
  isRunning: false,
  isConnecting: false,
  peerConnection: undefined,
  dataChannel: undefined,
  microphoneStream: undefined,
  currentTargetLanguage: 'de',
  activeSourceLanguage: 'pl',
  expectedSourceLanguage: 'pl',
  detectedSourceLanguage: undefined,
  connectionStatus: 'Nicht verbunden',
  audioInputStatus: 'Aus',
  model: 'Unbekannt',
  sessionStartedAt: undefined,
  lastError: 'Keiner',
  currentTurn: undefined,
  history: [],
  turnSerial: 0,
  pttLanguage: undefined,
  pttActive: false,
  pttPressToken: 0,
  replayingTurnId: undefined,
  outputTimer: undefined,
  usage: {
    sessionRequests: 0,
    reconnects: 0,
    pttActivations: 0,
    interruptions: 0,
  },
};

function createClientSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function browserSupportsRealtime() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices?.getUserMedia &&
      window.RTCPeerConnection &&
      window.fetch,
  );
}

function setStatus(message, tone = 'ready') {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
  elements.connectionDot.dataset.tone = tone;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatTime(value) {
  if (!value) return 'Noch kein Beitrag';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendDelta(current, delta) {
  if (!delta) return current || '';
  return `${current || ''}${delta}`;
}

function targetForSource(sourceLanguage) {
  return otherLanguage(sourceLanguage);
}

function statusForListening(sourceLanguage) {
  return sourceLanguage === 'pl' ? STATUS.listeningPl : STATUS.listeningDe;
}

function statusForSpeaking(targetLanguage) {
  return targetLanguage === 'pl' ? STATUS.speakingPl : STATUS.speakingDe;
}

function currentDirectionLabel() {
  return directionLabel(state.activeSourceLanguage);
}

function classifyError(error) {
  const name = error?.name || '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Mikrofonzugriff wurde verweigert. Bitte Browserberechtigung prüfen und erneut starten.';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Kein Mikrofon gefunden.';
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Das Mikrofon kann nicht geöffnet werden. Es wird möglicherweise von einer anderen App verwendet.';
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Netzwerkfehler. Bitte Verbindung prüfen und erneut starten.';
  }

  return message || 'Unbekannter Fehler.';
}

function rememberError(error) {
  state.lastError = classifyError(error);
  setStatus(state.lastError, 'error');
  updateDiagnostics();
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;

  if (mode === 'auto') {
    endPushToTalk();
    setMicrophoneEnabled(state.isRunning);
  } else {
    setMicrophoneEnabled(false);
  }

  renderStaticState();
  if (!state.isRunning && !state.isConnecting) setStatus(STATUS.ready, 'ready');
}

function renderStaticState() {
  const isAuto = state.mode === 'auto';
  elements.autoModeButton.classList.toggle('active', isAuto);
  elements.pttModeButton.classList.toggle('active', !isAuto);
  elements.autoModeButton.setAttribute('aria-pressed', String(isAuto));
  elements.pttModeButton.setAttribute('aria-pressed', String(!isAuto));
  elements.autoControls.classList.toggle('hidden', !isAuto);
  elements.pttControls.classList.toggle('hidden', isAuto);
  elements.detectedLanguage.textContent = state.detectedSourceLanguage
    ? LANGUAGE_LABELS[state.detectedSourceLanguage]
    : 'Noch keine Sprache';
  elements.activeDirection.textContent = currentDirectionLabel();
  elements.audioInputState.textContent = state.audioInputStatus;
  elements.startButton.disabled = state.isRunning || state.isConnecting;
  elements.stopButton.disabled = !state.isRunning && !state.isConnecting;
  elements.polishTalkButton.disabled = isAuto && state.isRunning;
  elements.germanTalkButton.disabled = isAuto && state.isRunning;
  elements.polishTalkButton.setAttribute('aria-pressed', String(state.pttLanguage === 'pl' && state.pttActive));
  elements.germanTalkButton.setAttribute('aria-pressed', String(state.pttLanguage === 'de' && state.pttActive));
  elements.polishTalkButton.classList.toggle('active', state.pttLanguage === 'pl' && state.pttActive);
  elements.germanTalkButton.classList.toggle('active', state.pttLanguage === 'de' && state.pttActive);
  elements.detectionHint.textContent = state.detectedSourceLanguage
    ? `Erkannt: ${LANGUAGE_LABELS[state.detectedSourceLanguage]}`
    : 'Bereit für Polnisch oder Deutsch';
  updateDiagnostics();
}

async function ensureMicrophoneStream() {
  const liveTrack = state.microphoneStream
    ?.getAudioTracks()
    .find((track) => track.readyState === 'live');

  if (liveTrack) return state.microphoneStream;

  state.audioInputStatus = 'Wird geöffnet';
  renderStaticState();

  state.microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  state.audioInputStatus = 'Bereit';
  state.microphoneStream.getAudioTracks().forEach((track) => {
    track.enabled = false;
    track.addEventListener('ended', () => {
      state.audioInputStatus = 'Beendet';
      renderStaticState();
      if (state.isRunning) {
        setStatus(STATUS.disconnected, 'warning');
      }
    });
  });
  renderStaticState();
  return state.microphoneStream;
}

function setMicrophoneEnabled(enabled) {
  const liveTracks = state.microphoneStream
    ?.getAudioTracks()
    .filter((track) => track.readyState === 'live') || [];

  for (const track of liveTracks) {
    track.enabled = enabled;
  }

  if (!liveTracks.length) {
    state.audioInputStatus = 'Aus';
  } else {
    state.audioInputStatus = enabled ? 'An' : 'Stumm';
  }

  renderStaticState();
}

async function createInterpreterSession(targetLanguage) {
  state.usage.sessionRequests += 1;
  const response = await fetch('/interpreter-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Session-Id': state.clientSessionId,
    },
    body: JSON.stringify({ targetLanguage }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || 'Session konnte nicht erstellt werden.');
  }

  const clientSecret = readClientSecret(payload);
  if (!clientSecret) {
    throw new Error('Die Session-Antwort enthält kein Client-Secret.');
  }

  state.model = payload.model || state.model;
  return clientSecret;
}

function readClientSecret(payload) {
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value || payload?.value;
}

function sendRealtimeEvent(event) {
  if (state.dataChannel?.readyState !== 'open') return false;
  state.dataChannel.send(JSON.stringify(event));
  return true;
}

function updateTargetLanguage(targetLanguage) {
  state.currentTargetLanguage = targetLanguage;
  return sendRealtimeEvent({
    type: 'session.update',
    session: {
      audio: {
        output: {
          language: targetLanguage,
        },
      },
    },
  });
}

function releaseOutputMuteSoon(turn) {
  window.setTimeout(() => {
    if (!state.isRunning) return;
    if (turn && state.currentTurn?.id !== turn.id) return;
    elements.remoteAudio.muted = false;
  }, 250);
}

async function connectRealtime(initialTargetLanguage) {
  const clientSecret = await createInterpreterSession(initialTargetLanguage);
  const stream = await ensureMicrophoneStream();
  const serial = state.connectionSerial + 1;
  state.connectionSerial = serial;
  state.currentTargetLanguage = initialTargetLanguage;

  const peerConnection = new RTCPeerConnection();
  state.peerConnection = peerConnection;
  state.connectionStatus = 'Verbindet';
  renderStaticState();

  peerConnection.ontrack = (event) => {
    if (serial !== state.connectionSerial) return;
    const [remoteStream] = event.streams;
    elements.remoteAudio.srcObject = remoteStream;
    elements.remoteAudio.play().catch(() => {
      state.lastError = 'Audioausgabe wurde vom Browser blockiert. Bitte einmal auf Start oder Wiederholen tippen.';
      updateDiagnostics();
    });
  };

  peerConnection.onconnectionstatechange = () => {
    if (serial !== state.connectionSerial) return;
    state.connectionStatus = peerConnection.connectionState;

    if (peerConnection.connectionState === 'connected') {
      setStatus(state.mode === 'auto' ? STATUS.listeningPl : STATUS.ready, 'connected');
    }

    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
      setStatus(STATUS.disconnected, 'warning');
    }

    renderStaticState();
  };

  const dataChannel = peerConnection.createDataChannel('oai-events');
  state.dataChannel = dataChannel;
  dataChannel.addEventListener('open', () => {
    updateTargetLanguage(state.currentTargetLanguage);
  });
  dataChannel.addEventListener('message', (event) => handleRealtimeEvent(event, serial));
  dataChannel.addEventListener('close', () => {
    if (serial !== state.connectionSerial) return;
    state.connectionStatus = 'Geschlossen';
    renderStaticState();
  });

  for (const track of stream.getAudioTracks()) {
    peerConnection.addTrack(track, stream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(REALTIME_CALL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      'Content-Type': 'application/sdp',
      Accept: 'application/sdp',
    },
    body: offer.sdp,
  });

  if (!sdpResponse.ok) {
    const errorText = await sdpResponse.text();
    throw new Error(errorText || 'WebRTC-Verbindung konnte nicht erstellt werden.');
  }

  await peerConnection.setRemoteDescription({
    type: 'answer',
    sdp: await sdpResponse.text(),
  });
}

async function startInterpreter() {
  if (state.isRunning || state.isConnecting) return;

  if (!browserSupportsRealtime()) {
    rememberError(new Error('Dieser Browser unterstützt sichere WebRTC-Mikrofonverbindungen nicht vollständig.'));
    return;
  }

  try {
    state.isConnecting = true;
    state.lastError = 'Keiner';
    state.sessionStartedAt = Date.now();
    state.connectionStatus = 'Startet';
    setStatus(STATUS.openingMic, 'warning');
    renderStaticState();

    await ensureMicrophoneStream();
    setStatus(STATUS.connecting, 'warning');
    await connectRealtime(targetForSource(state.activeSourceLanguage));

    state.isRunning = true;
    state.isConnecting = false;
    setMicrophoneEnabled(state.mode === 'auto');
    setStatus(state.mode === 'auto' ? statusForListening(state.activeSourceLanguage) : STATUS.ready, 'connected');
    renderStaticState();
  } catch (error) {
    closeRealtimeConnection({ stopMicrophone: true });
    state.isRunning = false;
    state.isConnecting = false;
    rememberError(error);
    renderStaticState();
  }
}

function closeRealtimeConnection({ stopMicrophone = false } = {}) {
  state.connectionSerial += 1;

  if (state.dataChannel?.readyState === 'open') {
    try {
      state.dataChannel.send(JSON.stringify({ type: 'session.close' }));
    } catch {
      // Best effort only; Stop must always close immediately.
    }
  }

  state.dataChannel?.close();
  state.dataChannel = undefined;
  state.peerConnection?.close();
  state.peerConnection = undefined;

  if (stopMicrophone) {
    state.microphoneStream?.getTracks().forEach((track) => track.stop());
    state.microphoneStream = undefined;
  }

  elements.remoteAudio.pause();
  elements.remoteAudio.srcObject = null;
  elements.remoteAudio.muted = false;
  window.speechSynthesis?.cancel();
  state.replayingTurnId = undefined;
  state.pttActive = false;
  state.pttLanguage = undefined;
  state.connectionStatus = 'Nicht verbunden';
  state.audioInputStatus = stopMicrophone ? 'Aus' : state.audioInputStatus;
  clearTimeout(state.outputTimer);
  renderStaticState();
}

function stopInterpreter() {
  closeRealtimeConnection({ stopMicrophone: true });
  state.isRunning = false;
  state.isConnecting = false;
  state.sessionStartedAt = undefined;
  setStatus(STATUS.ready, 'ready');
  renderStaticState();
}

function getTranscript(payload) {
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.transcript === 'string') return payload.transcript;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.delta?.transcript === 'string') return payload.delta.transcript;
  if (typeof payload.delta?.text === 'string') return payload.delta.text;
  if (typeof payload.output?.transcript === 'string') return payload.output.transcript;
  if (typeof payload.output?.text === 'string') return payload.output.text;
  return '';
}

function handleRealtimeEvent(event, serial) {
  if (serial !== state.connectionSerial) return;

  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  const type = payload.type || '';
  const transcript = getTranscript(payload);

  if (type === 'error') {
    rememberError(new Error(payload.error?.message || 'Realtime-Fehler.'));
    return;
  }

  if (type === 'input_audio_buffer.speech_started' || type === 'session.speech_started') {
    handleSpeechStarted();
    return;
  }

  if (type === 'input_audio_buffer.speech_stopped' || type === 'session.speech_stopped') {
    handleSpeechStopped();
    return;
  }

  if (type.includes('input_transcript') && type.endsWith('.delta')) {
    appendInputTranscript(transcript);
    return;
  }

  if (type.includes('input_audio_transcription') && type.endsWith('.delta')) {
    appendInputTranscript(transcript);
    return;
  }

  if (type.includes('input_transcript') && (type.endsWith('.done') || type.endsWith('.completed'))) {
    finalizeInputTranscript(payload.transcript || payload.text || state.currentTurn?.original || '');
    return;
  }

  if (
    type.includes('input_audio_transcription') &&
    (type.endsWith('.done') || type.endsWith('.completed'))
  ) {
    finalizeInputTranscript(payload.transcript || payload.text || state.currentTurn?.original || '');
    return;
  }

  if (
    type.includes('output_transcript') ||
    type.includes('audio_transcript') ||
    type.includes('output_text')
  ) {
    if (type.endsWith('.done') || type.endsWith('.completed')) {
      finalizeOutputTranscript(payload.transcript || payload.text || state.currentTurn?.translation || '');
    } else {
      appendOutputTranscript(transcript);
    }
    return;
  }

  if (type === 'session.closed') {
    state.connectionStatus = 'Geschlossen';
    renderStaticState();
  }
}

function moveCurrentToHistoryIfNeeded() {
  const turn = state.currentTurn;
  if (!turn) return;
  if (!turn.original && !turn.translation) return;

  turn.status = turn.status === 'active' ? 'abgeschlossen' : turn.status;
  state.history.unshift(turn);
  state.currentTurn = undefined;
  renderHistory();
}

function beginTurn(sourceLanguage, detectionSource = 'auto') {
  moveCurrentToHistoryIfNeeded();

  const resolvedSource = sourceLanguage || (state.mode === 'ptt' ? state.pttLanguage : undefined);
  const targetLanguage = resolvedSource ? targetForSource(resolvedSource) : state.currentTargetLanguage;

  state.currentTurn = {
    id: ++state.turnSerial,
    startedAt: new Date(),
    sourceLanguage: resolvedSource,
    targetLanguage,
    detectionSource,
    original: '',
    translation: '',
    status: 'active',
    corrected: false,
    confidence: 0,
    note: '',
  };

  if (resolvedSource) {
    applyTurnLanguage(state.currentTurn, resolvedSource, detectionSource);
  } else {
    elements.remoteAudio.muted = true;
  }

  renderCurrentTurn();
  return state.currentTurn;
}

function writableTurn() {
  return state.currentTurn || beginTurn(undefined, state.mode === 'ptt' ? 'manual' : 'auto');
}

function applyTurnLanguage(turn, sourceLanguage, detectionSource = 'auto', confidence = 1) {
  turn.sourceLanguage = sourceLanguage;
  turn.targetLanguage = targetForSource(sourceLanguage);
  turn.detectionSource = detectionSource;
  turn.confidence = confidence;
  state.detectedSourceLanguage = sourceLanguage;
  state.activeSourceLanguage = sourceLanguage;

  updateTargetLanguage(turn.targetLanguage);
  releaseOutputMuteSoon(turn);
  setStatus(statusForListening(sourceLanguage), 'connected');
  renderStaticState();
  renderCurrentTurn();
}

function maybeDetectLanguage(turn) {
  if (state.mode !== 'auto') return;
  const text = normalizeText(turn.original);
  if (!text) return;

  const detection = detectLanguage(text, state.expectedSourceLanguage);
  const enoughText = text.length >= 18;
  const confident = detection.confidence >= 0.55;

  if (!turn.sourceLanguage || confident || enoughText) {
    applyTurnLanguage(turn, detection.language, 'auto', detection.confidence);
    elements.detectionHint.textContent = `Erkannt: ${LANGUAGE_LABELS[detection.language]}`;
  }
}

function appendInputTranscript(delta) {
  if (!delta) return;
  const turn = writableTurn();
  turn.original = appendDelta(turn.original, delta);
  maybeDetectLanguage(turn);
  renderCurrentTurn();
}

function finalizeInputTranscript(transcript) {
  const turn = writableTurn();
  const text = normalizeText(transcript || turn.original);
  if (text) turn.original = text;
  maybeDetectLanguage(turn);
  turn.status = 'übersetzt';
  setStatus(STATUS.translating, 'warning');
  renderCurrentTurn();
}

function appendOutputTranscript(delta) {
  if (!delta) return;
  const turn = writableTurn();
  turn.translation = appendDelta(turn.translation, delta);
  if (turn.targetLanguage) {
    setStatus(statusForSpeaking(turn.targetLanguage), 'connected');
  }
  clearTimeout(state.outputTimer);
  state.outputTimer = window.setTimeout(() => {
    if (state.isRunning) setStatus(STATUS.ready, 'ready');
  }, 1500);
  renderCurrentTurn();
}

function finalizeOutputTranscript(transcript) {
  const turn = writableTurn();
  const text = normalizeText(transcript || turn.translation);
  if (text) turn.translation = text;
  turn.status = 'abgeschlossen';

  if (turn.sourceLanguage) {
    state.expectedSourceLanguage = targetForSource(turn.sourceLanguage);
  }

  setStatus(state.mode === 'auto' ? STATUS.ready : STATUS.translating, 'ready');
  renderCurrentTurn();
  renderStaticState();
}

function handleSpeechStarted() {
  if (!state.isRunning) return;

  if (state.currentTurn?.status === 'abgeschlossen') {
    moveCurrentToHistoryIfNeeded();
  }

  state.usage.interruptions += elements.remoteAudio.muted ? 0 : 1;
  elements.remoteAudio.muted = true;

  if (!state.currentTurn) {
    beginTurn(state.mode === 'ptt' ? state.pttLanguage : undefined, state.mode === 'ptt' ? 'manual' : 'auto');
  }

  const sourceLanguage = state.currentTurn?.sourceLanguage || state.expectedSourceLanguage;
  setStatus(statusForListening(sourceLanguage), 'connected');
}

function handleSpeechStopped() {
  if (!state.isRunning) return;
  setStatus(STATUS.translating, 'warning');
}

async function startPushToTalk(language, token) {
  if (state.mode !== 'ptt') setMode('ptt');

  if (!state.isRunning && !state.isConnecting) {
    await startInterpreter();
  }

  if (token !== state.pttPressToken) return;
  if (!state.isRunning) return;

  state.pttActive = true;
  state.pttLanguage = language;
  state.usage.pttActivations += 1;
  const turn = beginTurn(language, 'manual');
  applyTurnLanguage(turn, language, 'manual');
  setMicrophoneEnabled(true);
  setStatus(statusForListening(language), 'connected');
  renderStaticState();
}

function endPushToTalk() {
  state.pttPressToken += 1;
  if (!state.pttActive) return;
  state.pttActive = false;
  state.pttLanguage = undefined;
  if (state.mode === 'ptt') setMicrophoneEnabled(false);
  setStatus(state.isRunning ? STATUS.translating : STATUS.ready, state.isRunning ? 'warning' : 'ready');
  renderStaticState();
}

function forceLanguage(language) {
  const turn = state.currentTurn || beginTurn(language, 'manual');
  turn.corrected = true;
  turn.note = turn.translation
    ? 'Richtung korrigiert. Für eine neue Übersetzung bitte den Beitrag erneut sprechen.'
    : '';
  applyTurnLanguage(turn, language, 'manual');
}

function correctHistoricalTurn(turnId, language) {
  const turn = [state.currentTurn, ...state.history].find((candidate) => candidate?.id === turnId);
  if (!turn) return;

  turn.sourceLanguage = language;
  turn.targetLanguage = targetForSource(language);
  turn.corrected = true;
  turn.note = turn.translation
    ? 'Richtung korrigiert. Für eine neue Übersetzung bitte den Beitrag erneut sprechen.'
    : '';

  if (state.currentTurn?.id === turn.id && turn.status !== 'abgeschlossen') {
    applyTurnLanguage(turn, language, 'manual');
  }

  renderCurrentTurn();
  renderHistory();
}

function clearHistory() {
  state.history = [];
  state.currentTurn = undefined;
  state.detectedSourceLanguage = undefined;
  renderCurrentTurn();
  renderHistory();
  renderStaticState();
}

function replayTurn(turn) {
  const text = normalizeText(turn.translation);
  if (!text) return;

  if (!('speechSynthesis' in window)) {
    rememberError(new Error('Dieser Browser unterstützt erneutes Vorlesen nicht.'));
    return;
  }

  window.speechSynthesis.cancel();
  const shouldRestoreMic = state.mode === 'auto' && state.isRunning;
  if (shouldRestoreMic) setMicrophoneEnabled(false);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = turn.targetLanguage === 'pl' ? 'pl-PL' : 'de-DE';
  utterance.rate = 0.95;
  state.replayingTurnId = turn.id;
  renderCurrentTurn();
  renderHistory();

  const done = () => {
    state.replayingTurnId = undefined;
    if (shouldRestoreMic && state.isRunning && state.mode === 'auto') setMicrophoneEnabled(true);
    renderCurrentTurn();
    renderHistory();
  };

  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.speak(utterance);
}

function createTurnCard(turn, compact = false) {
  const article = document.createElement('article');
  article.className = `turn-card ${compact ? 'compact' : 'current'} ${turn.sourceLanguage || state.expectedSourceLanguage}`;
  if (!compact) article.id = 'currentCard';

  const header = document.createElement('div');
  header.className = 'turn-header';

  const meta = document.createElement('div');
  meta.className = 'turn-meta';

  const language = document.createElement('strong');
  const sourceLanguage = turn.sourceLanguage || state.expectedSourceLanguage;
  language.textContent = directionLabel(sourceLanguage);

  const details = document.createElement('span');
  const detection = turn.detectionSource === 'manual' ? 'manuell' : 'automatisch';
  details.textContent = `${formatTime(turn.startedAt)} · ${detection}${turn.corrected ? ' · korrigiert' : ''}`;

  meta.append(language, details);

  const actions = document.createElement('div');
  actions.className = 'turn-actions';

  const replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.className = 'icon-button';
  replayButton.textContent = state.replayingTurnId === turn.id ? 'Wiedergabe läuft' : 'Erneut abspielen';
  replayButton.disabled = !normalizeText(turn.translation) || Boolean(state.replayingTurnId);
  replayButton.addEventListener('click', () => replayTurn(turn));

  const plButton = document.createElement('button');
  plButton.type = 'button';
  plButton.className = 'small-button';
  plButton.textContent = 'Polnisch';
  plButton.addEventListener('click', () => correctHistoricalTurn(turn.id, 'pl'));

  const deButton = document.createElement('button');
  deButton.type = 'button';
  deButton.className = 'small-button';
  deButton.textContent = 'Deutsch';
  deButton.addEventListener('click', () => correctHistoricalTurn(turn.id, 'de'));

  actions.append(replayButton, plButton, deButton);
  header.append(meta, actions);

  const original = document.createElement('section');
  original.className = 'turn-text original';
  const originalLabel = document.createElement('span');
  originalLabel.className = 'label';
  originalLabel.textContent = `Original (${LANGUAGE_LABELS[sourceLanguage]})`;
  const originalText = document.createElement('p');
  originalText.textContent = normalizeText(turn.original) || 'Sprache wird erkannt...';
  original.append(originalLabel, originalText);

  const translation = document.createElement('section');
  translation.className = 'turn-text translation';
  const translationLabel = document.createElement('span');
  translationLabel.className = 'label';
  translationLabel.textContent = `Übersetzung (${LANGUAGE_LABELS[turn.targetLanguage || targetForSource(sourceLanguage)]})`;
  const translationText = document.createElement('p');
  translationText.textContent = normalizeText(turn.translation) || 'Übersetzung läuft...';
  translation.append(translationLabel, translationText);

  article.append(header, original, translation);

  if (turn.note) {
    const note = document.createElement('p');
    note.className = 'turn-note';
    note.textContent = turn.note;
    article.append(note);
  }

  return article;
}

function renderCurrentTurn() {
  elements.currentCard.innerHTML = '';

  if (!state.currentTurn) {
    elements.currentCard.className = 'turn-card current empty';
    elements.currentTimestamp.textContent = 'Noch kein Beitrag';
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Wartet auf Sprache.';
    elements.currentCard.append(empty);
    return;
  }

  elements.currentCard.className = 'turn-card current';
  elements.currentTimestamp.textContent = formatTime(state.currentTurn.startedAt);
  elements.currentCard.replaceWith(createTurnCard(state.currentTurn, false));
  elements.currentCard = document.querySelector('#currentCard') || document.querySelector('.turn-card.current');
}

function renderHistory() {
  elements.historyList.innerHTML = '';
  elements.historyCount.textContent = `${state.history.length} ${state.history.length === 1 ? 'Beitrag' : 'Beiträge'}`;

  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Noch kein Beitrag.';
    elements.historyList.append(empty);
    return;
  }

  for (const turn of state.history) {
    elements.historyList.append(createTurnCard(turn, true));
  }
}

function updateDiagnostics() {
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    elements.diagnosticsPanel.hidden = false;
  }

  const duration = state.sessionStartedAt ? formatDuration(Date.now() - state.sessionStartedAt) : '00:00';
  elements.diagConnection.textContent = state.connectionStatus;
  elements.diagModel.textContent = state.model;
  elements.diagDuration.textContent = duration;
  elements.diagLanguage.textContent = state.detectedSourceLanguage
    ? LANGUAGE_LABELS[state.detectedSourceLanguage]
    : 'Keine';
  elements.diagAudio.textContent = state.audioInputStatus;
  elements.diagError.textContent = state.lastError;
  elements.diagUsage.textContent =
    `${state.usage.sessionRequests} Session-Anfragen, ` +
    `${state.usage.pttActivations} PTT, ` +
    `${state.usage.interruptions} Unterbrechungen`;
}

function wirePushToTalk(button, language) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    state.pttPressToken += 1;
    void startPushToTalk(language, state.pttPressToken);
  });

  button.addEventListener('pointerup', (event) => {
    event.preventDefault();
    endPushToTalk();
  });

  button.addEventListener('pointercancel', endPushToTalk);
  button.addEventListener('lostpointercapture', endPushToTalk);

  button.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      state.pttPressToken += 1;
      void startPushToTalk(language, state.pttPressToken);
    }
  });

  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      endPushToTalk();
    }
  });
}

elements.autoModeButton.addEventListener('click', () => setMode('auto'));
elements.pttModeButton.addEventListener('click', () => setMode('ptt'));
elements.startButton.addEventListener('click', startInterpreter);
elements.stopButton.addEventListener('click', stopInterpreter);
elements.clearButton.addEventListener('click', clearHistory);
elements.forcePolishButton.addEventListener('click', () => forceLanguage('pl'));
elements.forceGermanButton.addEventListener('click', () => forceLanguage('de'));
wirePushToTalk(elements.polishTalkButton, 'pl');
wirePushToTalk(elements.germanTalkButton, 'de');

window.addEventListener('pagehide', () => {
  closeRealtimeConnection({ stopMicrophone: true });
});

window.setInterval(updateDiagnostics, 1000);

renderCurrentTurn();
renderHistory();
renderStaticState();
setStatus(STATUS.ready, 'ready');
