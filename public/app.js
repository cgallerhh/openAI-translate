const myLanguageSelect = document.querySelector('#myLanguage');
const partnerLanguageSelect = document.querySelector('#partnerLanguage');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const clearButton = document.querySelector('#clearButton');
const statusElement = document.querySelector('#status');
const chatThread = document.querySelector('#chatThread');
const remoteAudio = document.querySelector('#remoteAudio');

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/calls';

const LANGUAGE_LABELS = {
  de: 'Deutsch',
  en: 'Englisch',
  pl: 'Polnisch',
};

let peerConnection;
let microphoneStream;
let dataChannel;
let currentInput = '';
let currentOutput = '';
let pendingTurn;
let earlyOutput = '';

function setStatus(message) {
  statusElement.textContent = message;
}

function setRunningState(isRunning) {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  myLanguageSelect.disabled = isRunning;
  partnerLanguageSelect.disabled = isRunning;
}

function clearLiveText() {
  currentInput = '';
  currentOutput = '';
  earlyOutput = '';
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

function detectLanguage(text) {
  const lower = text.toLowerCase();
  const germanHints = [' ich ', ' du ', ' wir ', ' nicht', ' und ', ' der ', ' die ', ' das ', ' geht', ' habe', ' bist', ' ist ', ' schoen', ' schön', ' fuer ', ' für '];
  const polishHints = [' czy ', ' jest', ' nie ', ' się', ' jestem', ' dobrze', ' dzień', ' proszę', ' dzięku', ' cześć', ' jak ', ' masz '];
  const englishHints = [' i ', ' you ', ' we ', ' the ', ' and ', ' not ', ' how ', ' what ', ' have ', ' are ', ' is ', ' hello ', ' thanks ', ' fine '];
  const wrapped = ` ${lower} `;

  const score = (hints) => hints.reduce((sum, hint) => sum + (wrapped.includes(hint) ? 1 : 0), 0);
  const scores = {
    de: score(germanHints),
    pl: score(polishHints),
    en: score(englishHints),
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  return best?.[1] > 0 ? best[0] : undefined;
}

function speakerForText(text) {
  const detected = detectLanguage(text);

  if (detected === myLanguageSelect.value) return 'speaker-one';
  if (detected === partnerLanguageSelect.value) return 'speaker-two';

  return pendingTurn?.sourceSpeaker || 'speaker-one';
}

function oppositeSpeaker(speaker) {
  return speaker === 'speaker-one' ? 'speaker-two' : 'speaker-one';
}

function languageForSpeaker(speaker) {
  return speaker === 'speaker-one' ? myLanguageSelect.value : partnerLanguageSelect.value;
}

function appendMessage(speaker, kind, text) {
  ensureThreadReady();

  const message = document.createElement('article');
  message.className = `chat-message ${speaker}`;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${kind}`;

  const meta = document.createElement('p');
  meta.className = 'chat-meta';
  const speakerLabel = speaker === 'speaker-one' ? 'Sprecher 1' : 'Sprecher 2';
  const kindLabel = kind === 'original' ? 'Original' : 'Uebersetzung';
  meta.textContent = `${speakerLabel} · ${LANGUAGE_LABELS[languageForSpeaker(speaker)]} · ${kindLabel}`;

  const messageText = document.createElement('p');
  messageText.className = 'message-text';
  messageText.textContent = text || 'Uebersetzung laeuft...';

  bubble.append(meta, messageText);
  message.append(bubble);
  chatThread.append(message);
  chatThread.scrollTop = chatThread.scrollHeight;
  return messageText;
}

function finalizeInput(transcript) {
  const text = transcript.trim();
  if (!text) return;

  const sourceSpeaker = speakerForText(text);
  const targetSpeaker = oppositeSpeaker(sourceSpeaker);

  appendMessage(sourceSpeaker, 'original', text);

  const translation = earlyOutput.trim();
  earlyOutput = '';
  currentOutput = translation;

  pendingTurn = {
    sourceSpeaker,
    targetSpeaker,
    translationElement: appendMessage(targetSpeaker, 'translation', translation),
  };
}

function appendOutput(value) {
  if (!value) return;

  currentOutput += value;

  if (!pendingTurn) {
    earlyOutput += value;
    return;
  }

  pendingTurn.translationElement.textContent = currentOutput.trim() || 'Uebersetzung laeuft...';
  chatThread.scrollTop = chatThread.scrollHeight;
}

function finalizeOutput(transcript) {
  const text = (transcript || currentOutput || earlyOutput).trim();

  if (pendingTurn?.translationElement && text) {
    pendingTurn.translationElement.textContent = text;
    pendingTurn = undefined;
  } else if (text) {
    earlyOutput = text;
  }

  currentOutput = '';
  chatThread.scrollTop = chatThread.scrollHeight;
}

function readClientSecret(payload) {
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value || payload?.value;
}

function getTranscript(payload) {
  return payload.delta || payload.transcript || payload.text || '';
}

function handleRealtimeEvent(event) {
  let payload;

  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  const transcript = getTranscript(payload);

  switch (payload.type) {
    case 'conversation.item.input_audio_transcription.delta':
    case 'input_audio_buffer.speech_transcription.delta':
      currentInput += transcript;
      break;
    case 'conversation.item.input_audio_transcription.completed':
    case 'input_audio_buffer.speech_transcription.completed':
      finalizeInput(payload.transcript || currentInput);
      currentInput = '';
      break;
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
    case 'response.output_text.delta':
      appendOutput(transcript);
      break;
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
    case 'response.output_text.done':
      finalizeOutput(payload.transcript || payload.text || currentOutput || earlyOutput);
      break;
    case 'error':
      setStatus(payload.error?.message || 'Realtime-Fehler');
      break;
    default:
      break;
  }
}

async function createInterpreterSession() {
  const response = await fetch('/interpreter-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      myLanguage: myLanguageSelect.value,
      partnerLanguage: partnerLanguageSelect.value,
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

async function startInterpreter() {
  if (myLanguageSelect.value === partnerLanguageSelect.value) {
    setStatus('Bitte zwei unterschiedliche Sprachen waehlen.');
    return;
  }

  try {
    setRunningState(true);
    clearLiveText();
    setStatus('Session wird erstellt...');

    const clientSecret = await createInterpreterSession();

    setStatus('Mikrofonfreigabe anfordern...');
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    peerConnection = new RTCPeerConnection();

    peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      remoteAudio.srcObject = stream;
    };

    peerConnection.onconnectionstatechange = () => {
      setStatus(`Verbindung: ${peerConnection.connectionState}`);
    };

    dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('message', handleRealtimeEvent);

    for (const track of microphoneStream.getAudioTracks()) {
      peerConnection.addTrack(track, microphoneStream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    setStatus('Verbinde...');

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

    setStatus('Live');
  } catch (error) {
    stopInterpreter();
    setStatus(error instanceof Error ? error.message : 'Fehler beim Starten.');
  }
}

function stopInterpreter() {
  dataChannel?.close();
  dataChannel = undefined;

  peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
  peerConnection?.close();
  peerConnection = undefined;

  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = undefined;

  remoteAudio.srcObject = null;
  setRunningState(false);

  if (statusElement.textContent === 'Live' || statusElement.textContent.startsWith('Verbindung:')) {
    setStatus('Bereit');
  }
}

startButton.addEventListener('click', startInterpreter);
stopButton.addEventListener('click', stopInterpreter);
clearButton.addEventListener('click', clearLiveText);

clearLiveText();
