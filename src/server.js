require('dotenv').config();

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const pino = require('pino');
const QRCode = require('qrcode');
const OpenAI = require('openai');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

if (ADMIN_PASSWORD.length < 16) {
  console.warn('[SECURITY] Set ADMIN_PASSWORD to a long random password (at least 16 characters) in .env.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }));

const tokenStore = new Map();
const stats = { startedAt: Date.now(), messagesReceived: 0, messagesSent: 0, commandsUsed: 0 };
let sock = null;
let waAuthState = null;
let connecting = false;
let status = 'disconnected';
let currentQR = null;
let pairingCode = null;
let lastError = null;
let reconnectTimer = null;
let intentionalStop = false;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expiry = tokenStore.get(token);
  if (!expiry || expiry < Date.now()) {
    tokenStore.delete(token);
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  next();
}
function snapshot() {
  return {
    status, connected: status === 'connected', qrAvailable: Boolean(currentQR),
    pairingAvailable: Boolean(pairingCode), lastError,
    uptimeSeconds: Math.floor((Date.now() - stats.startedAt) / 1000),
    messagesReceived: stats.messagesReceived, messagesSent: stats.messagesSent,
    commandsUsed: stats.commandsUsed, aiEnabled: Boolean(openai),
    ownerConfigured: Boolean(OWNER_NUMBER)
  };
}
function broadcast() { io.emit('status', snapshot()); }

const COMMANDS = [
  { name: '.menu', description: 'Show all available commands', category: 'General' },
  { name: '.ping', description: 'Check whether the bot is responding', category: 'General' },
  { name: '.ai <question>', description: 'Ask the AI assistant (API key required)', category: 'AI' },
  { name: '.about', description: 'Show bot information', category: 'General' },
  { name: '.owner', description: 'Show owner contact if configured', category: 'General' }
];

function menuText() {
  return `╭─「 THENUWA XMD 」\n│ ✦ WhatsApp Assistant\n╰────────────\n\n` +
    COMMANDS.map(c => `${c.name}\n  ${c.description}`).join('\n\n') +
    '\n\nMade with THENUWA XMD';
}
async function sendText(jid, text) {
  if (!sock || status !== 'connected') return;
  await sock.sendMessage(jid, { text });
  stats.messagesSent++;
  broadcast();
}
async function handleMessage(msg) {
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') && msg.key.participant === undefined) return;
  const text = msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption || '';
  if (!text.trim()) return;
  stats.messagesReceived++;
  const command = text.trim().split(/\s+/)[0].toLowerCase();
  if (!command.startsWith('.')) { broadcast(); return; }
  stats.commandsUsed++;
  try {
    if (command === '.menu' || command === '.help') return sendText(jid, menuText());
    if (command === '.ping') return sendText(jid, 'Pong! ⚡ THENUWA XMD is online.');
    if (command === '.about') return sendText(jid, 'THENUWA XMD\nA personal WhatsApp bot dashboard.\nUse .menu to view commands.');
    if (command === '.owner') return sendText(jid, OWNER_NUMBER ? `Owner: https://wa.me/${OWNER_NUMBER}` : 'Owner contact has not been configured.');
    if (command === '.ai') {
      const prompt = text.trim().slice(command.length).trim();
      if (!prompt) return sendText(jid, 'Usage: .ai your question');
      if (!openai) return sendText(jid, 'AI is not enabled yet. Add OPENAI_API_KEY to .env and restart the server.');
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are THENUWA XMD, a helpful and concise WhatsApp assistant. Match the user language when possible.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      });
      return sendText(jid, completion.choices?.[0]?.message?.content?.trim() || 'Sorry, I could not generate a reply.');
    }
    return sendText(jid, 'Unknown command. Type .menu to see available commands.');
  } catch (err) {
    console.error('Message handler error:', err.message);
    try { await sendText(jid, 'Sorry, something went wrong. Please try again later.'); } catch {}
  } finally {
    broadcast();
  }
}

async function startWhatsApp() {
  if (connecting || status === 'connected') return;
  connecting = true;
  intentionalStop = false;
  status = 'connecting'; currentQR = null; pairingCode = null; lastError = null; broadcast();
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '..', 'auth_info'));
    waAuthState = state;
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
    sock = makeWASocket({
      version, auth: state, logger: pino({ level: 'silent' }),
      printQRInTerminal: false, browser: ['THENUWA XMD', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false, syncFullHistory: false
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        currentQR = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        pairingCode = null; status = 'qr'; broadcast();
      }
      if (connection === 'connecting') { status = 'connecting'; broadcast(); }
      if (connection === 'open') {
        status = 'connected'; currentQR = null; pairingCode = null; lastError = null;
        console.log('[WhatsApp] Connected');
        broadcast();
      }
      if (connection === 'close') {
        status = 'disconnected'; currentQR = null; pairingCode = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        lastError = lastDisconnect?.error?.message || 'Connection closed';
        broadcast();
        if (!intentionalStop && code !== DisconnectReason.loggedOut) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => { connecting = false; startWhatsApp(); }, 4000);
        } else if (code === DisconnectReason.loggedOut) {
          console.warn('[WhatsApp] Logged out. Delete auth_info only if you intend to pair again.');
        }
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) await handleMessage(msg);
    });
  } catch (err) {
    status = 'error'; lastError = err.message; broadcast();
    console.error('WhatsApp startup error:', err);
  } finally {
    connecting = false;
  }
}

app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'change-this-to-a-long-random-password') {
    return res.status(503).json({ error: 'Set a secure ADMIN_PASSWORD in .env before signing in.' });
  }
  if (!safeEqual(req.body?.password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Incorrect password.' });
  const token = makeToken();
  tokenStore.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.json({ token, expiresIn: 43200 });
});
app.post('/api/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  tokenStore.delete(token);
  res.json({ ok: true });
});
app.get('/api/status', requireAuth, (req, res) => res.json(snapshot()));
app.get('/api/qr', requireAuth, (req, res) => {
  if (!currentQR) return res.status(404).json({ error: 'QR is not ready yet. Start the connection and wait a moment.' });
  res.json({ qr: currentQR });
});
app.post('/api/connect', requireAuth, async (req, res) => {
  if (status === 'connected') return res.json({ ok: true, message: 'Already connected.' });
  startWhatsApp();
  res.json({ ok: true, message: 'Connection started. Wait for QR code to appear.' });
});
app.post('/api/pairing-code', requireAuth, async (req, res) => {
  const number = String(req.body?.phone || '').replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) return res.status(400).json({ error: 'Enter a phone number with country code, digits only.' });
  if (status === 'connected') return res.status(400).json({ error: 'Bot is already connected.' });
  if (!sock || !waAuthState?.creds) {
    startWhatsApp();
    return res.status(409).json({ error: 'WhatsApp is starting. Wait a few seconds and try pairing again.' });
  }
  try {
    const code = await sock.requestPairingCode(number);
    pairingCode = code;
    currentQR = null; status = 'pairing'; broadcast();
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: 'Could not create pairing code. Start connection, wait, then retry. ' + err.message });
  }
});
app.post('/api/disconnect', requireAuth, async (req, res) => {
  intentionalStop = true;
  clearTimeout(reconnectTimer);
  try { if (sock) await sock.logout(); } catch (err) { console.warn('Logout:', err.message); }
  sock = null; waAuthState = null; status = 'disconnected'; currentQR = null; pairingCode = null; broadcast();
  res.json({ ok: true });
});
app.get('/api/commands', requireAuth, (req, res) => res.json({ commands: COMMANDS }));
app.post('/api/test-ai', requireAuth, async (req, res) => {
  if (!openai) return res.status(400).json({ error: 'AI is disabled. Add OPENAI_API_KEY to .env and restart.' });
  const prompt = String(req.body?.prompt || '').slice(0, 2000);
  if (!prompt.trim()) return res.status(400).json({ error: 'Enter a message.' });
  try {
    const result = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are THENUWA XMD, a helpful concise assistant.' }, { role: 'user', content: prompt }],
      max_tokens: 500
    });
    res.json({ answer: result.choices?.[0]?.message?.content || '' });
  } catch (err) { res.status(502).json({ error: 'AI request failed. Check API key and model settings.' }); }
});

io.on('connection', socket => socket.emit('status', snapshot()));
server.listen(PORT, HOST, () => {
  console.log(`\nTHENUWA XMD dashboard: http://${HOST}:${PORT}`);
  console.log('Keep this terminal open while using the bot.\n');
});
