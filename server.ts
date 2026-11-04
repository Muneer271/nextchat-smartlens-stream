import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  handleChatStream,
  handleGetChatContext,
  handleLensTranslateStream,
  handleLensVLMFallback,
  handleScienceLookup,
} from './src/server/apiHandler.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '20mb' }));

// API Endpoints
app.post('/api/chat/stream', handleChatStream);
app.get('/api/chat/:sessionId/context', handleGetChatContext);
app.post('/api/lens/translate/stream', handleLensTranslateStream);
app.post('/api/lens/vlm-fallback', handleLensVLMFallback);
app.get('/api/science/lookup', handleScienceLookup);

// Static files in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
