require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/session', async (req, res) => {
  const { targetLanguage } = req.body;
  if (!targetLanguage || !['de', 'en'].includes(targetLanguage)) {
    return res.status(400).json({ error: 'Invalid targetLanguage' });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/realtime/translations/client_secrets', {
      model: 'gpt-realtime-translate',
      audio: {
        output: {
          language: targetLanguage
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});