require("dotenv").config();
/**
 * ─────────────────────────────────────────────────────────────
 *  Ayonic Support Chatbot — Backend v5.0 (Self-Learning)
 *  AI Brain  : Groq API (llama3-8b)
 *  Search    : Semantic embeddings (all-MiniLM-L6-v2)
 *              + Keyword fallback (Jaccard)
 *  Learning  : Saves unanswered questions for admin review
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const faqData = require('./faq_dataset.json');

const app  = express();
const PORT = process.env.PORT || 3001;
const ADMIN_KEY = process.env.ADMIN_KEY || 'ayonic-admin-2026';
const UNANSWERED_FILE = path.join(__dirname, 'unanswered.json');
const FAQ_FILE = path.join(__dirname, 'faq_dataset.json');

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
//  UNANSWERED QUESTIONS — Self-Learning System
// ═══════════════════════════════════════════════════════════════
let unansweredQuestions = [];

function loadUnanswered() {
  try {
    if (fs.existsSync(UNANSWERED_FILE)) {
      unansweredQuestions = JSON.parse(fs.readFileSync(UNANSWERED_FILE, 'utf8'));
      console.log(`[LEARN] Loaded ${unansweredQuestions.length} unanswered questions.`);
    }
  } catch (_) { unansweredQuestions = []; }
}

function saveUnanswered() {
  try {
    fs.writeFileSync(UNANSWERED_FILE, JSON.stringify(unansweredQuestions, null, 2));
  } catch (err) { console.error(`[LEARN] Save error: ${err.message}`); }
}

function addUnanswered(question, username) {
  // Don't save duplicates
  const exists = unansweredQuestions.some(u => u.question.toLowerCase() === question.toLowerCase());
  if (exists) {
    // Just increment the count
    const item = unansweredQuestions.find(u => u.question.toLowerCase() === question.toLowerCase());
    item.count = (item.count || 1) + 1;
    item.lastAsked = new Date().toISOString();
    saveUnanswered();
    return;
  }
  unansweredQuestions.push({
    id: Date.now().toString(36),
    question,
    username: username || 'anonymous',
    count: 1,
    timestamp: new Date().toISOString(),
    lastAsked: new Date().toISOString(),
    status: 'pending',  // pending | approved | dismissed
  });
  saveUnanswered();
  console.log(`[LEARN] 📝 Saved unanswered: "${question}"`);
}

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
//  PERSONAL QUERY DETECTION — Payment/Booking Status
// ═══════════════════════════════════════════════════════════════

const PERSONAL_KEYWORDS = {
  payment_status: {
    patterns: ['my payment', 'payment status', 'my refund status', 'where is my refund', 'my money', 'did i pay', 'have i paid', 'my transaction',
               'meine zahlung', 'zahlungsstatus', 'meine rückerstattung', 'mein geld'],
    needsId: true,
    askMessage: "I'd love to help check your payment status! 💳\n\nPlease provide your **Booking ID** (e.g., AY-12345) so I can look it up for you.",
    askMessageDe: "Ich helfe Ihnen gerne, Ihren Zahlungsstatus zu prüfen! 💳\n\nBitte geben Sie Ihre **Buchungs-ID** an (z.B. AY-12345), damit ich nachschauen kann.",
  },
  booking_status: {
    patterns: ['my booking', 'booking status', 'my appointment', 'when is my service', 'my order status', 'where is my provider', 'is my booking confirmed',
               'meine buchung', 'buchungsstatus', 'mein termin', 'wann kommt mein anbieter'],
    needsId: true,
    askMessage: "I'd be happy to check your booking! 📋\n\nPlease share your **Booking ID** (e.g., AY-12345) and I'll find it for you.",
    askMessageDe: "Ich prüfe gerne Ihre Buchung! 📋\n\nBitte teilen Sie Ihre **Buchungs-ID** (z.B. AY-12345) mit, damit ich sie finden kann.",
  },
  account_info: {
    patterns: ['my account', 'my profile', 'my email', 'my phone number', 'change my password', 'delete my account',
               'mein konto', 'mein profil', 'meine e-mail', 'konto löschen'],
    needsId: false,
    askMessage: "For account-related changes, please:\n\n1. Open the Ayonic app\n2. Go to **Profile → Settings**\n3. Update your information there\n\nFor account deletion, contact us at support@ayonic.com",
    askMessageDe: "Für Kontoänderungen bitte:\n\n1. Öffnen Sie die Ayonic App\n2. Gehen Sie zu **Profil → Einstellungen**\n3. Aktualisieren Sie Ihre Daten dort\n\nZum Löschen des Kontos kontaktieren Sie support@ayonic.com",
  },
};

// Track users who provided a booking ID
const pendingLookups = {};

function detectPersonalQuery(message) {
  const lower = message.toLowerCase();
  for (const [type, config] of Object.entries(PERSONAL_KEYWORDS)) {
    if (config.patterns.some(p => lower.includes(p))) {
      return { type, ...config };
    }
  }
  return null;
}

function extractBookingId(message) {
  // Match patterns like AY-12345, AY12345, #12345, or just 5+ digit numbers
  const patterns = [
    /AY-?\d{3,}/i,
    /#?\d{5,}/,
  ];
  for (const p of patterns) {
    const match = message.match(p);
    if (match) return match[0].toUpperCase();
  }
  return null;
}

// ── Future: Replace this with real database lookup ────────────
async function lookupPersonalData(type, bookingId, username) {
  /*
   * TODO: Connect to Ayonic MySQL database
   *
   * Example future implementation:
   * const db = await mysql.createConnection(DB_CONFIG);
   * const [rows] = await db.execute(
   *   'SELECT * FROM bookings WHERE booking_id = ? AND user_name = ?',
   *   [bookingId, username]
   * );
   * return rows[0] || null;
   */

  // For now — return a "checking" response
  return null; // null = database not connected yet
}

async function handlePersonalQuery(type, bookingId, username) {
  const data = await lookupPersonalData(type, bookingId, username);

  if (data === null) {
    // Database not connected yet — inform user
    return `I found your Booking ID: **${bookingId}** ✅\n\nOur system is being upgraded to show real-time status. For now, please check your booking status in the **Ayonic app → My Bookings**, or contact support@ayonic.com with your Booking ID for immediate help. 🙏`;
  }

  // Future: format real data from database
  return `Here's your ${type === 'payment_status' ? 'payment' : 'booking'} info for **${bookingId}**:\n${JSON.stringify(data)}`;
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
  const username = req.body.username || 'User';
  const language = req.body.language || 'en';
  console.log(`\n[QUERY] "${userMessage}"`);

  // STEP 0 — Check for personal queries (payment status, booking status, etc.)
  const bookingId = extractBookingId(userMessage);
  if (bookingId && pendingLookups[username]) {
    // User provided a Booking ID after being asked
    const pType = pendingLookups[username];
    delete pendingLookups[username];
    const reply = await handlePersonalQuery(pType, bookingId, username);
    console.log(`[PERSONAL] Lookup ${pType} for ${bookingId}`);
    return res.json({ reply, source: 'personal', score: 1, method: 'personal' });
  }

  const personal = detectPersonalQuery(userMessage);
  if (personal) {
    console.log(`[PERSONAL] Detected: ${personal.type}`);
    if (!personal.needsId) {
      const reply = language === 'de' ? personal.askMessageDe : personal.askMessage;
      return res.json({ reply, source: 'personal', score: 1, method: 'personal' });
    }
    // Check if user already included a booking ID
    const idInMessage = extractBookingId(userMessage);
    if (idInMessage) {
      const reply = await handlePersonalQuery(personal.type, idInMessage, username);
      return res.json({ reply, source: 'personal', score: 1, method: 'personal' });
    }
    // Ask for booking ID
    pendingLookups[username] = personal.type;
    const reply = language === 'de' ? personal.askMessageDe : personal.askMessage;
    return res.json({ reply, source: 'personal', score: 1, method: 'personal' });
  }

  // STEP 1 — Combined search (semantic + keyword fallback)
  const { match, score, topK, method } = await combinedSearch(userMessage);
  console.log(`[SEARCH] method=${method} score=${score.toFixed(4)} match=${!!match}`);

  // STEP 2 — Reject if below threshold → SAVE for learning
  if (!match) {
    addUnanswered(userMessage, req.body.username);
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

// ── POST /api/chat/stream (SSE streaming) ────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const userMessage = message.trim();
  const username = req.body.username || 'User';
  const language = req.body.language || 'en';
  console.log(`\n[STREAM] "${userMessage}"`);

  // STEP 0 — Check for personal queries
  const bookingId = extractBookingId(userMessage);
  if (bookingId && pendingLookups[username]) {
    const pType = pendingLookups[username];
    delete pendingLookups[username];
    const reply = await handlePersonalQuery(pType, bookingId, username);
    console.log(`[PERSONAL] Lookup ${pType} for ${bookingId}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ token: reply })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  }

  const personal = detectPersonalQuery(userMessage);
  if (personal) {
    console.log(`[PERSONAL] Detected: ${personal.type}`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (!personal.needsId) {
      const reply = language === 'de' ? personal.askMessageDe : personal.askMessage;
      res.write(`data: ${JSON.stringify({ token: reply })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }
    const idInMessage = extractBookingId(userMessage);
    if (idInMessage) {
      const reply = await handlePersonalQuery(personal.type, idInMessage, username);
      res.write(`data: ${JSON.stringify({ token: reply })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }
    pendingLookups[username] = personal.type;
    const reply = language === 'de' ? personal.askMessageDe : personal.askMessage;
    res.write(`data: ${JSON.stringify({ token: reply })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  }

  // Search
  const { match, score, topK, method } = await combinedSearch(userMessage);
  console.log(`[SEARCH] method=${method} score=${score.toFixed(4)} match=${!!match}`);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If no match, send rejection
  if (!match) {
    const rejectMsg = "I'm sorry, I can only answer questions about Ayonic's services, policies, and support. Please contact our support team at support@ayonic.com for further help.";
    res.write(`data: ${JSON.stringify({ token: rejectMsg })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  }

  try {
    // Call Groq with streaming
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');

    const systemPrompt = buildSystemPrompt(topK);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: 500,
        temperature: 0.3,
        top_p: 0.85,
        stream: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!groqRes.ok) throw new Error(`Groq error ${groqRes.status}`);

    const reader = groqRes.body;
    const decoder = new (require('util').TextDecoder)();
    let buffer = '';

    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          } catch (_) {}
        }
      }
    }

    res.end();
  } catch (err) {
    console.error(`[STREAM ERROR] ${err.message}`);
    // Fallback — send the FAQ answer directly
    res.write(`data: ${JSON.stringify({ token: match.answer })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
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

// ═══════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS — Manage unanswered questions & FAQs
// ═══════════════════════════════════════════════════════════════

// Middleware: check admin key
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-admin-key header.' });
  }
  next();
}

// ── GET /api/admin/unanswered — View saved unanswered questions
app.get('/api/admin/unanswered', adminAuth, (req, res) => {
  const sorted = [...unansweredQuestions]
    .filter(u => u.status === 'pending')
    .sort((a, b) => (b.count || 1) - (a.count || 1));
  res.json({
    total: sorted.length,
    questions: sorted,
  });
});

// ── POST /api/admin/approve — Add unanswered question as new FAQ
app.post('/api/admin/approve', adminAuth, async (req, res) => {
  const { id, answer } = req.body;
  if (!id || !answer?.trim()) {
    return res.status(400).json({ error: 'id and answer are required.' });
  }

  // Find the unanswered question
  const item = unansweredQuestions.find(u => u.id === id);
  if (!item) {
    return res.status(404).json({ error: 'Question not found.' });
  }

  // Add to FAQ dataset
  const newFaq = { question: item.question, answer: answer.trim() };
  faqData.push(newFaq);

  // Save to faq_dataset.json
  try {
    fs.writeFileSync(FAQ_FILE, JSON.stringify(faqData, null, 2));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save FAQ: ${err.message}` });
  }

  // Compute embedding for new FAQ (if semantic is ready)
  if (semanticReady && embeddingPipeline) {
    try {
      const text = `${newFaq.question} ${newFaq.answer}`;
      const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
      faqEmbeddings.push(Array.from(output.data));
      console.log(`[LEARN] ✅ New FAQ embedded: "${newFaq.question}"`);
    } catch (_) {}
  }

  // Mark as approved
  item.status = 'approved';
  item.approvedAt = new Date().toISOString();
  saveUnanswered();

  console.log(`[LEARN] ✅ New FAQ #${faqData.length}: "${newFaq.question}"`);
  res.json({
    success: true,
    message: `FAQ added! Total FAQs: ${faqData.length}`,
    faq: newFaq,
  });
});

// ── POST /api/admin/dismiss — Dismiss an unanswered question
app.post('/api/admin/dismiss', adminAuth, (req, res) => {
  const { id } = req.body;
  const item = unansweredQuestions.find(u => u.id === id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  item.status = 'dismissed';
  saveUnanswered();
  res.json({ success: true, message: 'Question dismissed.' });
});

// ── POST /api/admin/add-faq — Directly add a new FAQ
app.post('/api/admin/add-faq', adminAuth, async (req, res) => {
  const { question, answer } = req.body;
  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question and answer are required.' });
  }

  const newFaq = { question: question.trim(), answer: answer.trim() };
  faqData.push(newFaq);

  try {
    fs.writeFileSync(FAQ_FILE, JSON.stringify(faqData, null, 2));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save: ${err.message}` });
  }

  // Compute embedding
  if (semanticReady && embeddingPipeline) {
    try {
      const text = `${newFaq.question} ${newFaq.answer}`;
      const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
      faqEmbeddings.push(Array.from(output.data));
    } catch (_) {}
  }

  console.log(`[ADMIN] ✅ Added FAQ #${faqData.length}: "${newFaq.question}"`);
  res.json({ success: true, totalFaqs: faqData.length, faq: newFaq });
});

// ── GET /api/admin/stats — Dashboard stats
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const pending   = unansweredQuestions.filter(u => u.status === 'pending').length;
  const approved  = unansweredQuestions.filter(u => u.status === 'approved').length;
  const dismissed = unansweredQuestions.filter(u => u.status === 'dismissed').length;
  res.json({
    totalFaqs: faqData.length,
    unanswered: { pending, approved, dismissed, total: unansweredQuestions.length },
    semanticSearch: semanticReady ? 'active' : 'loading',
    model: GROQ_MODEL,
  });
});

// ── Catch-all: serve frontend for any non-API route ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  loadUnanswered();
  console.log(`\n✅  Ayonic Chatbot Backend v5.0 (Self-Learning)`);
  console.log(`    URL        : http://localhost:${PORT}`);
  console.log(`    AI Brain   : Groq API (${GROQ_MODEL})`);
  console.log(`    FAQ entries: ${faqData.length}`);
  console.log(`    Unanswered : ${unansweredQuestions.length} saved questions`);
  console.log(`    Groq Key   : ${GROQ_API_KEY ? '✅ configured' : '❌ MISSING'}`);
  console.log(`    Admin Key  : ${ADMIN_KEY}`);
  console.log(`    Search     : Semantic (loading in background...)`);
  console.log(`    Health     : http://localhost:${PORT}/api/health\n`);

  initSemanticSearch();
});
