const myLanguageSelect = document.querySelector('#myLanguage');
const partnerLanguageSelect = document.querySelector('#partnerLanguage');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const clearButton = document.querySelector('#clearButton');
const statusElement = document.querySelector('#status');
const sourceTextElement = document.querySelector('#sourceText');
const translationTextElement = document.querySelector('#translationText');
const remoteAudio = document.querySelector('#remoteAudio');

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/calls';

let peerConnection;
let microphoneStream;
let dataChannel;
let sourceText = '';
let translationText = '';
const completedInputs = new Set();
const completedOutputs = new Set();

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
  sourceText = '';
  translationText = '';
  completedInputs.clear();
  completedOutputs.clear();
  sourceTextElement.textContent = 'Noch nichts erkannt.';
  translationTextElement.textContent = 'Noch keine Uebersetzung.';
}

function appendSource(value) {
  if (!value) return;
  sourceText += value;
  sourceTextElement.textContent = sourceText.trim() || 'Noch nichts erkannt.';
}

function appendTranslation(value) {
  if (!value) return;
  translationText += value;
  translationTextElement.textContent = translationText.trim() || 'Noch keine Uebersetzung.';
}

function appendLine(target, value) {
  if (!value) return;
  target(value.endsWith('\n') ? value : `${value}\n`);
}

function readClientSecret(payload) {
  if (typeof payload?.client_secret === 'string') return payload.client_secret;
  return payload?.client_secret?.value || payload?.value;
}

function getTranscript(payload) {
  return payload.delta || payload.transcript || payload.text || '';
}

function eventKey(payload) {
  return payload.item_id || payload.response_id || payload.output_index || crypto.randomUUID();
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
      appendSource(transcript);
      break;
    case 'conversation.item.input_audio_transcription.completed':
    case 'input_audio_buffer.speech_transcription.completed': {
      const key = eventKey(payload);
      if (payload.transcript && !completedInputs.has(key)) {
        appendLine(appendSource, payload.transcript);
        completedInputs.add(key);
      } else {
        appendSource('\n');
      }
      break;
    }
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
    case 'response.output_text.delta':
      appendTranslation(transcript);
      break;
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
    case 'response.output_text.done': {
      const key = eventKey(payload);
      if (payload.transcript && !completedOutputs.has(key)) {
        appendLine(appendTranslation, payload.transcript);
        completedOutputs.add(key);
      } else if (payload.text && !completedOutputs.has(key)) {
        appendLine(appendTranslation, payload.text);
        completedOutputs.add(key);
      } else {
        appendTranslation('\n');
      }
      break;
    }
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
