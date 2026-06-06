const languageSelect = document.getElementById('languageSelect');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const transcriptDiv = document.getElementById('transcript');

let peerConnection;
let dataChannel;
let localStream;
let remoteAudio = new Audio();

startBtn.addEventListener('click', startTranslation);
stopBtn.addEventListener('click', stopTranslation);

async function startTranslation() {
  const targetLanguage = languageSelect.value;
  statusDiv.textContent = 'Status: Initializing...';

  try {
    // Get session from backend
    const response = await fetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage })
    });
    const session = await response.json();
    if (!response.ok) throw new Error(session.error);

    // Assume session.client_secret is the WebRTC endpoint or token
    // For simplicity, assume it's a WebRTC URL or handle accordingly
    // OpenAI's API might provide a WebRTC URL or SDP

    // This is a placeholder; actual implementation depends on OpenAI's API response
    // Typically, you'd use the client_secret to authenticate WebRTC

    // Get user media
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create PeerConnection
    peerConnection = new RTCPeerConnection();

    // Add local audio track
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Handle remote audio
    peerConnection.ontrack = event => {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play();
    };

    // Data channel for transcripts
    dataChannel = peerConnection.createDataChannel('transcripts');
    dataChannel.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        transcriptDiv.textContent += data.text + ' ';
      }
    };

    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Send offer to OpenAI (this is hypothetical; adjust based on actual API)
    // Assume session provides the endpoint
    const signalingResponse = await fetch(session.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, client_secret: session.client_secret })
    });
    const answer = await signalingResponse.json();

    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer.sdp }));

    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusDiv.textContent = 'Status: Connected';
  } catch (error) {
    console.error(error);
    statusDiv.textContent = 'Status: Error - ' + error.message;
  }
}

function stopTranslation() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  remoteAudio.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusDiv.textContent = 'Status: Stopped';
  transcriptDiv.textContent = '';
}