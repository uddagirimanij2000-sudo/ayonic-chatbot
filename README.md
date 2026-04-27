# 🤖 Support Chatbot — Full Stack

```
Floating Button (UI)
       ↓
Chat Window Opens
       ↓
Node.js Backend  (port 3001)
       ↓
Strict FAQ Filter  ← faq_dataset.json (79 entries)
       ↓
Ollama (local AI)  ← llama3.2 or any model
       ↓
Response streamed back to UI
```

---

## 📁 Project Structure

```
chatbot-system/
├── backend/
│   ├── server.js          ← Express + FAQ filter + Ollama proxy
│   ├── faq_dataset.json   ← Your 79-entry FAQ dataset
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx        ← Floating button + Chat window (React)
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

---

## 🚀 Setup & Run

### 1. Install & start Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model (llama3.2 is fast & small)
ollama pull llama3.2

# Ollama will run automatically on http://localhost:11434
```

> **Windows:** Download from https://ollama.ai and run the installer.

---

### 2. Start the Backend

```bash
cd backend
npm install
npm start
# ✅ Running on http://localhost:3001
```

**Check it's working:**
```bash
curl http://localhost:3001/api/health
# → { status: "ok", faqEntries: 79, ollama: "ok (1 models loaded)" }
```

---

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
# ✅ Running on http://localhost:3000
```

Open **http://localhost:3000** and click the 🔶 chat button in the bottom-right corner.

---

## ⚙️ Configuration

### Change the Ollama model
```bash
# backend/.env  (create this file)
OLLAMA_MODEL=mistral         # or llama3, phi3, gemma, etc.
OLLAMA_URL=http://localhost:11434
PORT=3001
```

Or pass as environment variables:
```bash
OLLAMA_MODEL=mistral npm start
```

### Adjust strictness of the FAQ filter
In `backend/server.js`, change:
```js
const MATCH_THRESHOLD = 0.25;  // lower = more strict (rejects more)
                                // higher = more lenient (answers more)
```

---

## 🔍 How the Strict Filter Works

```
User question
    │
    ▼
Tokenize + remove stop words
    │
    ▼
Jaccard similarity scored against every FAQ entry
(question weighted 2×, answer weighted 1×)
    │
    ├─ score < 0.25 → REJECT → "I can only answer FAQ topics"
    │
    └─ score ≥ 0.25 → take top-5 matching FAQs
                          │
                          ▼
                   Build Ollama prompt with
                   ONLY those 5 FAQs as context
                          │
                          ▼
                   Ollama generates answer
                   strictly from that context
```

If Ollama is unreachable, the backend **falls back** to returning the best direct FAQ answer from the dataset.

---

## 🧪 Test the API directly

```bash
# Valid FAQ question — should get a proper answer
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is your return policy?"}'

# Out-of-scope question — should get politely rejected
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Paris today?"}'

# Health check
curl http://localhost:3001/api/health

# List all FAQ topics
curl http://localhost:3001/api/faq
```

---

## 🎨 Frontend Features

| Feature | Details |
|---|---|
| Floating chat button | Fixed bottom-right, orange/red gradient |
| Unread badge | Shows on FAB when chat is closed |
| Chat window | Slides up with spring animation |
| Quick action chips | 4 preset questions, horizontally scrollable |
| Typing indicator | Animated 3-dot bounce |
| Multi-turn memory | Full conversation history sent each request |
| Auto-grow textarea | Expands up to 3 lines then scrolls |
| Error handling | Red banner with dismiss, message rolled back |
| Responsive | Works on mobile & desktop |

---

## 🛡️ Strict Filter Behaviour

| Input | Filter Result |
|---|---|
| "What is your return policy?" | ✅ Matched → Ollama answers |
| "How do I track my order?" | ✅ Matched → Ollama answers |
| "Can I pay with crypto?" | ❌ Rejected → fallback message |
| "What is the capital of France?" | ❌ Rejected → fallback message |
| "My package was damaged" | ✅ Matched → Ollama answers |
