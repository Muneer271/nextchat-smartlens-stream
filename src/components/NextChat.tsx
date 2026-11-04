import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Square,
  Cpu,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Sparkles,
  Zap,
  ExternalLink,
  Save,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Message, ContextMeta } from '../types';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export const NextChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [meta, setMeta] = useState<ContextMeta | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [sessionId] = useState(() => 'sess_' + Math.random().toString(36).substring(2, 9));
  const [summary, setSummary] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Settings
  const [selectedModel, setSelectedModel] = useState<'gemini-3.8-flash' | 'gemini-3.1-flash-lite'>('gemini-3.8-flash');
  const [searchGrounding, setSearchGrounding] = useState(false);
  const [groundingSources, setGroundingSources] = useState<{ [msgId: string]: any[] }>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef<boolean>(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 40;
    userScrolledUpRef.current = !isAtBottom;
  };

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const fetchContext = async () => {
    try {
      const res = await fetch(`/api/chat/${sessionId}/context`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.rolling_summary);
      }
    } catch (_) {}
  };

  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if (!prompt || isStreaming) return;

    setInput('');
    const userMsgId = 'msg_' + Date.now();
    const assistantMsgId = 'msg_' + (Date.now() + 1);

    const newUserMsg: Message = { id: userMsgId, role: 'user', content: prompt, timestamp: Date.now() };
    const newAssistantMsg: Message = { id: assistantMsgId, role: 'model', content: '', timestamp: Date.now() };

    setMessages((prev) => [...prev, newUserMsg, newAssistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message: prompt,
          settings: {
            max_context_tokens: 4096,
            reserved_response_tokens: 1024,
            min_recent_turns: 3,
            model: selectedModel,
            enable_search: searchGrounding,
          },
        }),
        signal: controller.signal,
      });

      if (!response.body) throw new Error('ReadableStream not supported.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.replace('event: ', '').trim();
          } else if (line.startsWith('data: ')) {
            const rawData = line.replace('data: ', '').trim();
            if (!rawData) continue;

            if (currentEvent === 'token') {
              const parsed = JSON.parse(rawData);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + parsed.token } : m))
              );
            } else if (currentEvent === 'meta') {
              const metaData = JSON.parse(rawData);
              setMeta(metaData);
            } else if (currentEvent === 'grounding') {
              const parsed = JSON.parse(rawData);
              setGroundingSources((prev) => ({
                ...prev,
                [assistantMsgId]: parsed.sources || [],
              }));
            } else if (currentEvent === 'done') {
              fetchContext();
              // Sync session to Firestore if user logged in
              if (auth.currentUser) {
                syncSessionToFirestore();
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + `\n\n*[Stream Error: ${err.message}]*` } : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const syncSessionToFirestore = async () => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid, 'chat_sessions', sessionId);
      await setDoc(
        userRef,
        {
          id: sessionId,
          userId: auth.currentUser.uid,
          title: messages[0]?.content.slice(0, 40) || 'Chat Session',
          model: selectedModel,
          rollingSummary: summary || '',
          totalTokensUsed: meta?.total_tokens_used || 0,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Firestore session sync error:', e);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-4xl mx-auto p-2 sm:p-4 bg-slate-950 text-slate-100">
      {/* Sliding Window Context Memory Dashboard */}
      <div className="mb-2 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-md">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowMemory(!showMemory)}>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Context Memory:{' '}
              {meta ? (
                <span className="font-mono text-cyan-300">
                  {meta.total_tokens_used} / {meta.max_budget} tokens ({Math.round((meta.total_tokens_used / meta.max_budget) * 100)}%)
                </span>
              ) : (
                '4096 Token Budget Active'
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {meta?.has_summary && (
              <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-medium">
                Rolling Summary Active
              </span>
            )}
            <button className="text-slate-400 hover:text-white p-1" aria-label="Toggle Memory Details">
              {showMemory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {meta && (
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                meta.total_tokens_used / meta.max_budget > 0.85 ? 'bg-amber-400' : 'bg-gradient-to-r from-cyan-500 to-blue-500'
              }`}
              style={{ width: `${Math.min(100, (meta.total_tokens_used / meta.max_budget) * 100)}%` }}
            />
          </div>
        )}

        {showMemory && (
          <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-1.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Active Turns</span>
                <span className="text-white font-mono font-bold">{meta?.active_turns ?? messages.length}</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Evicted & Folded</span>
                <span className="text-amber-400 font-mono font-bold">{meta?.evicted_turns ?? 0}</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Available Budget</span>
                <span className="text-cyan-400 font-mono font-bold">{meta?.available_budget ?? 3072} tok</span>
              </div>
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                <span className="text-slate-500 block">Pinned Prompt</span>
                <span className="text-emerald-400 font-mono font-bold">Protected</span>
              </div>
            </div>

            {summary && (
              <div className="mt-2.5 p-3 bg-slate-950/90 rounded-xl border border-amber-900/40 text-xs">
                <span className="text-amber-400 font-semibold block mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Compounded Rolling Memory:
                </span>
                <p className="italic text-slate-300 leading-relaxed">{summary}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Message List Viewport */}
      <div
        className="flex-1 overflow-y-auto pr-1 space-y-4 mb-2"
        onScroll={handleScroll}
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm font-semibold text-slate-300">Generative Vision-Language Chat</p>
              <p className="text-xs text-slate-500 mt-1">
                Sliding-window context memory protects your token budget while retaining history.
              </p>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`relative group max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-cyan-600 text-white rounded-br-none shadow'
                  : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-bl-none shadow-md'
              }`}
            >
              <div className="prose prose-invert prose-sm break-words max-w-none">
                <ReactMarkdown>
                  {m.content || (isStreaming ? '▍' : '')}
                </ReactMarkdown>
              </div>

              {/* Grounding Source Citations if present */}
              {groundingSources[m.id] && groundingSources[m.id].length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-800 text-xs">
                  <span className="text-cyan-400 font-semibold block mb-1 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Google Search Sources:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {groundingSources[m.id].map((src: any, sIdx: number) => (
                      <a
                        key={sIdx}
                        href={src.web?.uri || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 bg-slate-800/90 hover:bg-slate-700 text-slate-300 text-[11px] px-2 py-0.5 rounded border border-slate-700"
                      >
                        {src.web?.title || 'Web Result'}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => copyToClipboard(m.content, m.id)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-slate-800/90 rounded hover:bg-slate-700 text-slate-300 transition-opacity"
                title="Copy"
              >
                {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 px-1">
              {m.role === 'user' ? 'You' : `Next Chat (${selectedModel})`}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Model & Search Grounding Controls Bar */}
      <div className="flex items-center justify-between gap-2 px-1 mb-2 text-xs">
        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setSelectedModel('gemini-3.8-flash')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                selectedModel === 'gemini-3.8-flash' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Gemini 3.8 Flash
            </button>
            <button
              onClick={() => setSelectedModel('gemini-3.1-flash-lite')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                selectedModel === 'gemini-3.1-flash-lite' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> Flash-Lite
            </button>
          </div>

          {/* Search Grounding Toggle */}
          <button
            onClick={() => setSearchGrounding(!searchGrounding)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
              searchGrounding
                ? 'bg-blue-950/70 border-blue-500 text-blue-300 font-semibold'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="Ground answer with live Google Search"
          >
            <Globe className="w-3.5 h-3.5" /> Search Grounding: {searchGrounding ? 'ON' : 'OFF'}
          </button>
        </div>

        {auth.currentUser && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Save className="w-3 h-3 text-emerald-400" /> Firestore Synced
          </span>
        )}
      </div>

      {/* Input Tray */}
      <div className="relative flex items-center gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder="Ask Next Chat AI with sliding-window context memory..."
          rows={1}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none shadow-inner"
        />

        {isStreaming ? (
          <button
            onClick={stopGeneration}
            className="p-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl transition-colors shadow-lg"
            title="Stop Stream"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>
        ) : (
          <button
            onClick={() => handleSendMessage()}
            disabled={!input.trim()}
            className="p-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-2xl transition-colors shadow-lg"
            title="Send"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
