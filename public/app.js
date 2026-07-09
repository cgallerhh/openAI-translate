const myLanguageSelect = document.querySelector('#myLanguage');
const partnerLanguageSelect = document.querySelector('#partnerLanguage');
const partnerToMeButton = document.querySelector('#partnerToMeButton');
const meToPartnerButton = document.querySelector('#meToPartnerButton');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const clearButton = document.querySelector('#clearButton');
const statusElement = document.querySelector('#status');
const chatThread = document.querySelector('#chatThread');
const remoteAudio = document.querySelector('#remoteAudio');

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/translations/calls';

const LANGUAGE_LABELS = {
  de: 'Deutsch',
  en: 'Englisch',
  pl: 'Polnisch',
};

const DIRECTIONS = {
  partnerToMe: {
    sourceSpeaker: 'partner',
    targetSpeaker: 'me',
    sourceLanguage: () => partnerLanguageSelect.value,
    targetLanguage: () => myLanguageSelect.value,
  },
  meToPartner: {
    sourceSpeaker: 'me',
    targetSpeaker: 'partner',
    sourceLanguage: () => myLanguageSelect.value,
    targetLanguage: () => partnerLanguageSelect.value,
  },
};

let activeDirection = 'partnerToMe';
let peerConnection;
let microphoneStream;
let dataChannel;
let connectionSerial = 0;
let isRunning = false;
let isConnecting = false;
let currentInput = '';
let currentOutput = '';
let pendingTurn;

function setStatus(message) {
  statusElement.textContent = message;
}

function directionRoute(direction = activeDirection) {
  const config = DIRECTIONS[direction];
  return {
    direction,
    sourceSpeaker: config.sourceSpeaker,
    targetSpeaker: config.targetSpeaker,
    sourceLanguage: config.sourceLanguage(),
    targetLanguage: config.targetLanguage(),
  };
}

function routeLabel(route = directionRoute()) {
  return `${LANGUAGE_LABELS[route.sourceLanguage]} -> ${LANGUAGE_LABELS[route.targetLanguage]}`;
}

function hasValidLanguages() {
  return myLanguageSelect.value !== partnerLanguageSelect.value;
}

function updateDirectionButtons() {
  const partnerRoute = directionRoute('partnerToMe');
  const meRoute = directionRoute('meToPartner');
  const disableDirections = isConnecting || !hasValidLanguages();

  partnerToMeButton.textContent = routeLabel(partnerRoute);
  meToPartnerButton.textContent = routeLabel(meRoute);

  partnerToMeButton.disabled = disableDirections;
  meToPartnerButton.disabled = disableDirections;
  partnerToMeButton.classList.toggle('active', activeDirection === 'partnerToMe');
  meToPartnerButton.classList.toggle('active', activeDirection === 'meToPartner');
  partnerToMeButton.setAttribute('aria-pressed', String(activeDirection === 'partnerToMe'));
  meToPartnerButton.setAttribute('aria-pressed', String(activeDirection === 'meToPartner'));
}

function setRunningState() {
  const busy = isRunning || isConnecting;
  startButton.disabled = busy || !hasValidLanguages();
  stopButton.disabled = !busy;
  myLanguageSelect.disabled = busy;
  partnerLanguageSelect.disabled = busy;
  updateDirectionButtons();
}

function updateReadyStatus() {
  if (!hasValidLanguages()) {
    setStatus('Sprachen unterscheiden');
    return;
  }

  setStatus(`Bereit: ${routeLabel()}`);
}

function clearLiveText() {
  currentInput = '';
  currentOutput = '';
  pendingTurn = undefined;
  chatThread.innerHTML = '';
  const emptyState = document.createElement('p');
  emptyState.className = 'empty-state';
  emptyState.textContent = 'Noch kein Beitrag.';
  chatThread.append(emptyState);
}

function ensureThreadReady() {
  chatThread.querySelector('.empty-state')?.remove();
}

function speakerClass(speaker) {
  return speaker === 'me' ? 'speaker-two' : 'speaker-one';
}

function speakerLabel(speaker) {
  return speaker === 'me' ? 'Ich' : 'Gegenueber';
}

function appendMessage(speaker, kind, language, text) {
  ensureThreadReady();

  const message = document.createElement('article');
  message.className = `chat-message ${speakerClass(speaker)}`;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${kind}`;

  const meta = document.createElement('p');
  meta.className = 'chat-meta';
  const kindLabel = kind === 'original' ? 'Original' : 'Uebersetzung';
  meta.textContent = `${speakerLabel(speaker)} · ${LANGUAGE_LABELS[language]} · ${kindLabel}`;

  const messageText = document.createElement('p');
  messageText.className = 'message-text';
  messageText.textContent = text || (kind === 'original' ? 'Sprache wird erkannt...' : 'Uebersetzung laeuft...');

  bubble.append(meta, messageText);
  message.append(bubble);
  chatThread.append(message);
  chatThread.scrollTop = chatThread.scrollHeight;
  return messageText;
}

function closePendingTurn() {
  pendingTurn = undefined;
  currentInput = '';
  currentOutput = '';
}

function ensurePendingTurn(route) {
  if (pendingTurn?.direction === route.direction) return pendingTurn;

  pendingTurn = {
    direction: route.direction,
    originalElement: appendMessage(route.sourceSpeaker, 'original', route.sourceLanguage, currentInput.trim()),
    translationElement: appendMessage(route.targetSpeaker, 'translation', route.targetLanguage, currentOutput.trim()),
  };

  return pendingTurn;
}

function appendInput(value, route) {
  if (!value) return;

  if (pendingTurn && !currentInput.trim() && currentOutput.trim()) {
    closePendingTurn();
  }

  currentInput += value;

  const turn = ensurePendingTurn(route);
  turn.originalElement.textContent = currentInput.trim() || 'Sprache wird erkannt...';
  chatThread.scrollTop = chatThread.scrollHeight;
}

function finalizeInput(transcript, route) {
  const text = transcript.trim();
  if (!text) return;

  currentInput = text;
  const turn = ensurePendingTurn(route);
  turn.originalElement.textContent = text;
}

function appendOutput(value, route) {
  if (!value) return;

  currentOutput += value;

  const turn = ensurePendingTurn(route);
  turn.translationElement.textContent = currentOutput.trim() || 'Uebersetzung laeuft...';
  chatThread.scrollTop = chatThread.scrollHeight;
}

function finalizeOutput(transcript) {
  const text = (transcript || currentOutput).trim();

  if (pendingTurn?.translationElement && text) {
    pendingTurn.translationElement.textContent = text;
  }

  closePendingTurn();
  chatThread.scrollTop = chatThread.scrollHeight;
}

function readClientSecret(payload) {
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value || payload?.value;
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

function handleRealtimeEvent(event, route, serial) {
  if (serial !== connectionSerial) return;

  let payload;

  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  const transcript = getTranscript(payload);
  const type = payload.type || '';

  switch (type) {
    case 'conversation.item.input_audio_transcription.delta':
    case 'input_audio_buffer.speech_transcription.delta':
    case 'session.input_transcript.delta':
    case 'session.input_audio_transcription.delta':
    case 'translation.input_transcript.delta':
      appendInput(transcript, route);
      break;
    case 'conversation.item.input_audio_transcription.completed':
    case 'input_audio_buffer.speech_transcription.completed':
    case 'session.input_transcript.done':
    case 'session.input_audio_transcription.done':
    case 'translation.input_transcript.done':
      finalizeInput(payload.transcript || currentInput, route);
      currentInput = '';
      break;
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
    case 'response.output_text.delta':
    case 'session.output_transcript.delta':
    case 'translation.output_transcript.delta':
      appendOutput(transcript, route);
      break;
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
    case 'response.output_text.done':
    case 'session.output_transcript.done':
    case 'translation.output_transcript.done':
      finalizeOutput(payload.transcript || payload.text || currentOutput);
      break;
    case 'error':
      setStatus(payload.error?.message || 'Realtime-Fehler');
      break;
    default:
      if (!transcript) break;

      if (type.includes('input') || type.includes('speech')) {
        appendInput(transcript, route);
      } else {
        appendOutput(transcript, route);
      }
      break;
  }
}

async function createInterpreterSession(route) {
  const response = await fetch('/interpreter-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceLanguage: route.sourceLanguage,
      targetLanguage: route.targetLanguage,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.details || payload.error || 'Session konnte nicht erstellt werden.');
  }

  const clientSecret = readClientSecret(payload);

  if (!clientSecret) {
    throw new Error('Die Session-Antwort enthaelt keinen Client Secret.');
  }

  return clientSecret;
}

async function ensureMicrophoneStream() {
  const hasLiveTrack = microphoneStream?.getAudioTracks().some((track) => track.readyState === 'live');
  if (hasLiveTrack) return microphoneStream;

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  return microphoneStream;
}

function closeRealtimeConnection({ stopMicrophone = false } = {}) {
  connectionSerial += 1;

  dataChannel?.close();
  dataChannel = undefined;

  peerConnection?.close();
  peerConnection = undefined;

  if (stopMicrophone) {
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = undefined;
  }

  remoteAudio.srcObject = null;
  closePendingTurn();
}

async function connectDirection(direction) {
  const route = directionRoute(direction);

  if (route.sourceLanguage === route.targetLanguage) {
    throw new Error('Bitte zwei unterschiedliche Sprachen waehlen.');
  }

  setStatus(`Session: ${routeLabel(route)}`);
  const clientSecret = await createInterpreterSession(route);
  const stream = await ensureMicrophoneStream();
  const serial = connectionSerial + 1;

  peerConnection = new RTCPeerConnection();
  connectionSerial = serial;

  peerConnection.ontrack = (event) => {
    if (serial !== connectionSerial) return;

    const [remoteStream] = event.streams;
    remoteAudio.srcObject = remoteStream;
  };

  peerConnection.onconnectionstatechange = () => {
    if (serial !== connectionSerial || !peerConnection) return;

    const state = peerConnection.connectionState;
    if (state === 'connected') {
      setStatus(`Aktiv: ${routeLabel(route)}`);
    } else if (state === 'failed' || state === 'disconnected') {
      setStatus(`Verbindung: ${state}`);
    }
  };

  dataChannel = peerConnection.createDataChannel('oai-events');
  dataChannel.addEventListener('message', (event) => handleRealtimeEvent(event, route, serial));

  for (const track of stream.getAudioTracks()) {
    peerConnection.addTrack(track, stream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  setStatus(`Verbinde: ${routeLabel(route)}`);

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

  const answerSdp = await sdpResponse.text();
  await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  setStatus(`Aktiv: ${routeLabel(route)}`);
}

async function startInterpreter() {
  if (!hasValidLanguages()) {
    updateReadyStatus();
    return;
  }

  try {
    isConnecting = true;
    setRunningState();
    clearLiveText();
    setStatus('Mikrofonfreigabe anfordern...');

    await ensureMicrophoneStream();
    await connectDirection(activeDirection);

    isRunning = true;
    isConnecting = false;
    setRunningState();
  } catch (error) {
    closeRealtimeConnection({ stopMicrophone: true });
    isRunning = false;
    isConnecting = false;
    setRunningState();
    setStatus(error instanceof Error ? error.message : 'Fehler beim Starten.');
  }
}

async function switchDirection(direction) {
  if (direction === activeDirection && (isRunning || isConnecting)) return;

  activeDirection = direction;
  updateDirectionButtons();

  if (!isRunning && !isConnecting) {
    updateReadyStatus();
    return;
  }

  try {
    isConnecting = true;
    setRunningState();
    closeRealtimeConnection();
    setStatus(`Wechsle: ${routeLabel()}`);

    await connectDirection(activeDirection);

    isRunning = true;
    isConnecting = false;
    setRunningState();
  } catch (error) {
    closeRealtimeConnection({ stopMicrophone: true });
    isRunning = false;
    isConnecting = false;
    setRunningState();
    setStatus(error instanceof Error ? error.message : 'Fehler beim Wechseln.');
  }
}

function stopInterpreter() {
  closeRealtimeConnection({ stopMicrophone: true });
  isRunning = false;
  isConnecting = false;
  setRunningState();
  updateReadyStatus();
}

function handleLanguageChange() {
  updateDirectionButtons();
  updateReadyStatus();
}

partnerToMeButton.addEventListener('click', () => {
  void switchDirection('partnerToMe');
});
meToPartnerButton.addEventListener('click', () => {
  void switchDirection('meToPartner');
});
startButton.addEventListener('click', startInterpreter);
stopButton.addEventListener('click', stopInterpreter);
clearButton.addEventListener('click', clearLiveText);
myLanguageSelect.addEventListener('change', handleLanguageChange);
partnerLanguageSelect.addEventListener('change', handleLanguageChange);

clearLiveText();
setRunningState();
updateReadyStatus();
