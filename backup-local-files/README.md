# OpenAI Realtime Translation Web App

A minimal web application for real-time audio translation using OpenAI's Realtime Translation API with the `gpt-realtime-translate` model.

## Features

- Real-time audio translation between German and English
- WebRTC-based audio streaming
- Live transcript display
- Simple web interface

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and add your OpenAI API key
4. Start the server: `npm start`
5. Open `http://localhost:3000` in your browser

## Usage

- Select target language (German or English)
- Click "Start" to begin translation
- Speak into your microphone
- Listen to translated audio and view live transcripts
- Click "Stop" to end the session

## Stack

- Backend: Node.js, Express
- Frontend: Vanilla HTML/CSS/JavaScript
- API: OpenAI Realtime Translation API