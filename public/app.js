const targetLanguageSelect = document.querySelector('#targetLanguage');
const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const statusElement = document.querySelector('#status');
const translationText = document.querySelector('#translationText');
const remoteAudio = document.querySelector('#remoteAudio');

const TRANSLATION_CALL_URL = 'https://api.openai.com/v1/realtime/translations/calls';

let peerConnection;
let microphoneStream;
let dataChannel;
let translatedText = '';

function setStatus(message) {
  statusElement.textContent = message;
}

function setRunningState(isRunning) {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  targetLanguageSelect.disabled = isRunning;
}

function resetTranscript() {
  translatedText = '';
  translationText.textContent = 'Noch keine Uebersetzung.';
}

function appendTranscript(value) {
  if (!value) return;

  translatedText += value;
  translationText.textContent = translatedText.trim() || 'Noch keine Uebersetzung.';
}

function readClientSecret(sessionPayload) {
  if (typeof sessionPayload?.client_secret === 'string') {
    return sessionPayload.client_secret;
  }

  return sessionPayload?.client_secret?.value || sessionPayload?.value;
}

function handleRealtimeEvent(event) {
  let payload;

  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  const type = payload.type || '';
  const delta = payload.delta || payload.text || payload.transcript;

  if (type.includes('transcript') && delta) {
    appendTranscript(delta);
  }
}

async function createSession(targetLanguage) {
  const response = await fetch('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetLanguage }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Session konnte nicht erstellt werden.');
  }

  const clientSecret = readClientSecret(payload);

  if (!clientSecret) {
    throw new Error('Die Session-Antwort enthaelt keinen Client Secret.');
  }

  return clientSecret;
}

async function startTranslation() {
  try {
    setRunningState(true);
    resetTranscript();
    setStatus('Session wird erstellt...');

    const targetLanguage = targetLanguageSelect.value;
    const clientSecret = await createSession(targetLanguage);

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

    setStatus('Realtime-Verbindung wird aufgebaut...');

    const sdpResponse = await fetch(TRANSLATION_CALL_URL, {
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
    stopTranslation();
    setStatus(error instanceof Error ? error.message : 'Fehler beim Starten.');
  }
}

function stopTranslation() {
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

startButton.addEventListener('click', startTranslation);
stopButton.addEventListener('click', stopTranslation);
