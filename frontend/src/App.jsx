import { useState, useRef, useEffect, useCallback } from "react";

const API_URL = "";
const STORAGE_MESSAGES  = "ayonic_chat_messages";
const STORAGE_HISTORY   = "ayonic_chat_history";
const STORAGE_QUICKDONE = "ayonic_quick_done";
const STORAGE_USERNAME  = "ayonic_username";
const STORAGE_DARKMODE  = "ayonic_darkmode";
const STORAGE_LANG      = "ayonic_language";
const LOGO_SRC = "/logo.jpeg";
const IDLE_TIMEOUT = 5 * 60 * 1000;

// ── Language System ───────────────────────────────
const LANGUAGES = {
  en: {
    code:        "en",
    flag:        "🇬🇧",
    name:        "English",
    nativeName:  "English",
    voiceLang:   "en-US",
  },
  de: {
    code:        "de",
    flag:        "🇩🇪",
    name:        "German",
    nativeName:  "Deutsch",
    voiceLang:   "de-DE",
  },
};

// All UI text in both languages
const T = {
  en: {
    welcomeTitle:    "Welcome to Ayonic Support",
    welcomeSub:      "Please enter your name to get started",
    namePlaceholder: "Your name…",
    startBtn:        "Start Chat →",
    chooseLanguage:  "Choose your language",
    onlineLabel:     "Online",
    supportChat:     "Support Chat",
    chatRestored:    "Chat restored",
    startNew:        "Start new chat",
    quickLabel:      "Quick questions",
    typePlaceholder: "Type your message…",
    listenPlaceholder:"🎤 Listening… speak now",
    footerText:      "Powered by Ayonic · FAQ filter active 🔒",
    errorText:       "Couldn't reach the server. Is your backend running on port 3001?",
    endVoiceChat:    "End Voice Chat",
    voiceTitle:      "Ayonic Voice Assistant",
    tapToSpeak:      "Tap to speak",
    listening:       "Listening…",
    thinking:        "Thinking…",
    speaking:        "Speaking…",
    hiListening:     (n) => `Hi ${n}! 👋 I'm listening.`,
    welcome:         (n) => `Hi ${n}! 😊 I'm your Ayonic support assistant.\nI can help with bookings, payments, cancellations, privacy, and more. What can I do for you today?`,
    idleMessages: [
      n => `Hey ${n}! 👋 Still there? I'm here if you need help.`,
      n => `Hi ${n}! Just checking in — anything else I can help with?`,
      n => `${n}, feel free to ask about bookings, payments or services! 😊`,
    ],
    quickActions: [
      { label: "How to Book 📋",     text: "How do I book a service on Ayonic?" },
      { label: "Payment Methods 💳", text: "What payment methods are accepted on Ayonic?" },
      { label: "Cancel Booking ❌",  text: "Can I cancel a booking?" },
      { label: "Privacy Policy 🔒",  text: "Is my personal data protected on Ayonic?" },
    ],
  },
  de: {
    welcomeTitle:    "Willkommen beim Ayonic Support",
    welcomeSub:      "Bitte geben Sie Ihren Namen ein, um zu beginnen",
    namePlaceholder: "Ihr Name…",
    startBtn:        "Chat starten →",
    chooseLanguage:  "Sprache wählen",
    onlineLabel:     "Online",
    supportChat:     "Support-Chat",
    chatRestored:    "Chat wiederhergestellt",
    startNew:        "Neuen Chat starten",
    quickLabel:      "Schnellfragen",
    typePlaceholder: "Nachricht eingeben…",
    listenPlaceholder:"🎤 Ich höre zu… bitte sprechen",
    footerText:      "Powered by Ayonic · FAQ-Filter aktiv 🔒",
    errorText:       "Server nicht erreichbar. Läuft Ihr Backend auf Port 3001?",
    endVoiceChat:    "Sprachanruf beenden",
    voiceTitle:      "Ayonic Sprachassistent",
    tapToSpeak:      "Tippen zum Sprechen",
    listening:       "Ich höre zu…",
    thinking:        "Ich denke nach…",
    speaking:        "Ich spreche…",
    hiListening:     (n) => `Hallo ${n}! 👋 Ich höre zu.`,
    welcome:         (n) => `Hallo ${n}! 😊 Ich bin Ihr Ayonic Support-Assistent.\nIch helfe Ihnen bei Buchungen, Zahlungen, Stornierungen, Datenschutz und mehr. Was kann ich für Sie tun?`,
    idleMessages: [
      n => `Hallo ${n}! 👋 Noch da? Ich helfe Ihnen gerne.`,
      n => `Hi ${n}! Nur zur Nachfrage — kann ich noch etwas für Sie tun?`,
      n => `${n}, fragen Sie mich gerne zu Buchungen, Zahlungen oder Diensten! 😊`,
    ],
    quickActions: [
      { label: "Wie buchen 📋",       text: "Wie buche ich einen Service bei Ayonic?" },
      { label: "Zahlungsmethoden 💳", text: "Welche Zahlungsmethoden akzeptiert Ayonic?" },
      { label: "Buchung stornieren ❌", text: "Kann ich eine Buchung stornieren?" },
      { label: "Datenschutz 🔒",      text: "Sind meine persönlichen Daten bei Ayonic geschützt?" },
    ],
  },
};

function loadLang()  { return localStorage.getItem(STORAGE_LANG) || ""; }
function saveLang(l) { localStorage.setItem(STORAGE_LANG, l); }

// Keep old exports for backward compat — will be overridden by lang context
const QUICK_ACTIONS = T.en.quickActions;
const IDLE_MESSAGES = T.en.idleMessages;

const EMOJIS = ["😊","👍","🙏","😅","🤔","😮","❤️","🎉","✅","❌","📦","🚚","💳","💸","🔄","⭐"];

const uid = () => Date.now() + Math.random();
const fmtTime = d => new Date(d).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

// ── Voice Chat (Speech Input + Speech Output) ─────
// speakText — bot reads its reply aloud
function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // stop any current speech
  const clean = text.replace(/[*_#`~]/g, "").trim(); // strip markdown
  const utt   = new SpeechSynthesisUtterance(clean);
  utt.lang   = "en-US";
  utt.rate   = 1.0;
  utt.pitch  = 1.0;
  utt.volume = 1.0;
  // prefer a natural-sounding voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.name.includes("Samantha") ||
    v.name.includes("Google US English") ||
    v.name.includes("Karen") ||
    v.name.includes("Moira") ||
    (v.lang === "en-US" && !v.name.includes("Google"))
  );
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

// ── Full Voice Call Mode ──────────────────────────
function VoiceCallModal({ onClose, username, onSendMessage }) {
  const [phase, setPhase]     = useState("idle");
  // phases: idle → listening → thinking → speaking → idle
  const [transcript, setTr]   = useState("");
  const [botReply,   setBR]   = useState("");
  const [error,      setErr]  = useState("");
  const recogRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recogRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr("Voice not supported in this browser. Try Chrome or Safari."); return; }
    window.speechSynthesis?.cancel();
    const recog = new SR();
    recog.lang = "en-US";
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = async (e) => {
      const text = e.results[0][0].transcript;
      setTr(text);
      setPhase("thinking");
      // send to backend
      const reply = await onSendMessage(text);
      setBR(reply);
      setPhase("speaking");
      speakText(reply);
      // after speaking, go back to idle
      const utt = new SpeechSynthesisUtterance(reply);
      utt.onend = () => setPhase("idle");
      // small fallback timeout in case onend doesn't fire
      const words = reply.split(" ").length;
      setTimeout(() => setPhase("idle"), Math.max(words * 500, 3000));
    };
    recog.onerror = (e) => { setErr("Mic error: " + e.error); setPhase("idle"); };
    recog.onend   = () => { if (phase === "listening") setPhase("idle"); };
    recogRef.current = recog;
    recog.start();
    setPhase("listening");
    setTr(""); setBR(""); setErr("");
  };

  const stopAll = () => {
    recogRef.current?.stop();
    window.speechSynthesis?.cancel();
    setPhase("idle");
  };

  const phaseConfig = {
    idle:      { color:"#1a6fc4", pulse:false, icon:"mic",    label:"Tap to speak" },
    listening: { color:"#ef4444", pulse:true,  icon:"stop",   label:"Listening…" },
    thinking:  { color:"#f59e0b", pulse:true,  icon:"dots",   label:"Thinking…" },
    speaking:  { color:"#22c55e", pulse:true,  icon:"sound",  label:"Speaking…" },
  };
  const cfg = phaseConfig[phase];

  return (
    <div className="voice-modal-overlay" onClick={e => e.target===e.currentTarget&&onClose()}>
      <div className="voice-modal">
        {/* Header */}
        <div className="vm-header">
          <AyonicIcon size={28} white/>
          <span className="vm-title">Ayonic Voice Assistant</span>
          <button className="vm-close" onClick={onClose}>×</button>
        </div>

        {/* Big mic orb */}
        <div className="vm-orb-wrap">
          <div className={`vm-orb${cfg.pulse?" vm-orb-pulse":""}`}
            style={{background: cfg.color === "#1a6fc4"
              ? "linear-gradient(135deg,#1a6fc4,#5cb3f0)"
              : `radial-gradient(circle, ${cfg.color}cc, ${cfg.color})`}}
            onClick={phase==="idle" ? startListening : stopAll}>
            {/* Icon inside orb */}
            {cfg.icon==="mic" && (
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
            {cfg.icon==="stop" && (
              <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            )}
            {cfg.icon==="dots" && (
              <div style={{display:"flex",gap:6}}>
                {[0,1,2].map(i=>(
                  <div key={i} style={{width:10,height:10,borderRadius:"50%",background:"white",
                    animation:`bounce 1.2s ${i*0.2}s ease-in-out infinite`}}/>
                ))}
              </div>
            )}
            {cfg.icon==="sound" && (
              <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            )}
          </div>
          {/* Ripple rings when active */}
          {cfg.pulse && (
            <>
              <div className="vm-ring vm-ring1" style={{borderColor:cfg.color}}/>
              <div className="vm-ring vm-ring2" style={{borderColor:cfg.color}}/>
            </>
          )}
        </div>

        {/* Status label */}
        <p className="vm-phase-label">{cfg.label}</p>

        {/* Transcript and reply */}
        {transcript && (
          <div className="vm-bubble vm-user">
            <span className="vm-bubble-who">You</span>
            <span className="vm-bubble-text">{transcript}</span>
          </div>
        )}
        {botReply && (
          <div className="vm-bubble vm-bot">
            <span className="vm-bubble-who">Ayonic</span>
            <span className="vm-bubble-text">{botReply}</span>
          </div>
        )}
        {error && <p className="vm-error">{error}</p>}

        {/* User name */}
        <p className="vm-user-label">Hi {username}! 👋 I'm listening.</p>

        {/* End call */}
        <button className="vm-end-btn" onClick={onClose}>End Voice Chat</button>
      </div>
    </div>
  );
}

// ── Voice Input Hook (for inline mic in input bar) ─
function useVoiceInput(onResult) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recogRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSupported(true);
      const recog = new SpeechRecognition();
      recog.continuous      = false;
      recog.interimResults  = false;
      recog.lang            = "en-US";
      recog.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        onResult(transcript);
        setListening(false);
      };
      recog.onerror  = () => setListening(false);
      recog.onend    = () => setListening(false);
      recogRef.current = recog;
    }
  }, [onResult]);

  const toggle = () => {
    if (!recogRef.current) return;
    if (listening) { recogRef.current.stop(); setListening(false); }
    else           { recogRef.current.start(); setListening(true); }
  };

  return { listening, supported, toggle };
}

// ── Sound ─────────────────────────────────────────
function playSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach(delay => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(820, ctx.currentTime + delay);
      osc.frequency.setValueAtTime(1020, ctx.currentTime + delay + 0.06);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
  } catch(_) {}
}

// ── Storage helpers ───────────────────────────────
function makeWelcome(name, lang="en") {
  return { id:"welcome-1", role:"bot", timestamp:new Date().toISOString(),
    text: T[lang].welcome(name) };
}
function loadMessages(name, lang="en") {
  try { const p=JSON.parse(localStorage.getItem(STORAGE_MESSAGES)||"[]"); if(p.length>0) return p; } catch(_){}
  return [makeWelcome(name, lang)];
}
function loadHistory()   { try{return JSON.parse(localStorage.getItem(STORAGE_HISTORY)||"[]");}catch(_){return[];} }
function loadQuickDone() { return localStorage.getItem(STORAGE_QUICKDONE)==="true"; }
function loadUsername()  { return localStorage.getItem(STORAGE_USERNAME)||""; }
function loadDarkMode()  { return localStorage.getItem(STORAGE_DARKMODE)==="true"; }
function saveMessages(m) { try{localStorage.setItem(STORAGE_MESSAGES,JSON.stringify(m.slice(-100)));}catch(_){} }
function saveHistory(h)  { try{localStorage.setItem(STORAGE_HISTORY,JSON.stringify(h));}catch(_){} }

function getDayLabel(iso) {
  const d=new Date(iso),today=new Date().toDateString(),yest=new Date(Date.now()-86400000).toDateString();
  if(d.toDateString()===today) return "Today";
  if(d.toDateString()===yest)  return "Yesterday";
  return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
}
function buildGroups(messages) {
  const groups=[];let last=null;
  for(const msg of messages){
    const ds=new Date(msg.timestamp).toDateString();
    if(ds!==last){groups.push({type:"divider",label:getDayLabel(msg.timestamp),key:"d-"+msg.id});last=ds;}
    groups.push({type:"msg",msg});
  }
  return groups;
}

// ── Logo ──────────────────────────────────────────
function AyonicLogo({size=100}) {
  return <img src={LOGO_SRC} alt="Ayonic" width={size} height={size} style={{objectFit:"contain",display:"block"}}/>;
}
function AyonicIcon({size=32,white=false}) {
  return <img src={LOGO_SRC} alt="Ayonic" width={size} height={size} style={{objectFit:"contain",display:"block",filter:white?"brightness(0) invert(1)":"none"}}/>;
}

// ── Copy Button ───────────────────────────────────
function CopyButton({text}) {
  const [copied,setCopied]=useState(false);
  const handle=async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch(_){}};
  return(
    <button className="copy-btn" onClick={handle}>
      {copied
        ?<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        :<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      }
      <span>{copied?"Copied!":"Copy"}</span>
    </button>
  );
}

// ── Star Rating ───────────────────────────────────
function StarRating({msgId,onRate}) {
  const [rated,setRated]=useState(0);
  const [hover,setHover]=useState(0);
  if(rated>0) return <span className="rated-label">{"⭐".repeat(rated)} Thanks!</span>;
  return(
    <div className="star-row">
      {[1,2,3,4,5].map(s=>(
        <button key={s} className="star-btn"
          onMouseEnter={()=>setHover(s)} onMouseLeave={()=>setHover(0)}
          onClick={()=>{setRated(s);onRate(msgId,s);}}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill={(hover||rated)>=s?"#f59e0b":"none"} stroke="#f59e0b" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
      ))}
    </div>
  );
}

// ── Thumbs Up/Down ────────────────────────────────
function ThumbsRating({msgId,onRate}) {
  const [voted,setVoted]=useState(null);
  const handle=(v)=>{setVoted(v);onRate(msgId,v);};
  return(
    <div className="thumbs-row">
      <button className={`thumb-btn${voted==="up"?" active-up":""}`} onClick={()=>handle("up")} disabled={!!voted}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill={voted==="up"?"#22c55e":"none"} stroke={voted==="up"?"#22c55e":"currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
        </svg>
      </button>
      <button className={`thumb-btn${voted==="down"?" active-down":""}`} onClick={()=>handle("down")} disabled={!!voted}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill={voted==="down"?"#ef4444":"none"} stroke={voted==="down"?"#ef4444":"currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
        </svg>
      </button>
    </div>
  );
}

// ── Follow-up Suggestions ─────────────────────────
const FOLLOWUPS = {
  en: {
    booking:  ["How do I book a service?","Can I book multiple services?","Can I choose my provider?"],
    payment:  ["What payment methods are accepted?","Are payments secure?","Can I pay the provider directly?"],
    cancel:   ["Can I cancel a booking?","What is the cancellation policy?","Will I get a refund if I cancel?"],
    privacy:  ["Is my personal data protected?","What are my privacy rights?","Does Ayonic share my data?"],
    provider: ["How do you verify providers?","What if the provider doesn't show up?","Can I rate a provider?"],
    default:  ["How do I book a service?","What payment methods are accepted?","Is my data protected?"],
  },
  de: {
    booking:  ["Wie buche ich einen Service?","Kann ich mehrere Services buchen?","Kann ich meinen Anbieter wählen?"],
    payment:  ["Welche Zahlungsmethoden werden akzeptiert?","Sind Zahlungen sicher?","Kann ich den Anbieter direkt bezahlen?"],
    cancel:   ["Kann ich eine Buchung stornieren?","Was ist die Stornierungsrichtlinie?","Bekomme ich eine Rückerstattung?"],
    privacy:  ["Sind meine Daten geschützt?","Was sind meine Datenschutzrechte?","Teilt Ayonic meine Daten?"],
    provider: ["Wie überprüft ihr die Anbieter?","Was wenn der Anbieter nicht kommt?","Kann ich einen Anbieter bewerten?"],
    default:  ["Wie buche ich einen Service?","Welche Zahlungsmethoden gibt es?","Sind meine Daten geschützt?"],
  },
};

function getFollowups(text, lang="en") {
  const t = text.toLowerCase();
  const F = FOLLOWUPS[lang] || FOLLOWUPS.en;
  if(t.includes("book")||t.includes("service")||t.includes("buch")||t.includes("dienst")) return F.booking;
  if(t.includes("pay")||t.includes("card")||t.includes("paypal")||t.includes("zahl")||t.includes("karte")) return F.payment;
  if(t.includes("cancel")||t.includes("refund")||t.includes("stornier")||t.includes("rückerstatt")) return F.cancel;
  if(t.includes("privacy")||t.includes("data")||t.includes("gdpr")||t.includes("datenschutz")||t.includes("daten")) return F.privacy;
  if(t.includes("provider")||t.includes("anbieter")||t.includes("verify")||t.includes("rate")||t.includes("review")) return F.provider;
  return F.default;
}

// ── Export chat as text file ──────────────────────
function exportChat(messages, username) {
  const lines = [`Ayonic Support Chat — ${username}`, `Exported: ${new Date().toLocaleString()}`, "─".repeat(50), ""];
  for(const m of messages) {
    const time = fmtTime(m.timestamp);
    const who  = m.role==="user" ? username : "Ayonic Bot";
    lines.push(`[${time}] ${who}:`);
    lines.push(m.text);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], {type:"text/plain"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `ayonic-chat-${username}-${Date.now()}.txt`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Profanity filter (basic) ──────────────────────
const BAD_WORDS = ["damn","shit","fuck","ass","bitch","crap","hell","bastard"];
function containsProfanity(text) {
  const lower = text.toLowerCase();
  return BAD_WORDS.some(w => lower.includes(w));
}

// ── Rate limiter (max 20 msgs per min) ───────────
const msgTimestamps = [];
function isRateLimited() {
  const now = Date.now();
  while(msgTimestamps.length && now - msgTimestamps[0] > 60000) msgTimestamps.shift();
  if(msgTimestamps.length >= 20) return true;
  msgTimestamps.push(now); return false;
}

// ── ChatBubble with ratings & follow-ups ─────────
function ChatBubble({msg,onRate,onFollowup,darkMode,showSuggestions=false,lang="en"}) {
  const isUser=msg.role==="user";
  const [hover,setHover]=useState(false);
  return(
    <div className={`bubble-row ${isUser?"user":"bot"}`} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      {!isUser&&<div className="avatar"><AyonicIcon size={18} white/></div>}
      <div className="bubble-col">
        <div className={`bubble ${isUser?"bubble-user":"bubble-bot"}`}>{msg.text}</div>
        <div className={`bubble-meta ${isUser?"meta-right":"meta-left"}`}>
          <span className="ts">{fmtTime(msg.timestamp)}</span>
          {hover&&<CopyButton text={msg.text}/>}
          {!isUser&&<StarRating msgId={msg.id} onRate={onRate}/>}
          {!isUser&&<ThumbsRating msgId={msg.id} onRate={onRate}/>}
        </div>
        {/* Follow-up suggestions under last bot message */}
        {!isUser&&showSuggestions&&(
          <div className="followups">
            {getFollowups(msg.text, lang).map((q,i)=>(
              <button key={i} className="followup-chip" onClick={()=>onFollowup(q)}>{q}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────
function TypingDots({username}) {
  return(
    <div className="bubble-row bot">
      <div className="avatar"><AyonicIcon size={18} white/></div>
      <div className="typing-wrap">
        <div className="typing-pill"><span className="dot d1"/><span className="dot d2"/><span className="dot d3"/></div>
        <span className="typing-label">Replying to {username}…</span>
      </div>
    </div>
  );
}

function QuickChip({label,onClick,disabled}) {
  return <button className="chip" onClick={onClick} disabled={disabled}>{label}</button>;
}

// ── Emoji Picker ──────────────────────────────────
function EmojiPicker({onSelect,onClose}) {
  return(
    <div className="emoji-picker">
      {EMOJIS.map(e=>(
        <button key={e} className="emoji-btn" onClick={()=>{onSelect(e);onClose();}}>{e}</button>
      ))}
    </div>
  );
}

// ── Message Search ────────────────────────────────
function SearchBar({messages,onClose}) {
  const [q,setQ]=useState("");
  const results=q.trim()?messages.filter(m=>m.text.toLowerCase().includes(q.toLowerCase())):[];
  return(
    <div className="search-bar">
      <input className="search-input" placeholder="Search messages…" value={q} autoFocus
        onChange={e=>setQ(e.target.value)}/>
      <button className="search-close" onClick={onClose}>×</button>
      {q.trim()&&(
        <div className="search-results">
          {results.length===0
            ?<p className="search-empty">No results for "{q}"</p>
            :results.map(m=>(
              <div key={m.id} className={`search-result ${m.role}`}>
                <span className="sr-who">{m.role==="user"?"You":"Bot"}</span>
                <span className="sr-text">{m.text.length>80?m.text.slice(0,80)+"…":m.text}</span>
                <span className="sr-time">{fmtTime(m.timestamp)}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Name + Language Popup ─────────────────────────
function NamePopup({onStart}) {
  const [name,    setName]    = useState("");
  const [lang,    setLang]    = useState("en");
  const [step,    setStep]    = useState("lang"); // "lang" → "name"
  const [error,   setError]   = useState(false);
  const inputRef = useRef(null);
  const t = T[lang];

  useEffect(() => {
    if (step === "name") setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const handleStart = () => {
    if (!name.trim()) { setError(true); setTimeout(() => setError(false), 600); return; }
    saveLang(lang);
    onStart(name.trim(), lang);
  };

  return (
    <div className="name-popup">
      <div className="name-popup-logo"><AyonicIcon size={44} white/></div>

      {step === "lang" ? (
        <>
          {/* Step 1 — Language Selection */}
          <p className="name-popup-title">Welcome · Willkommen</p>
          <p className="name-popup-sub">{t.chooseLanguage}</p>
          <div className="lang-btns">
            {Object.values(LANGUAGES).map(l => (
              <button
                key={l.code}
                className={`lang-btn${lang===l.code?" lang-btn-active":""}`}
                onClick={() => setLang(l.code)}
              >
                <span className="lang-flag">{l.flag}</span>
                <span className="lang-native">{l.nativeName}</span>
              </button>
            ))}
          </div>
          <button className="name-start-btn" onClick={() => setStep("name")}>
            {lang === "en" ? "Continue →" : "Weiter →"}
          </button>
        </>
      ) : (
        <>
          {/* Step 2 — Name Input */}
          <p className="name-popup-title">{t.welcomeTitle}</p>
          <p className="name-popup-sub">{t.welcomeSub}</p>
          <div className="lang-selected" onClick={() => setStep("lang")}>
            {LANGUAGES[lang].flag} {LANGUAGES[lang].nativeName}
            <span className="lang-change">✏️</span>
          </div>
          <input ref={inputRef} className={`name-input${error?" shake":""}`} type="text"
            placeholder={t.namePlaceholder} value={name} maxLength={30}
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleStart()}/>
          <button className="name-start-btn" onClick={handleStart}>{t.startBtn}</button>
        </>
      )}
    </div>
  );
}

// ── Voice Input Row Component ─────────────────────
function VoiceInputRow({input,setInput,isTyping,onSend,onKey,onReset,taRef,showEmoji,setShowEmoji,lang="en"}) {
  const t = T[lang] || T.en;
  const handleVoiceResult = useCallback((transcript) => {
    setInput(prev => prev ? prev + " " + transcript : transcript);
  }, [setInput]);

  const { listening, supported, toggle } = useVoiceInput(handleVoiceResult);

  return (
    <div className="cw-input-row">
      <button className="emoji-toggle" onClick={()=>setShowEmoji(s=>!s)} title="Emoji">😊</button>
      <div className="input-wrap">
        <textarea ref={taRef} rows={1}
          placeholder={listening ? t.listenPlaceholder : t.typePlaceholder}
          value={input} disabled={isTyping}
          onChange={e=>{onReset();setInput(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,96)+"px";}}
          onKeyDown={onKey}/>
      </div>

      {/* Voice button — only if browser supports it */}
      {supported && (
        <button
          className={`voice-btn${listening?" voice-listening":""}`}
          onClick={toggle}
          title={listening ? "Stop listening" : "Speak your message"}
        >
          {listening ? (
            // Stop / pulse icon when recording
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
          ) : (
            // Mic icon
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          )}
        </button>
      )}

      <button className={`send-btn${input.trim()&&!isTyping?" active":""}`}
        onClick={()=>onSend(input)} disabled={!input.trim()||isTyping}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  );
}

// ── ChatWindow ────────────────────────────────────
function ChatWindow({onClose, username, onUnreadChange, darkMode, toggleDark, lang="en"}) {
  const t = T[lang];
  const [messages,  setMessages]  = useState(()=>loadMessages(username, lang));
  const [history,   setHistory]   = useState(()=>loadHistory());
  const [showQuick, setShowQuick] = useState(()=>!loadQuickDone());
  const [input,     setInput]     = useState("");
  const [isTyping,  setIsTyping]  = useState(false);
  const [error,     setError]     = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSearch,setShowSearch]= useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const endRef=useRef(null),taRef=useRef(null),idleTimer=useRef(null),idleIdx=useRef(0);
  const isRestored=messages.length>1;
  const lastBotIdx=messages.map((m,i)=>m.role==="bot"?i:-1).filter(i=>i>=0).pop();

  useEffect(()=>{if(!minimized) endRef.current?.scrollIntoView({behavior:"smooth"});},[messages,isTyping,minimized]);
  useEffect(()=>{saveMessages(messages);},[messages]);
  useEffect(()=>{saveHistory(history);},[history]);

  const resetIdle=useCallback(()=>{
    if(idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current=setTimeout(()=>{
      const msgs = T[lang].idleMessages;
      const fn=msgs[idleIdx.current%msgs.length]; idleIdx.current++;
      const m={id:uid(),role:"bot",text:fn(username),timestamp:new Date().toISOString()};
      setMessages(p=>[...p,m]); playSound(); onUnreadChange(1); resetIdle();
    },IDLE_TIMEOUT);
  },[username,onUnreadChange,lang]);

  useEffect(()=>{resetIdle();return()=>{if(idleTimer.current) clearTimeout(idleTimer.current);};},[resetIdle]);

  const clearChat=()=>{
    localStorage.removeItem(STORAGE_MESSAGES);localStorage.removeItem(STORAGE_HISTORY);
    localStorage.removeItem(STORAGE_QUICKDONE);localStorage.removeItem(STORAGE_USERNAME);
    if(idleTimer.current) clearTimeout(idleTimer.current);
    onClose();
  };

  const handleRate=(msgId,val)=>{ console.log("Rating:",msgId,val); };

  const send=useCallback(async(text)=>{
    if(!text.trim()||isTyping) return;
    if(isRateLimited()){setError("Too many messages! Please wait a moment.");return;}
    if(containsProfanity(text)){setError("Please keep the conversation respectful 🙏");return;}
    resetIdle();
    const trimmed=text.trim();
    const userMsg={id:uid(),role:"user",text:trimmed,timestamp:new Date().toISOString()};
    setMessages(p=>[...p,userMsg]);
    setInput("");setShowQuick(false);setShowEmoji(false);
    localStorage.setItem(STORAGE_QUICKDONE,"true");
    setError(null);
    if(taRef.current) taRef.current.style.height="auto";

    // Create empty bot bubble to stream into
    const botId=uid();
    setMessages(p=>[...p,{id:botId,role:"bot",text:"",timestamp:new Date().toISOString()}]);
    setIsTyping(false);

    try{
      const res=await fetch(`${API_URL}/api/chat/stream`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:trimmed,history,username,language:lang}),
      });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader=res.body.getReader();
      const decoder=new TextDecoder();
      let full="", buffer="";

      while(true){
        const{done,value}=await reader.read();
        if(done) break;
        buffer+=decoder.decode(value,{stream:true});
        const lines=buffer.split('\n');
        buffer=lines.pop();
        for(const line of lines){
          if(line.startsWith('data:')){
            try{
              const data=JSON.parse(line.slice(5).trim());
              if(data.token){
                full+=data.token;
                setMessages(p=>p.map(m=>m.id===botId?{...m,text:full}:m));
              }
            }catch(_){}
          }
        }
      }

      setHistory(h=>[...h,{role:"user",content:trimmed},{role:"assistant",content:full}]);
      playSound(); onUnreadChange(1);

    }catch(err){
      setError(t.errorText);
      setMessages(p=>p.filter(m=>m.id!==userMsg.id&&m.id!==botId));
    }finally{setIsTyping(false);}
  },[history,isTyping,resetIdle,onUnreadChange,lang,t,username]);

  const handleKey=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(input);}};
  const groups=buildGroups(messages);

  // used by voice call modal — sends message and returns reply text
  const sendForVoice = useCallback(async (text) => {
    if (!text.trim()) return "";
    const trimmed = text.trim();
    const userMsg = { id:uid(), role:"user", text:trimmed, timestamp:new Date().toISOString() };
    setMessages(p => [...p, userMsg]);
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ message:trimmed, history, username, language:lang }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const botMsg = { id:uid(), role:"bot", text:data.reply, timestamp:new Date().toISOString() };
      setMessages(p => [...p, botMsg]);
      setHistory(h => [...h, {role:"user",content:trimmed},{role:"assistant",content:data.reply}]);
      return data.reply;
    } catch(e) { return "Sorry, I couldn't connect to the server right now."; }
  }, [history, username]);

  return(
    <div className={`chat-window${minimized?" minimized":""}`}>

      {/* Voice Call Modal */}
      {showVoiceCall && (
        <VoiceCallModal
          onClose={() => setShowVoiceCall(false)}
          username={username}
          onSendMessage={sendForVoice}
        />
      )}

      {/* Header */}
      <div className="cw-header">
        <div className="cw-header-left">
          <div className="cw-avatar"><AyonicIcon size={34} white/></div>
          {!minimized&&(
            <div>
              <div className="cw-title">{t.supportChat} · {username}</div>
              <div className="cw-sub"><span className="online-dot"/>{t.onlineLabel}</div>
            </div>
          )}
          {minimized&&<div className="cw-title" style={{marginLeft:8}}>{t.supportChat} · {username}</div>}
        </div>
        <div className="cw-header-actions">
          {/* Voice Call button */}
          <button className="icon-btn voice-call-btn" onClick={()=>setShowVoiceCall(true)} title="Voice call">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          {/* Dark mode toggle */}
          <button className="icon-btn" onClick={toggleDark} title={darkMode?"Light mode":"Dark mode"}>
            {darkMode
              ?<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              :<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </button>
          {/* Minimize */}
          <button className="icon-btn" onClick={()=>setMinimized(m=>!m)} title={minimized?"Expand":"Minimize"}>
            {minimized
              ?<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
              :<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            }
          </button>
          {/* Clear */}
          <button className="icon-btn" onClick={clearChat} title="Clear chat">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
          {/* Close */}
          <button className="icon-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {!minimized&&<>
        {isRestored&&(
          <div className="restored-bar">
            💬 {t.chatRestored} · <button onClick={clearChat}>{t.startNew}</button>
          </div>
        )}

        {/* Messages */}
        <div className="cw-messages">
          {groups.map((item,gi)=>
            item.type==="divider"
              ?<div key={item.key} className="date-divider"><span>{item.label}</span></div>
              :<ChatBubble key={item.msg.id} msg={item.msg}
                  onRate={handleRate}
                  onFollowup={send}
                  darkMode={darkMode}
                  lang={lang}
                  showSuggestions={item.msg.role==="bot"&&messages.indexOf(item.msg)===lastBotIdx&&!isTyping}
                />
          )}
          {isTyping&&<TypingDots username={username}/>}
          <div ref={endRef}/>
        </div>

        {error&&(
          <div className="error-bar">
            <span>⚠️ {error}</span>
            <button onClick={()=>setError(null)}>×</button>
          </div>
        )}

        {showQuick&&(
          <div className="quick-bar">
            <p className="quick-label">{t.quickLabel}</p>
            <div className="quick-chips">
              {t.quickActions.map(a=>(
                <QuickChip key={a.label} label={a.label} disabled={isTyping} onClick={()=>send(a.text)}/>
              ))}
            </div>
          </div>
        )}

        <div className="cw-divider"/>

        {/* Emoji picker */}
        {showEmoji&&<EmojiPicker onSelect={e=>setInput(i=>i+e)} onClose={()=>setShowEmoji(false)}/>}

        {/* Input */}
        <VoiceInputRow
          input={input} setInput={setInput} isTyping={isTyping}
          onSend={send} onKey={handleKey} onReset={resetIdle}
          taRef={taRef} showEmoji={showEmoji} setShowEmoji={setShowEmoji}
          lang={lang}
        />
        <p className="cw-footer">{t.footerText}</p>
      </>}
    </div>
  );
}

// ── Floating Button ───────────────────────────────
function FloatingButton({open,onClick,unreadCount}) {
  return(
    <button className={`fab${open?" fab-open":""}`} onClick={onClick}>
      {open
        ?<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        :<AyonicIcon size={36} white/>
      }
      {!open&&unreadCount>0&&(
        <span className="unread-badge">{unreadCount>99?"99+":unreadCount}</span>
      )}
    </button>
  );
}

// ── App ───────────────────────────────────────────
export default function App() {
  const [open,        setOpen]        = useState(false);
  const [username,    setUsername]    = useState(()=>loadUsername());
  const [showName,    setShowName]    = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [darkMode,    setDarkMode]    = useState(()=>loadDarkMode());
  const [language,    setLanguage]    = useState(()=>loadLang()||"en");

  const toggleDark=()=>{
    setDarkMode(d=>{
      localStorage.setItem(STORAGE_DARKMODE,String(!d));
      return !d;
    });
  };

  const handleFabClick=()=>{
    if(open||showName){setOpen(false);setShowName(false);return;}
    setUnreadCount(0);
    if(!username){setShowName(true);}else{setOpen(true);}
  };

  const handleNameStart=(name, lang)=>{
    localStorage.setItem(STORAGE_USERNAME, name);
    saveLang(lang);
    setUsername(name);
    setLanguage(lang);
    setShowName(false);
    setOpen(true);
    setUnreadCount(0);
  };

  const handleClose=()=>{
    setOpen(false);
    setShowName(false);
    setUsername(loadUsername());
  };

  const handleUnread=useCallback((n)=>{if(!open) setUnreadCount(p=>p+n);},[open]);
  useEffect(()=>{if(open) setUnreadCount(0);},[open]);

  // Background page text based on language
  const bgCards = language==="de"
    ? ["Kostenloser Versand ab 50€","30 Tage Rückgabe","Sicherer Checkout","24/7 Support"]
    : ["Free shipping over $50","30-day returns","Secure checkout","24/7 support"];

  const bgSub = language==="de"
    ? "Ihr vertrauenswürdiges Support-Ziel"
    : "Your trusted support destination";

  return(
    <>
      <style>{darkMode?DARK_CSS:LIGHT_CSS}{COMMON_CSS}</style>
      <div className="demo-page">
        <div className="demo-content">
          <div className="demo-logo"><AyonicLogo size={130}/></div>
          <h1>AYONIC</h1>
          <p>{bgSub}</p>
          <div className="demo-cards">
            {bgCards.map(t=>(
              <div key={t} className="demo-card">{t}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="widget-container">
        {showName&&!open&&<NamePopup onStart={handleNameStart}/>}
        {open&&username&&(
          <ChatWindow
            onClose={handleClose}
            username={username}
            onUnreadChange={handleUnread}
            darkMode={darkMode}
            toggleDark={toggleDark}
            lang={language}
          />
        )}
        <FloatingButton open={open||showName} onClick={handleFabClick} unreadCount={unreadCount}/>
      </div>
    </>
  );
}

// ── Light theme ───────────────────────────────────
const LIGHT_CSS = `
.demo-page{background:linear-gradient(135deg,#f0f7ff 0%,#e0effe 50%,#f0f7ff 100%)}
.demo-content{color:#1a3a5c}
.demo-content h1{background:linear-gradient(135deg,#1a6fc4,#5cb3f0);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.demo-content p{color:#4a7fa8}
.demo-card{background:rgba(255,255,255,.8);border:1px solid rgba(26,111,196,.15);color:#1a6fc4;}
.chat-window{background:#fff;color:#1e293b}
.bubble-bot{background:#f1f5f9;color:#1e293b}
.date-divider::before,.date-divider::after{background:#f1f5f9}
.date-divider span{color:#94a3b8}
.input-wrap{background:#f8fafc;border-color:#e2e8f0}
.search-bar{background:#fff;border-color:#e2e8f0}
.search-input{background:#f8fafc;color:#1e293b;border-color:#e2e8f0}
.search-result{background:#f8fafc;border-color:#e2e8f0}
.sr-who{color:#1a6fc4}.sr-text{color:#334155}.sr-time{color:#94a3b8}
.emoji-picker{background:#fff;border-color:#e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,.12)}
.restored-bar{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.typing-pill{background:#f1f5f9}
.name-popup{background:#fff;color:#1e293b}
.name-popup-title{color:#1a3a5c}
.name-popup-sub{color:#64748b}
.name-input{background:#fff;color:#1e293b;border-color:#e2e8f0}
.followup-chip{background:#fff;border-color:#bfdbfe;color:#1a6fc4}
.followup-chip:hover{background:#eff6ff}
.copy-btn{color:#94a3b8;border-color:#e2e8f0}
.copy-btn:hover{background:#f1f5f9;color:#1a6fc4;border-color:#93c5fd}
.quick-label{color:#94a3b8}
.chip{background:#fff;border-color:#e2e8f0;color:#475569}
.chip:hover:not(:disabled){background:linear-gradient(135deg,#eff6ff,#dbeafe);border-color:#93c5fd;color:#1a6fc4}
textarea{color:#1e293b}
textarea::placeholder{color:#94a3b8}
.ts{color:#94a3b8}
.cw-footer{color:#cbd5e1}
.typing-label{color:#94a3b8}
.search-empty{color:#94a3b8}
`;

// ── Dark theme ────────────────────────────────────
const DARK_CSS = `
.demo-page{background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)}
.demo-content{color:#e2e8f0}
.demo-content h1{background:linear-gradient(135deg,#5cb3f0,#93c5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.demo-content p{color:#94a3b8}
.demo-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#93c5fd;}
.chat-window{background:#1e293b;color:#e2e8f0}
.bubble-bot{background:#334155;color:#e2e8f0}
.date-divider::before,.date-divider::after{background:#334155}
.date-divider span{color:#64748b}
.input-wrap{background:#0f172a;border-color:#334155}
.search-bar{background:#1e293b;border-color:#334155}
.search-input{background:#0f172a;color:#e2e8f0;border-color:#334155}
.search-result{background:#0f172a;border-color:#334155}
.sr-who{color:#5cb3f0}.sr-text{color:#cbd5e1}.sr-time{color:#64748b}
.emoji-picker{background:#1e293b;border-color:#334155;box-shadow:0 4px 20px rgba(0,0,0,.4)}
.restored-bar{background:#1e3a5f;border-color:#1d4ed8;color:#93c5fd}
.typing-pill{background:#334155}
.name-popup{background:#1e293b;color:#e2e8f0}
.name-popup-title{color:#e2e8f0}
.name-popup-sub{color:#94a3b8}
.name-input{background:#0f172a;color:#e2e8f0;border-color:#334155}
.followup-chip{background:#334155;border-color:#1d4ed8;color:#93c5fd}
.followup-chip:hover{background:#1e3a5f}
.copy-btn{color:#64748b;border-color:#334155}
.copy-btn:hover{background:#334155;color:#5cb3f0;border-color:#5cb3f0}
.quick-label{color:#64748b}
.chip{background:#334155;border-color:#475569;color:#cbd5e1}
.chip:hover:not(:disabled){background:#1e3a5f;border-color:#5cb3f0;color:#93c5fd}
textarea{color:#e2e8f0}
textarea::placeholder{color:#64748b}
.ts{color:#64748b}
.cw-footer{color:#475569}
.typing-label{color:#64748b}
.search-empty{color:#64748b}
.cw-divider{background:#334155}
.error-bar{background:#2d1a1a;border-color:#7f1d1d;color:#fca5a5}
`;

// ── Common CSS ────────────────────────────────────
const COMMON_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Syne:wght@700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Nunito',sans-serif}
.demo-page{min-height:100vh;display:flex;align-items:center;justify-content:center;transition:background .3s}
.demo-content{text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;}
.demo-logo{margin-bottom:16px;animation:float 3s ease-in-out infinite;display:inline-block}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.demo-content h1{font-family:'Syne',sans-serif;font-size:48px;font-weight:800;letter-spacing:6px;margin-bottom:8px;}
.demo-content p{font-size:18px;margin-bottom:36px}
.demo-cards{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.demo-card{border-radius:12px;padding:12px 20px;font-size:14px;font-weight:600;transition:.2s}
.widget-container{position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;align-items:flex-end;gap:12px;z-index:9999;}
.fab{width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(26,111,196,.45);transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .2s;position:relative;flex-shrink:0;}
.fab:hover{transform:scale(1.1)}
.fab.fab-open{background:linear-gradient(135deg,#64748b,#475569);box-shadow:0 4px 12px rgba(0,0,0,.3)}
.unread-badge{position:absolute;top:-6px;right:-6px;min-width:22px;height:22px;border-radius:11px;background:#ef4444;border:2.5px solid #fff;font-size:11px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;padding:0 5px;animation:badgePop .4s cubic-bezier(.34,1.56,.64,1) both;font-family:'Nunito',sans-serif;}
@keyframes badgePop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
.name-popup{width:300px;border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.2);overflow:hidden;animation:slideUp .3s cubic-bezier(.34,1.2,.64,1) both;display:flex;flex-direction:column;align-items:center;}
.name-popup-logo{width:100%;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);padding:24px 0 20px;display:flex;justify-content:center;}
.name-popup-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;margin:20px 24px 4px;text-align:center;}
.name-popup-sub{font-size:13px;margin:0 24px 16px;text-align:center;}
.name-input{width:calc(100% - 48px);margin:0 24px;padding:11px 16px;border:1.5px solid;border-radius:12px;font-family:'Nunito',sans-serif;font-size:14px;outline:none;transition:border-color .2s;}
.name-input:focus{border-color:#93c5fd}
.name-input.shake{animation:shake .4s ease}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.name-start-btn{width:calc(100% - 48px);margin:12px 24px 24px;padding:12px;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);color:#fff;border:none;border-radius:12px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .2s;}
.name-start-btn:hover{opacity:.92;transform:translateY(-1px)}
.lang-btns{display:flex;gap:10px;margin:4px 24px 16px;width:calc(100% - 48px);}
.lang-btn{flex:1;padding:14px 10px;border:2px solid #e2e8f0;border-radius:14px;background:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;transition:all .18s;font-family:'Nunito',sans-serif;}
.lang-btn:hover{border-color:#93c5fd;background:#eff6ff;}
.lang-btn-active{border-color:#1a6fc4!important;background:linear-gradient(135deg,#eff6ff,#dbeafe)!important;box-shadow:0 2px 12px rgba(26,111,196,.2);}
.lang-flag{font-size:28px;line-height:1;}
.lang-native{font-size:13px;font-weight:700;color:#1a3a5c;}
.lang-selected{display:flex;align-items:center;gap:6px;margin:0 24px 12px;padding:7px 12px;background:#f1f5f9;border-radius:10px;font-size:13px;font-weight:600;color:#1a6fc4;cursor:pointer;width:calc(100% - 48px);transition:background .15s;}
.lang-selected:hover{background:#dbeafe;}
.lang-change{margin-left:auto;font-size:12px;}
@keyframes slideUp{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:none}}
.chat-window{width:370px;max-height:min(660px,84vh);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.2),0 4px 16px rgba(0,0,0,.1);display:flex;flex-direction:column;overflow:hidden;animation:slideUp .3s cubic-bezier(.34,1.2,.64,1) both;transition:background .3s,max-height .3s;}
.chat-window.minimized{max-height:64px!important;overflow:hidden}
.cw-header{background:linear-gradient(135deg,#1a6fc4,#5cb3f0);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.cw-header-left{display:flex;align-items:center;gap:10px}
.cw-header-actions{display:flex;align-items:center;gap:4px}
.cw-avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;padding:3px;}
.cw-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#fff}
.cw-sub{display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,.85);margin-top:2px}
.online-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;animation:pulse 2s ease-in-out infinite;flex-shrink:0;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.icon-btn{background:rgba(255,255,255,.15);border:none;cursor:pointer;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .2s;}
.icon-btn:hover{background:rgba(255,255,255,.28)}
.restored-bar{border-bottom:1px solid;padding:7px 16px;font-size:12px;display:flex;align-items:center;flex-shrink:0;}
.restored-bar button{background:none;border:none;cursor:pointer;font-weight:700;font-size:12px;text-decoration:underline;padding:0 0 0 4px;font-family:'Nunito',sans-serif;color:inherit;}
.search-bar{border-bottom:1px solid;padding:8px 12px;flex-shrink:0;position:relative;}
.search-input{width:100%;padding:8px 32px 8px 12px;border:1.5px solid;border-radius:10px;font-family:'Nunito',sans-serif;font-size:13px;outline:none;}
.search-close{position:absolute;right:20px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;}
.search-results{margin-top:8px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;}
.search-result{border:1px solid;border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:2px;cursor:pointer;}
.sr-who{font-size:10px;font-weight:700;text-transform:uppercase;}
.sr-text{font-size:12.5px;}
.sr-time{font-size:10px;}
.search-empty{font-size:13px;text-align:center;padding:8px 0;}
.cw-messages{flex:1;overflow-y:auto;padding:12px 14px 8px;display:flex;flex-direction:column;gap:2px;}
.cw-messages::-webkit-scrollbar{width:3px}
.cw-messages::-webkit-scrollbar-thumb{background:#e2e8f0;border-radius:3px}
.date-divider{display:flex;align-items:center;gap:8px;margin:10px 0 8px;}
.date-divider::before,.date-divider::after{content:'';flex:1;height:1px;}
.date-divider span{font-size:10.5px;font-weight:600;white-space:nowrap;}
.bubble-row{display:flex;align-items:flex-end;gap:8px;margin-bottom:6px;animation:bubbleIn .25s cubic-bezier(.34,1.56,.64,1) both;}
@keyframes bubbleIn{from{opacity:0;transform:translateY(8px) scale(.95)}to{opacity:1;transform:none}}
.bubble-row.user{flex-direction:row-reverse}
.bubble-col{display:flex;flex-direction:column;max-width:75%}
.bubble-row.user .bubble-col{align-items:flex-end}
.avatar{width:26px;height:26px;border-radius:50%;flex-shrink:0;margin-bottom:34px;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:2px;}
.bubble{padding:9px 13px;font-size:14px;line-height:1.6;word-break:break-word;white-space:pre-wrap;}
.bubble-user{border-radius:16px 16px 4px 16px;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);color:#fff;box-shadow:0 2px 10px rgba(26,111,196,.3);}
.bubble-meta{display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap;}
.meta-left{flex-direction:row}.meta-right{flex-direction:row-reverse}
.ts{font-size:10px;}
.copy-btn{display:flex;align-items:center;gap:3px;background:none;border:1px solid;border-radius:8px;padding:2px 6px;cursor:pointer;font-size:10px;font-family:'Nunito',sans-serif;font-weight:600;transition:all .15s;animation:fadeIn .15s ease;}
@keyframes fadeIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
.star-row{display:flex;gap:1px;align-items:center;}
.star-btn{background:none;border:none;cursor:pointer;padding:1px;display:flex;transition:transform .1s;}
.star-btn:hover{transform:scale(1.2)}
.rated-label{font-size:10px;color:#f59e0b;white-space:nowrap;}
.thumbs-row{display:flex;gap:3px;align-items:center;}
.thumb-btn{background:none;border:none;cursor:pointer;padding:2px;display:flex;opacity:.5;transition:opacity .2s,transform .15s;}
.thumb-btn:hover:not(:disabled){opacity:1;transform:scale(1.15)}
.thumb-btn:disabled{cursor:default}
.thumb-btn.active-up{opacity:1}.thumb-btn.active-down{opacity:1}
.followups{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;max-width:240px;}
.followup-chip{padding:5px 10px;border-radius:14px;border:1px solid;font-size:11.5px;font-family:'Nunito',sans-serif;font-weight:600;cursor:pointer;transition:all .15s;text-align:left;}
.typing-wrap{display:flex;flex-direction:column;gap:4px;}
.typing-pill{border-radius:16px 16px 16px 4px;padding:12px 16px;display:flex;gap:4px;align-items:center;width:fit-content;}
.typing-label{font-size:10.5px;font-style:italic;animation:fadePulse 1.5s ease-in-out infinite;}
@keyframes fadePulse{0%,100%{opacity:.6}50%{opacity:1}}
.dot{width:7px;height:7px;border-radius:50%;background:#94a3b8}
.d1{animation:bounce 1.2s 0s ease-in-out infinite}
.d2{animation:bounce 1.2s .2s ease-in-out infinite}
.d3{animation:bounce 1.2s .4s ease-in-out infinite}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}
.error-bar{margin:4px 14px;padding:9px 12px;border:1px solid;border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;}
.error-bar button{background:none;border:none;cursor:pointer;font-size:18px;line-height:1;color:inherit;}
.quick-bar{padding:8px 14px 4px;flex-shrink:0}
.quick-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.quick-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.quick-chips::-webkit-scrollbar{display:none}
.chip{padding:7px 14px;border-radius:16px;white-space:nowrap;flex-shrink:0;border:1.5px solid;font-family:'Nunito',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .16s;}
.chip:disabled{opacity:.4;cursor:not-allowed}
.cw-divider{height:1px;flex-shrink:0}
.emoji-picker{display:flex;flex-wrap:wrap;gap:4px;padding:10px 14px;border-top:1px solid;flex-shrink:0;}
.emoji-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:3px;border-radius:6px;transition:transform .1s;}
.emoji-btn:hover{transform:scale(1.3)}
.emoji-toggle{background:none;border:none;cursor:pointer;font-size:20px;padding:0 4px;flex-shrink:0;transition:transform .15s;}
.emoji-toggle:hover{transform:scale(1.2)}
.cw-input-row{display:flex;align-items:flex-end;gap:6px;padding:8px 14px 8px;flex-shrink:0;}
.input-wrap{flex:1;border:1.5px solid;border-radius:20px;padding:8px 14px;transition:border-color .2s;}
.input-wrap:focus-within{border-color:#93c5fd}
textarea{width:100%;border:none;outline:none;background:transparent;font-family:'Nunito',sans-serif;font-size:14px;resize:none;line-height:1.5;max-height:96px;overflow-y:auto;}
.voice-call-btn{background:rgba(255,255,255,.25)!important;}
.voice-call-btn:hover{background:rgba(255,255,255,.4)!important;}

/* ── Voice Call Modal ── */
.voice-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(4px);}
.voice-modal{background:#fff;border-radius:28px;padding:0 0 28px;width:320px;display:flex;flex-direction:column;align-items:center;box-shadow:0 32px 80px rgba(0,0,0,.3);overflow:hidden;animation:slideUp .3s cubic-bezier(.34,1.2,.64,1) both;}
.vm-header{width:100%;background:linear-gradient(135deg,#1a6fc4,#5cb3f0);padding:16px 20px;display:flex;align-items:center;gap:12px;margin-bottom:28px;}
.vm-title{flex:1;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#fff;}
.vm-close{background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:background .2s;}
.vm-close:hover{background:rgba(255,255,255,.35)}
.vm-orb-wrap{position:relative;width:140px;height:140px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;}
.vm-orb{width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .2s;box-shadow:0 8px 32px rgba(26,111,196,.4);}
.vm-orb:hover{transform:scale(1.06)}
.vm-orb-pulse{animation:orbPulse .9s ease-in-out infinite alternate;}
@keyframes orbPulse{from{transform:scale(1)}to{transform:scale(1.08)}}
.vm-ring{position:absolute;border-radius:50%;border:2px solid;opacity:0;animation:ringExpand 1.6s ease-out infinite;}
.vm-ring1{width:130px;height:130px;animation-delay:0s;}
.vm-ring2{width:140px;height:140px;animation-delay:.5s;}
@keyframes ringExpand{0%{transform:scale(.85);opacity:.6}100%{transform:scale(1.3);opacity:0}}
.vm-phase-label{font-size:14px;font-weight:600;color:#64748b;margin:4px 0 16px;font-family:'Nunito',sans-serif;}
.vm-bubble{width:calc(100% - 48px);padding:10px 14px;border-radius:14px;margin-bottom:8px;display:flex;flex-direction:column;gap:3px;}
.vm-user{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;}
.vm-bot{background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;}
.vm-bubble-who{font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;}
.vm-bubble-text{font-size:13px;color:#1e293b;line-height:1.5;font-family:'Nunito',sans-serif;}
.vm-error{font-size:12px;color:#ef4444;margin:4px 0;text-align:center;padding:0 24px;}
.vm-user-label{font-size:12px;color:#94a3b8;margin:8px 0 16px;font-family:'Nunito',sans-serif;}
.vm-end-btn{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:14px;padding:12px 32px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .2s;}
.vm-end-btn:hover{opacity:.9;transform:translateY(-1px)}

.voice-btn{width:40px;height:40px;border-radius:50%;border:none;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .2s;}
.voice-btn:hover{background:#dbeafe;color:#1a6fc4;}
.voice-btn.voice-listening{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;box-shadow:0 0 0 0 rgba(239,68,68,.4);animation:voicePulse 1s ease-in-out infinite;}
@keyframes voicePulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.4)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.send-btn{width:40px;height:40px;border-radius:50%;border:none;background:#e2e8f0;color:#94a3b8;display:flex;align-items:center;justify-content:center;cursor:not-allowed;flex-shrink:0;transition:all .2s;}
.send-btn.active{background:linear-gradient(135deg,#1a6fc4,#5cb3f0);color:#fff;cursor:pointer;box-shadow:0 3px 10px rgba(26,111,196,.4);}
.send-btn.active:hover{transform:scale(1.08)}
.cw-footer{text-align:center;font-size:10px;padding:0 0 10px;}
`;
