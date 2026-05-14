const myLanguageSelect = document.querySelector('#myLanguage');
const partnerLanguageSelect = document.querySelector('#partnerLanguage');
const speakMineButton = document.querySelector('#speakMineButton');
const speakPartnerButton = document.querySelector('#speakPartnerButton');
const stopButton = document.querySelector('#stopButton');
const clearButton = document.querySelector('#clearButton');
const statusElement = document.querySelector('#status');
const dialogueLog = document.querySelector('#dialogueLog');
const remoteAudio = document.querySelector('#remoteAudio');

const LANGUAGE_LABELS = {
  de: 'Deutsch',
  en: 'Englisch',
  pl: 'Polnisch',
};

let microphoneStream;
let mediaRecorder;
let recordedChunks = [];
let activeDirection;
let dialogueTurns = [];

function setStatus(message) {
  statusElement.textContent = message;
}

function setRecordingState(isRecording) {
  speakMineButton.disabled = isRecording;
  speakPartnerButton.disabled = isRecording;
  stopButton.disabled = !isRecording;
  myLanguageSelect.disabled = isRecording;
  partnerLanguageSelect.disabled = isRecording;
}

function getRecordingMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function renderDialogue() {
  dialogueLog.innerHTML = '';

  if (!dialogueTurns.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Noch kein Dialog.';
    dialogueLog.append(emptyState);
    return;
  }

  for (const turn of dialogueTurns) {
    const article = document.createElement('article');
    article.className = `dialogue-turn ${turn.pending ? 'is-pending' : ''}`;

    const meta = document.createElement('p');
    meta.className = 'turn-meta';
    meta.textContent = `${turn.speaker} · ${LANGUAGE_LABELS[turn.sourceLanguage]} -> ${LANGUAGE_LABELS[turn.targetLanguage]}`;

    const originalLabel = document.createElement('h3');
    originalLabel.textContent = 'Original';

    const originalText = document.createElement('p');
    originalText.className = 'turn-text';
    originalText.textContent = turn.original || 'Wird erkannt...';

    const translationLabel = document.createElement('h3');
    translationLabel.textContent = 'Uebersetzung';

    const translationText = document.createElement('p');
    translationText.className = 'turn-text translated';
    translationText.textContent = turn.translation || 'Wird uebersetzt...';

    article.append(meta, originalLabel, originalText, translationLabel, translationText);
    dialogueLog.prepend(article);
  }
}

function appendPendingTurn(direction) {
  const myLanguage = myLanguageSelect.value;
  const partnerLanguage = partnerLanguageSelect.value;
  const isMine = direction === 'mine';
  const turn = {
    id: crypto.randomUUID(),
    speaker: isMine ? 'Ich' : 'Partner',
    sourceLanguage: isMine ? myLanguage : partnerLanguage,
    targetLanguage: isMine ? partnerLanguage : myLanguage,
    original: '',
    translation: '',
    pending: true,
  };

  dialogueTurns.push(turn);
  renderDialogue();
  return turn;
}

async function ensureMicrophone() {
  if (microphoneStream) return microphoneStream;

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  return microphoneStream;
}

async function startRecording(direction) {
  if (myLanguageSelect.value === partnerLanguageSelect.value) {
    setStatus('Bitte zwei unterschiedliche Sprachen waehlen.');
    return;
  }

  try {
    const stream = await ensureMicrophone();
    const mimeType = getRecordingMimeType();
    recordedChunks = [];
    activeDirection = direction;
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', handleRecordingStopped, { once: true });
    mediaRecorder.start();
    setRecordingState(true);
    setStatus(direction === 'mine' ? 'Ich nehme dich auf...' : 'Ich nehme den Partner auf...');
  } catch (error) {
    setRecordingState(false);
    setStatus(error instanceof Error ? error.message : 'Mikrofon konnte nicht gestartet werden.');
  }
}

async function handleRecordingStopped() {
  const turn = appendPendingTurn(activeDirection);
  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  const audioBlob = new Blob(recordedChunks, { type: mimeType });
  mediaRecorder = undefined;
  activeDirection = undefined;
  recordedChunks = [];
  setStatus('Uebersetze...');

  try {
    const params = new URLSearchParams({
      sourceLanguage: turn.sourceLanguage,
      targetLanguage: turn.targetLanguage,
    });

    const response = await fetch(`/turn?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
      body: audioBlob,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.details || payload.error || 'Uebersetzung fehlgeschlagen.');
    }

    turn.original = payload.original;
    turn.translation = payload.translation;
    turn.pending = false;
    renderDialogue();

    remoteAudio.src = `data:${payload.audio.mimeType};base64,${payload.audio.base64}`;
    await remoteAudio.play().catch(() => undefined);
    setStatus('Bereit');
  } catch (error) {
    turn.translation = error instanceof Error ? error.message : 'Uebersetzung fehlgeschlagen.';
    turn.pending = false;
    renderDialogue();
    setStatus('Fehler');
  }
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    setRecordingState(false);
  }
}

function clearDialogue() {
  dialogueTurns = [];
  renderDialogue();
  setStatus('Bereit');
}

speakMineButton.addEventListener('click', () => startRecording('mine'));
speakPartnerButton.addEventListener('click', () => startRecording('partner'));
stopButton.addEventListener('click', stopRecording);
clearButton.addEventListener('click', clearDialogue);
