const myLanguageSelect = document.querySelector('#myLanguage');
const partnerLanguageSelect = document.querySelector('#partnerLanguage');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const clearButton = document.querySelector('#clearButton');
const statusElement = document.querySelector('#status');
const mineColumnTitle = document.querySelector('#mineColumnTitle');
const partnerColumnTitle = document.querySelector('#partnerColumnTitle');
const mineFeed = document.querySelector('#mineFeed');
const partnerFeed = document.querySelector('#partnerFeed');
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
let pendingInput;

function setStatus(message) {
  statusElement.textContent = message;
}

function setRunningState(isRunning) {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  myLanguageSelect.disabled = isRunning;
  partnerLanguageSelect.disabled = isRunning;
}

function updateColumnTitles() {
  mineColumnTitle.textContent = `Fuer mich (${LANGUAGE_LABELS[myLanguageSelect.value]})`;
  partnerColumnTitle.textContent = `Fuer Partner (${LANGUAGE_LABELS[partnerLanguageSelect.value]})`;
}

function clearElement(element) {
  element.innerHTML = '';
  const emptyState = document.createElement('p');
  emptyState.className = 'empty-state';
  emptyState.textContent = 'Noch kein Beitrag.';
  element.append(emptyState);
}

function clearLiveText() {
  currentInput = '';
  currentOutput = '';
  pendingInput = undefined;
  clearElement(mineFeed);
  clearElement(partnerFeed);
}

function ensureFeedReady(feed) {
  const emptyState = feed.querySelector('.empty-state');
  emptyState?.remove();
}

function detectLanguage(text) {
  const lower = text.toLowerCase();
  const germanHints = [' ich ', ' du ', ' wir ', ' nicht', ' und ', ' der ', ' die ', ' das ', ' geht', ' habe', ' bist', ' ist ', ' schön', ' fuer ', ' für '];
  const polishHints = [' czy ', ' jest', ' nie ', ' się', ' jestem', ' dobrze', ' dzień', ' proszę', ' dzięku', ' cześć', ' jak ', ' masz '];
  const englishHints = [' i ', ' you ', ' we ', ' the ', ' and ', ' not ', ' how ', ' what ', ' have ', ' are ', ' is ', ' hello ', ' thanks '];
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

function targetFeedForInput(text) {
  const detected = detectLanguage(text);

  if (detected === myLanguageSelect.value) return partnerFeed;
  if (detected === partnerLanguageSelect.value) return mineFeed;

  return pendingInput?.feed === partnerFeed ? partnerFeed : mineFeed;
}

function appendTurn(feed, original, translation) {
  ensureFeedReady(feed);

  const turn = document.createElement('article');
  turn.className = 'audience-turn';

  const originalLabel = document.createElement('h4');
  originalLabel.textContent = 'Original';

  const originalText = document.createElement('p');
  originalText.className = 'audience-original';
  originalText.textContent = original;

  const translationLabel = document.createElement('h4');
  translationLabel.textContent = 'Uebersetzung';

  const translationText = document.createElement('p');
  translationText.className = 'audience-translation';
  translationText.textContent = translation || 'Uebersetzung laeuft...';

  turn.append(originalLabel, originalText, translationLabel, translationText);
  feed.prepend(turn);
  return translationText;
}

function finalizeInput(transcript) {
  const text = transcript.trim();
  if (!text) return;

  const feed = targetFeedForInput(text);
  pendingInput = {
    feed,
    original: text,
    translationElement: appendTurn(feed, text, ''),
  };
}

function appendOutput(value) {
  if (!value) return;

  currentOutput += value;

  if (!pendingInput) {
    pendingInput = {
      feed: mineFeed,
      original: '',
      translationElement: appendTurn(mineFeed, 'Nicht zugeordnet', ''),
    };
  }

  pendingInput.translationElement.textContent = currentOutput.trim() || 'Uebersetzung laeuft...';
}

function finalizeOutput(transcript) {
  const text = (transcript || currentOutput).trim();

  if (pendingInput?.translationElement && text) {
    pendingInput.translationElement.textContent = text;
  }

  currentOutput = '';
  pendingInput = undefined;
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
      finalizeOutput(payload.transcript || payload.text || currentOutput);
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

myLanguageSelect.addEventListener('change', updateColumnTitles);
partnerLanguageSelect.addEventListener('change', updateColumnTitles);
startButton.addEventListener('click', startInterpreter);
stopButton.addEventListener('click', stopInterpreter);
clearButton.addEventListener('click', clearLiveText);

updateColumnTitles();
