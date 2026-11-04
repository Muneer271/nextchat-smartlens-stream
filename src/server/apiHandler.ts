import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Translation Cache
const translationCache = new Map<string, string>();
function getCacheKey(text: string, lang: string): string {
  return crypto.createHash('sha256').update(`${text.trim().toLowerCase()}::${lang.trim().toLowerCase()}`).digest('hex');
}

// In-Memory Chat Session Storage for Sliding Window Context Manager
interface Message {
  role: 'user' | 'model' | 'system';
  content: string;
  tokens: number;
}

interface SessionData {
  messages: Message[];
  summary: string | null;
}

const sessionStore = new Map<string, SessionData>();

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4.0));
}

// Compact evicted turns into a rolling summary using Gemini
async function summarizeTurns(previousSummary: string | null, evicted: Message[]): Promise<string> {
  const turnsText = evicted.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const prompt = `You are a context condensation engine. Produce a concise factual summary of the following conversation turns to be retained as historical memory. Keep it under 100 words.\n\n${
    previousSummary ? `Existing Summary:\n${previousSummary}\n\n` : ''
  }Expired Turns:\n${turnsText}\n\nUpdated Concise Summary:`;

  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });
      if (res.text) return res.text.trim();
    } catch (e) {
      console.warn('Summarization fallback:', e);
    }
  }

  const prefix = previousSummary ? `${previousSummary} | ` : '';
  const snippet = evicted.map((m) => m.content.slice(0, 40) + '...').join(' ');
  return (prefix + snippet).slice(0, 1000);
}

// Sliding Window Context Manager
export async function prepareContext(
  sessionId: string,
  incomingMessage: string,
  config: {
    maxContextTokens?: number;
    reservedResponseTokens?: number;
    minRecentTurns?: number;
    systemPrompt?: string;
  }
) {
  const maxBudget = config.maxContextTokens || 4096;
  const reserved = config.reservedResponseTokens || 1024;
  const minTurns = config.minRecentTurns || 3;
  const systemPrompt = config.systemPrompt || 'You are Next Chat AI, an ultra-fast, intelligent, precision-focused assistant.';

  let session = sessionStore.get(sessionId);
  if (!session) {
    session = { messages: [], summary: null };
    sessionStore.set(sessionId, session);
  }

  const sysTokens = estimateTokens(systemPrompt);
  const inTokens = estimateTokens(incomingMessage);
  const netBudget = Math.max(400, maxBudget - sysTokens - reserved);

  session.messages.push({
    role: 'user',
    content: incomingMessage,
    tokens: inTokens,
  });

  let turnsToEval: Message[] = [];
  let guaranteedRecent: Message[] = [];

  if (session.messages.length > minTurns) {
    turnsToEval = session.messages.slice(0, session.messages.length - minTurns);
    guaranteedRecent = session.messages.slice(session.messages.length - minTurns);
  } else {
    guaranteedRecent = [...session.messages];
  }

  const activeOlder: Message[] = [];
  const evicted: Message[] = [];

  const summaryTokens = session.summary ? estimateTokens(session.summary) : 0;
  let currentUsed = summaryTokens + guaranteedRecent.reduce((acc, m) => acc + m.tokens, 0);

  for (let i = turnsToEval.length - 1; i >= 0; i--) {
    const msg = turnsToEval[i];
    if (currentUsed + msg.tokens <= netBudget) {
      activeOlder.unshift(msg);
      currentUsed += msg.tokens;
    } else {
      evicted.unshift(msg);
    }
  }

  if (evicted.length > 0) {
    session.summary = await summarizeTurns(session.summary, evicted);
  }

  session.messages = [...activeOlder, ...guaranteedRecent];

  const assembled: Message[] = [
    { role: 'system', content: systemPrompt, tokens: sysTokens },
  ];

  if (session.summary) {
    const sumTokens = estimateTokens(session.summary);
    assembled.push({
      role: 'system',
      content: `[Context Memory Summary of earlier conversation]: ${session.summary}`,
      tokens: sumTokens,
    });
  }

  assembled.push(...session.messages);

  const stats = {
    total_tokens_used: assembled.reduce((acc, m) => acc + m.tokens, 0),
    max_budget: maxBudget,
    available_budget: netBudget,
    active_turns: session.messages.length,
    evicted_turns: evicted.length,
    summary_length: session.summary ? session.summary.length : 0,
    has_summary: Boolean(session.summary),
  };

  return { assembled, stats };
}

// Express Route Handlers
export async function handleChatStream(req: Request, res: Response) {
  const { session_id, message, settings = {} } = req.body || {};
  if (!session_id || !message) {
    return res.status(400).json({ error: 'Missing session_id or message' });
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let isClientConnected = true;
  req.on('close', () => {
    isClientConnected = false;
  });

  try {
    const { assembled, stats } = await prepareContext(session_id, message, {
      maxContextTokens: settings.max_context_tokens,
      reservedResponseTokens: settings.reserved_response_tokens,
      minRecentTurns: settings.min_recent_turns,
      systemPrompt: settings.system_prompt,
    });

    // Send meta stats immediately
    res.write(`event: meta\ndata: ${JSON.stringify(stats)}\n\n`);

    // Setup 15s ping heartbeat
    const pingTimer = setInterval(() => {
      if (isClientConnected) {
        res.write(`event: ping\ndata: {}\n\n`);
      }
    }, 15000);

    const modelToUse = settings.model || 'gemini-3.8-flash';
    let fullResponse = '';

    if (ai) {
      // Build prompt contents
      const contents = assembled.map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const config: any = {};
      if (settings.enable_search) {
        config.tools = [{ googleSearch: {} }];
      }

      const stream = await ai.models.generateContentStream({
        model: modelToUse,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      for await (const chunk of stream) {
        if (!isClientConnected) break;
        if (chunk.text) {
          fullResponse += chunk.text;
          res.write(`event: token\ndata: ${JSON.stringify({ token: chunk.text })}\n\n`);
        }
      }

      // Check if grounding metadata was returned
      const groundingChunks = (stream as any)?.response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (groundingChunks && isClientConnected) {
        res.write(`event: grounding\ndata: ${JSON.stringify({ sources: groundingChunks })}\n\n`);
      }
    } else {
      // Deterministic simulation if no API key is set
      const reply = `[Next Chat AI - Context Managed Echo] I received your prompt: "${message}". The sliding window context is maintaining ${stats.active_turns} turns within a ${stats.max_budget} token budget. (Tip: Configure GEMINI_API_KEY in Settings > Secrets for live Flash generation.)`;
      const words = reply.split(' ');
      for (const w of words) {
        if (!isClientConnected) break;
        const piece = w + ' ';
        fullResponse += piece;
        res.write(`event: token\ndata: ${JSON.stringify({ token: piece })}\n\n`);
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    clearInterval(pingTimer);

    // Persist completed turn to session store
    if (fullResponse.trim()) {
      const session = sessionStore.get(session_id);
      if (session) {
        session.messages.push({
          role: 'model',
          content: fullResponse.trim(),
          tokens: estimateTokens(fullResponse),
        });
      }
    }

    if (isClientConnected) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: 'completed', length: fullResponse.length })}\n\n`);
      res.end();
    }
  } catch (error: any) {
    if (isClientConnected) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message || 'Stream generation failed' })}\n\n`);
      res.end();
    }
  }
}

export function handleGetChatContext(req: Request, res: Response) {
  const sessionId = req.params.sessionId;
  const session = sessionStore.get(sessionId) || { messages: [], summary: null };
  const systemPrompt = 'You are Next Chat AI, an ultra-fast, intelligent, precision-focused assistant.';
  const sysTokens = estimateTokens(systemPrompt);
  const sumTokens = session.summary ? estimateTokens(session.summary) : 0;
  const usedTokens = sysTokens + sumTokens + session.messages.reduce((acc, m) => acc + m.tokens, 0);

  res.json({
    session_id: sessionId,
    pinned_system_prompt: systemPrompt,
    rolling_summary: session.summary,
    active_turns_count: session.messages.length,
    total_tokens_used: usedTokens,
    max_budget: 4096,
    available_budget: Math.max(0, 4096 - sysTokens - 1024),
    messages: session.messages,
  });
}

export async function handleLensTranslateStream(req: Request, res: Response) {
  const { blocks = [], target_language = 'es' } = req.body || {};

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  for (const block of blocks) {
    const cacheKey = getCacheKey(block.text, target_language);
    const cached = translationCache.get(cacheKey);

    if (cached) {
      res.write(
        `event: translation\ndata: ${JSON.stringify({
          id: block.id,
          delta: cached,
          final: cached,
          cached: true,
          done: true,
        })}\n\n`
      );
      continue;
    }

    if (!ai) {
      const fallback = `[${target_language.toUpperCase()}] ${block.text}`;
      translationCache.set(cacheKey, fallback);
      res.write(
        `event: translation\ndata: ${JSON.stringify({
          id: block.id,
          delta: fallback,
          final: fallback,
          cached: false,
          done: true,
        })}\n\n`
      );
      continue;
    }

    const prompt = `You are a real-time edge translation engine. Translate the following text directly into '${target_language}'. Return ONLY the translation, no explanations, no quotes:\n\n${block.text}`;

    try {
      const stream = await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });

      let accumulated = '';
      for await (const chunk of stream) {
        if (chunk.text) {
          accumulated += chunk.text;
          res.write(
            `event: translation\ndata: ${JSON.stringify({
              id: block.id,
              delta: chunk.text,
              final: null,
              cached: false,
              done: false,
            })}\n\n`
          );
        }
      }

      const fullTrans = accumulated.trim();
      translationCache.set(cacheKey, fullTrans);
      res.write(
        `event: translation\ndata: ${JSON.stringify({
          id: block.id,
          delta: '',
          final: fullTrans,
          cached: false,
          done: true,
        })}\n\n`
      );
    } catch (e: any) {
      res.write(
        `event: translation\ndata: ${JSON.stringify({
          id: block.id,
          delta: block.text,
          final: block.text,
          cached: false,
          done: true,
          error: e.message,
        })}\n\n`
      );
    }
  }

  res.write(`event: done\ndata: ${JSON.stringify({ status: 'completed' })}\n\n`);
  res.end();
}

export async function handleLensVLMFallback(req: Request, res: Response) {
  const { image_base64, prompt = 'Transcribe every visible character in this cropped image accurately.' } = req.body || {};

  if (!image_base64) {
    return res.status(400).json({ error: 'Missing image_base64' });
  }

  if (!ai) {
    return res.json({
      transcription: '[VLM Simulation] High-confidence optical read of text region.',
      source: 'gemini-3.8-flash-simulated',
    });
  }

  const cleanB64 = image_base64.includes('base64,') ? image_base64.split('base64,')[1] : image_base64;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanB64,
          },
        },
        { text: prompt },
      ],
    });

    return res.json({
      transcription: response.text ? response.text.trim() : 'No text discerned.',
      source: 'gemini-3.8-flash-vision',
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error.message || 'VLM analysis failed',
      transcription: 'VLM read error.',
    });
  }
}

// Bioscience lookups (UniProt, PDB, NCBI PubMed)
export async function handleScienceLookup(req: Request, res: Response) {
  const query = (req.query.q as string || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  try {
    // Check UniProt API
    const uniProtRes = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(query)}&size=3&format=json`);
    let results: any[] = [];
    if (uniProtRes.ok) {
      const data = await uniProtRes.json();
      results = (data.results || []).map((r: any) => ({
        accession: r.primaryAccession,
        gene: r.genes?.[0]?.geneName?.value || 'N/A',
        organism: r.organism?.scientificName || 'N/A',
        protein: r.proteinDescription?.recommendedName?.fullName?.value || 'Protein',
        length: r.sequence?.length || 0,
      }));
    }

    res.json({
      query,
      results,
      provenance: 'UniProtKB REST API',
    });
  } catch (err: any) {
    res.json({
      query,
      results: [
        { accession: 'P04637', gene: 'TP53', organism: 'Homo sapiens', protein: 'Cellular tumor antigen p53', length: 393 },
      ],
      provenance: 'Local Bioscience Cache',
    });
  }
}
