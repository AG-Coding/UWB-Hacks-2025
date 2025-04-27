require('dotenv').config();
console.log('Loaded API Key:', process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-4) : 'MISSING');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ 
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit
  storage: multer.memoryStorage()
});

// Middleware - Note: Only one express.json() is needed
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Verify API Key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('ERROR: Missing OpenAI API key in .env file');
  process.exit(1);
}

// ChatGPT API Helper
async function callChatGPT(messages, temperature = 0.7) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages,
        temperature
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('ChatGPT API Error:', error.response?.data || error.message);
    throw new Error('AI service is currently unavailable');
  }
}

// API Endpoints
app.post('/api/translate', async (req, res) => {
  try {
    console.log('Translation request:', req.body);
    
    const { text, sourceLang, targetLang } = req.body;

    // Validate input
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid text parameter' });
    }
    if (!sourceLang || !targetLang) {
      return res.status(400).json({ error: 'Language parameters missing' });
    }

    const languageMap = {
      'english': 'en',
      'spanish': 'es',
      'french': 'fr',
      'german': 'de',
      'italian': 'it',
      'portuguese': 'pt',
      'russian': 'ru',
      'chinese': 'zh',
      'japanese': 'ja',
      'hindi': 'hi',
      'arabic': 'ar',
      'vietnamese': 'vi'
    };

    const normalizedSource = languageMap[sourceLang.toLowerCase()] || sourceLang;
    const normalizedTarget = languageMap[targetLang.toLowerCase()] || targetLang;

    const messages = [
      {
        role: "system",
        content: `You are a medical translation assistant. Translate exactly from ${normalizedSource} to ${normalizedTarget} maintaining all medical terms.`
      },
      {
        role: "user",
        content: text
      }
    ];

    const translation = await callChatGPT(messages, 0.7);
    res.json({ translation, sourceLang: normalizedSource, targetLang: normalizedTarget });

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ 
      error: 'Translation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/explain', async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    
    const prompt = `Explain this medical information in simple ${targetLang} (2-3 sentences):\n\n"${text}"`;
    
    const explanation = await callChatGPT([
      {
        role: "system",
        content: "Explain medical concepts simply for patients."
      },
      {
        role: "user",
        content: prompt
      }
    ]);
    
    res.json({ explanation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/questions', async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    
    const prompt = `Generate 3 follow-up questions in ${targetLang} about this medical info (format with bullets):\n\n"${text}"`;
    
    const response = await callChatGPT([
      {
        role: "system",
        content: "Generate relevant patient follow-up questions."
      },
      {
        role: "user",
        content: prompt
      }
    ]);
    
    const questions = response.split('\n')
      .filter(q => q.trim())
      .map(q => q.replace(/^[•\-\*]\s*/, '').trim());
    
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this endpoint for image analysis
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const targetLang = req.body.targetLang || 'english';
    const base64Image = req.file.buffer.toString('base64');

    // First get the raw analysis in English
    const analysisResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this medical image thoroughly. Describe any visible text, diagrams, charts, or notable features with medical precision. Provide a complete description that could help a doctor understand the image contents."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${req.file.mimetype};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 2000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        timeout: 60000
      }
    );

    const englishAnalysis = analysisResponse.data.choices[0].message.content;

    // Then translate to the target language
    const translatedResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a medical translator. Translate this medical image analysis into ${targetLang} while maintaining all medical accuracy. Use simple terms the patient can understand.`
          },
          {
            role: "user",
            content: englishAnalysis
          }
        ],
        max_tokens: 2000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        timeout: 60000
      }
    );

    res.json({
      originalAnalysis: englishAnalysis,
      translatedAnalysis: translatedResponse.data.choices[0].message.content,
      imageUrl: `data:${req.file.mimetype};base64,${base64Image}`
    });

  } catch (error) {
    console.error('Image analysis error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Add this new endpoint to your server code
app.post('/api/generate-recommendations', async (req, res) => {
  try {
    const { doctorMessage, targetLanguage } = req.body;

    // First generate the simplified explanation
    const explanationPrompt = `Explain this doctor's message in simple ${targetLanguage} that a patient can understand (2-3 sentences max):\n\n"${doctorMessage}"`;
    
    const explanationResponse = await callChatGPT([
      {
        role: "system",
        content: "You are a medical assistant that explains complex medical information in simple terms for patients."
      },
      {
        role: "user",
        content: explanationPrompt
      }
    ]);

    // Then generate follow-up questions
    const questionsPrompt = `Generate 4 follow-up questions in ${targetLanguage} that a patient might ask about this medical information (format as a bullet list):\n\n"${doctorMessage}"`;
    
    const questionsResponse = await callChatGPT([
      {
        role: "system",
        content: "Generate relevant, helpful follow-up questions a patient might ask their doctor."
      },
      {
        role: "user",
        content: questionsPrompt
      }
    ]);

    // Process the questions response into an array
    const questions = questionsResponse.split('\n')
      .filter(q => q.trim().length > 0)
      .map(q => q.replace(/^[•\-\*]\s*/, '').trim())
      .filter(q => q.length > 0);

    res.json({
      simplifiedExplanation: explanationResponse,
      followUpQuestions: questions.slice(0, 4) // Ensure max 4 questions
    });

  } catch (error) {
    console.error('Recommendation generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate recommendations',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});