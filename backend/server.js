require("dotenv").config();
/**
 * ─────────────────────────────────────────────────────────────
 *  Ayonic Support Chatbot — Backend v4.0 (Semantic Search)
 *  AI Brain  : Groq API (llama3-8b)
 *  Search    : Semantic embeddings (all-MiniLM-L6-v2)
 *              + Keyword fallback (Jaccard)
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const faqData = require('./faq_dataset.json');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Serve frontend static files in production ────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// ── Config ────────────────────────────────────────────────────
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const GROQ_MODEL        = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const SEMANTIC_THRESHOLD = 0.35;
const KEYWORD_THRESHOLD  = 0.25;
const TOP_K              = 5;

// ═══════════════════════════════════════════════════════════════
//  SEMANTIC SEARCH — AI Embeddings
// ═══════════════════════════════════════════════════════════════
let embeddingPipeline = null;
let faqEmbeddings     = [];       // pre-computed FAQ embeddings
let semanticReady     = false;

async function initSemanticSearch() {
  try {
    console.log('[SEMANTIC] Loading embedding model (all-MiniLM-L6-v2)...');
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    // Pre-compute embeddings for all FAQ questions + answers
    console.log(`[SEMANTIC] Computing embeddings for ${faqData.length} FAQs...`);
    for (let i = 0; i < faqData.length; i++) {
      const text = `${faqData[i].question} ${faqData[i].answer}`;
      const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
      faqEmbeddings.push(Array.from(output.data));
    }

    semanticReady = true;
    console.log(`[SEMANTIC] ✅ Ready! ${faqEmbeddings.length} FAQ embeddings loaded.`);
  } catch (err) {
    console.error(`[SEMANTIC] ❌ Failed to load: ${err.message}`);
    console.log('[SEMANTIC] Falling back to keyword search only.');
  }
}

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Semantic search using embeddings
async function semanticSearch(userQuestion) {
  if (!semanticReady || !embeddingPipeline) return null;

  try {
    const output = await embeddingPipeline(userQuestion, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(output.data);

    const scored = faqData.map((faq, i) => ({
      faq,
      score: cosineSimilarity(queryEmbedding, faqEmbeddings[i]),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0];
    return {
      match: best.score >= SEMANTIC_THRESHOLD ? best.faq : null,
      score: best.score,
      topK:  scored.slice(0, TOP_K).map(s => s.faq),
      method: 'semantic',
    };
  } catch (err) {
    console.error(`[SEMANTIC] Search error: ${err.message}`);
    return null;
  }
}

// ── Keyword Search (Jaccard fallback) ─────────────────────────
const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','was','our',
  'out','get','has','how','its','may','now','see','who','did','say',
  'too','use','your','that','this','with','have','from','they','will',
  'been','into','more','also','some','than','then','them','what','when',
  'why','does','would','could','should','about','after','before','their',
  'there','were','which','while','where',
]);

function tokens(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(t => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function keywordSearch(userQuestion) {
  const ut = tokens(userQuestion);
  const scored = faqData
    .map(faq => ({
      faq,
      score: jaccard(ut, tokens(faq.question)) * 2 +
             jaccard(ut, tokens(faq.answer)),
    }))
    .sort((a, b) => b.score - a.score);

  const best       = scored[0];
  const normalised = Math.min((best?.score || 0) / 1.5, 1);
  return {
    match: normalised >= KEYWORD_THRESHOLD ? best.faq : null,
    score: normalised,
    topK:  scored.slice(0, TOP_K).map(s => s.faq),
    method: 'keyword',
  };
}

// ── Combined search: semantic first, keyword fallback ─────────
async function combinedSearch(userQuestion) {
  // Try semantic search first
  const semanticResult = await semanticSearch(userQuestion);
  if (semanticResult && semanticResult.match) {
    console.log(`[SEARCH] ✨ Semantic match! score=${semanticResult.score.toFixed(4)}`);
    return semanticResult;
  }

  // Fallback to keyword search
  const keywordResult = keywordSearch(userQuestion);
  console.log(`[SEARCH] 🔑 Keyword match. score=${keywordResult.score.toFixed(4)}`);
  return keywordResult;
}

// ── Build system prompt ───────────────────────────────────────
function buildSystemPrompt(topFaqs) {
  const block = topFaqs
    .map((f, i) => `Q${i + 1}: ${f.question}\nA${i + 1}: ${f.answer}`)
    .join('\n\n');

  return `You are a professional and friendly customer support assistant for Ayonic.
Answer questions ONLY using the FAQ entries provided below.

STRICT RULES:
1. Only use the provided FAQ entries as your knowledge source.
2. If the FAQ entries do not answer the question, respond exactly with:
   "I'm sorry, I can only answer questions about Ayonic's services, policies, orders, and support. Please contact our support team at support@ayonic.com for further help."
3. Never use outside knowledge or make up information.
4. Be concise (2-3 sentences), warm, and professional.
5. Do NOT repeat the user's question back to them.

RELEVANT FAQ ENTRIES:
${block}`;
}

// ── Call Groq API ─────────────────────────────────────────────
async function callGroq(systemPrompt, userMessage, history = []) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not set in environment variables');
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages,
      max_tokens:  500,
      temperature: 0.3,
      top_p:       0.85,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq error ${res.status}: ${err?.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

// ── POST /api/chat ────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const userMessage = message.trim();
  console.log(`\n[QUERY] "${userMessage}"`);

  // STEP 1 — Combined search (semantic + keyword fallback)
  const { match, score, topK, method } = await combinedSearch(userMessage);
  console.log(`[SEARCH] method=${method} score=${score.toFixed(4)} match=${!!match}`);

  // STEP 2 — Reject if below threshold
  if (!match) {
    return res.json({
      reply:  "I'm sorry, I can only answer questions about Ayonic's services, policies, and support. Please contact our support team at support@ayonic.com for further help.",
      source: 'rejected',
      score,
      method,
    });
  }

  // STEP 3 — Call Groq AI
  try {
    const systemPrompt = buildSystemPrompt(topK);
    const reply        = await callGroq(systemPrompt, userMessage, history);
    console.log(`[REPLY] ${reply.substring(0, 100)}`);
    return res.json({ reply: reply.trim(), source: 'groq', score, method });

  } catch (err) {
    console.error(`[GROQ ERROR] ${err.message}`);
    return res.json({
      reply:  match.answer,
      source: 'fallback',
      score,
      method,
    });
  }
});

// ── GET /api/health ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:         'ok',
    faqEntries:     faqData.length,
    model:          GROQ_MODEL,
    aiProvider:     'Groq API',
    groqKey:        GROQ_API_KEY ? '✅ configured' : '❌ missing',
    semanticSearch: semanticReady ? '✅ active' : '⏳ loading...',
  });
});

// ── GET /api/faq ──────────────────────────────────────────────
app.get('/api/faq', (_req, res) => {
  res.json({ count: faqData.length, topics: faqData.map(f => f.question) });
});

// ── Catch-all: serve frontend for any non-API route ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Ayonic Chatbot Backend v4.0 (Semantic Search)`);
  console.log(`    URL        : http://localhost:${PORT}`);
  console.log(`    AI Brain   : Groq API (${GROQ_MODEL})`);
  console.log(`    FAQ entries: ${faqData.length}`);
  console.log(`    Groq Key   : ${GROQ_API_KEY ? '✅ configured' : '❌ MISSING - add to .env'}`);
  console.log(`    Search     : Semantic (loading model in background...)`);
  console.log(`    Health     : http://localhost:${PORT}/api/health\n`);

  // Load semantic model in background (doesn't block server start)
  initSemanticSearch();
});
