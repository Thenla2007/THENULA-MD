const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('thenuwa_token') || '';
let socket = null, toastTimer = null;
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function signedIn() {
  $('loginCard').hidden = true; $('dashboard').hidden = false;
  if (!socket) {
    socket = io();
    socket.on('status', renderStatus);
  }
  refresh();
}
function signedOut() {
  token = ''; sessionStorage.removeItem('thenuwa_token');
  $('loginCard').hidden = false; $('dashboard').hidden = true;
  if (socket) { socket.disconnect(); socket = null; }
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginNotice').textContent = 'Signing in…';
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    token = data.token; sessionStorage.setItem('thenuwa_token', token); $('password').value = ''; $('loginNotice').textContent = '';
    signedIn(); toast('Signed in successfully.');
  } catch (err) { $('loginNotice').textContent = err.message; }
});
function renderStatus(s) {
  const online = s.status === 'connected';
  $('headerStatus').textContent = s.status.toUpperCase();
  $('headerDot').className = 'dot' + (online ? ' online' : '');
  $('statusBadge').textContent = s.status.toUpperCase();
  $('statConnection').textContent = online ? 'Connected' : s.status.charAt(0).toUpperCase() + s.status.slice(1);
  $('statUptime').textContent = `Uptime ${formatTime(s.uptimeSeconds || 0)}`;
  $('statIn').textContent = s.messagesReceived ?? 0; $('statOut').textContent = s.messagesSent ?? 0;
  $('statCommands').textContent = s.commandsUsed ?? 0;
  $('qrCaption').textContent = online ? 'WhatsApp connected successfully' : s.status === 'qr' ? 'Scan this QR code in WhatsApp' : s.status === 'pairing' ? 'Enter the code in WhatsApp Linked Devices' : s.status === 'connecting' ? 'Connecting…' : 'Waiting for connection';
  if (online) { $('qrFrame').innerHTML = '<div class="qr-placeholder"><span>✓</span><b>WhatsApp connected</b><small>Your bot is online</small></div>'; $('pairCode').hidden = true; }
  else if (s.status !== 'qr') $('qrFrame').innerHTML = '<div class="qr-placeholder"><span>▦</span><b>QR code will appear here</b><small>Start connection to begin</small></div>';
  if (s.status === 'qr') loadQR();
  if (s.status !== 'pairing' && s.status !== 'connected') $('pairCode').hidden = true;
}
function formatTime(sec) { const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60; return `${h ? h+'h ' : ''}${m ? m+'m ' : ''}${s}s`; }
async function refresh() { try { const s = await api('/api/status'); renderStatus(s); await loadCommands(); } catch (err) { if (/sign in/i.test(err.message)) signedOut(); } }
async function loadQR() {
  try { const d = await api('/api/qr'); $('qrFrame').innerHTML = ''; const img = document.createElement('img'); img.alt = 'WhatsApp QR code'; img.src = d.qr; $('qrFrame').appendChild(img); }
  catch (err) { $('qrCaption').textContent = err.message; }
}
async function loadCommands() {
  try {
    const data = await api('/api/commands'); $('commandCount').textContent = `${String(data.commands.length).padStart(2,'0')} COMMANDS`;
    $('commandGrid').innerHTML = data.commands.map(c => `<article class="command-card"><div class="command-name"></div><div class="command-desc"></div><div class="command-category"></div></article>`).join('');
    [...$('commandGrid').children].forEach((card, i) => {
      const c = data.commands[i]; card.querySelector('.command-name').textContent = c.name;
      card.querySelector('.command-desc').textContent = c.description;
      card.querySelector('.command-category').textContent = c.category;
    });
  } catch {}
}
async function connect() {
  try { const d = await api('/api/connect', { method: 'POST', body: '{}' }); toast(d.message); setTimeout(refresh, 1000); }
  catch (e) { toast(e.message); }
}
$('heroConnect').addEventListener('click', () => { if (!token) $('loginCard').scrollIntoView({ behavior: 'smooth' }); else { $('connect').scrollIntoView({ behavior: 'smooth' }); connect(); } });
$('startBtn').addEventListener('click', connect);
$('pairBtn').addEventListener('click', async () => {
  const phone = $('phone').value.trim();
  if (!phone) return toast('Enter your WhatsApp number with country code.');
  $('pairBtn').disabled = true; $('pairBtn').textContent = 'Generating…';
  try {
    const d = await api('/api/pairing-code', { method: 'POST', body: JSON.stringify({ phone }) });
    $('pairCode').textContent = d.code; $('pairCode').hidden = false; $('qrFrame').innerHTML = '<div class="qr-placeholder"><span>⌁</span><b>Pairing code ready</b><small>Enter it in WhatsApp</small></div>'; $('qrCaption').textContent = 'WhatsApp → Linked devices → Link with phone number'; toast('Pairing code generated.');
  } catch (e) { toast(e.message); }
  finally { $('pairBtn').disabled = false; $('pairBtn').textContent = 'Generate pairing code'; }
});
$('disconnectBtn').addEventListener('click', async () => {
  if (!confirm('Disconnect this WhatsApp session?')) return;
  try { await api('/api/disconnect', { method: 'POST', body: '{}' }); toast('Disconnected.'); refresh(); } catch(e) { toast(e.message); }
});
$('logoutBtn').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {} signedOut(); toast('Signed out.'); });
$('aiForm').addEventListener('submit', async e => {
  e.preventDefault(); const prompt = $('aiPrompt').value.trim(); if (!prompt) return;
  $('aiAnswer').hidden = false; $('aiAnswer').textContent = 'Thinking…';
  try { const d = await api('/api/test-ai', { method: 'POST', body: JSON.stringify({ prompt }) }); $('aiAnswer').textContent = d.answer; }
  catch (err) { $('aiAnswer').textContent = err.message; }
});
if (token) signedIn();
