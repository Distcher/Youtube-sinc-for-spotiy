const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
/* Porta do servidor local que recebe eventos da extensão de navegador
   (content script em youtube.com). Precisa ser diferente da porta do
   callback OAuth (8888) acima. */
const BRIDGE_PORT = 8891;
const SPOTIFY_SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'playlist-read-private',
  'user-read-private'
].join(' ');
const SPOTIFY_BASE = 'https://api.spotify.com/v1';

let mainWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 480,
    minHeight: 560,
    title: 'YT → Spotify Sync',
    backgroundColor: '#0d0f12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

/* ---------- PKCE helpers ---------- */
function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest();
}
function randomVerifier(len = 64) {
  return base64UrlEncode(crypto.randomBytes(len)).slice(0, len);
}

/* ---------- Troca de código por tokens (processo principal = sem CORS) ---------- */
async function exchangeCodeForTokens(clientId, code, verifier) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Token exchange falhou: ${res.status} ${await res.text()}`);
  const tokens = await res.json();
  tokens.obtained_at = Date.now();
  return tokens;
}

/* ---------- Login: BrowserWindow de autorização ---------- */
function spotifyLogin(clientId) {
  return new Promise((resolve, reject) => {
    const verifier = randomVerifier(64);
    const challenge = base64UrlEncode(sha256(verifier));
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SPOTIFY_SCOPES
    });
    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

    const authWindow = new BrowserWindow({
      width: 480,
      height: 720,
      title: 'Conectar com Spotify',
      parent: mainWindow,
      modal: true,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    let settled = false;
    const finish = (fn) => {
      if (!settled) {
        settled = true;
        fn();
        try { authWindow.close(); } catch {}
      }
    };

    async function handleUrl(url) {
      if (!url.startsWith(REDIRECT_URI)) return;
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      if (error) { finish(() => reject(new Error(error))); return; }
      if (!code) return;
      try {
        const tokens = await exchangeCodeForTokens(clientId, code, verifier);
        finish(() => resolve(tokens));
      } catch (e) {
        finish(() => reject(e));
      }
    }

    authWindow.webContents.on('will-redirect', (_e, url) => handleUrl(url));
    authWindow.webContents.on('will-navigate', (_e, url) => handleUrl(url));
    authWindow.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
      if (url && url.startsWith(REDIRECT_URI)) handleUrl(url);
    });
    authWindow.on('closed', () => finish(() => reject(new Error('Login cancelado pelo usuário.'))));
    authWindow.loadURL(authUrl);
  });
}

/* ---------- Refresh token ---------- */
async function spotifyRefresh({ client_id, refresh_token }) {
  const body = new URLSearchParams({
    client_id,
    grant_type: 'refresh_token',
    refresh_token
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Falha ao renovar token: ${res.status}`);
  return res.json();
}

/* ---------- Proxy das chamadas à Spotify Web API (sem CORS no main process) ---------- */
async function spotifyFetch({ path: apiPath, method = 'GET', body, token }) {
  const res = await fetch(`${SPOTIFY_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------------------------------------------------------------
   Bridge local para a extensão de navegador
   ---------------------------------------------------------------------
   Uma página comum (renderer, file://) NÃO consegue ler o conteúdo de
   outra aba/processo do navegador (youtube.com) por segurança. A solução
   é o processo principal do Electron abrir um servidor HTTP só em
   127.0.0.1, que a extensão (rodando dentro de youtube.com, com
   permissão de host para 127.0.0.1) chama via fetch() quando o usuário
   clica no botão flutuante injetado na página do YouTube.

   Fluxo: extensão --POST /event--> servidor local (main.js) --IPC--> renderer
   (mesma função que hoje o botão "Simular reprodução" aciona).

   Segurança:
   - Só escuta em 127.0.0.1 (não é acessível de fora da máquina).
   - Exige um token de pareamento (gerado localmente e mostrado na UI do
     app) em cada requisição, para que só a extensão pareada consiga
     mandar eventos.
--------------------------------------------------------------------- */
let bridgeServer = null;
let pairingToken = null;

function pairingFilePath() {
  return path.join(app.getPath('userData'), 'pairing.json');
}

function loadOrCreatePairingToken() {
  const file = pairingFilePath();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.token === 'string' && data.token.length >= 16) return data.token;
  } catch {}
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ token }));
  } catch (e) {
    console.error('Não foi possível salvar o token de pareamento:', e.message);
  }
  return token;
}

function regeneratePairingToken() {
  pairingToken = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(pairingFilePath(), JSON.stringify({ token: pairingToken })); } catch {}
  return pairingToken;
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-YTS-Token');
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('Payload muito grande')); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function startBridgeServer() {
  pairingToken = loadOrCreatePairingToken();

  bridgeServer = http.createServer(async (req, res) => {
    withCors(res);

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, app: 'yt-spotify-sync-desktop' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/event') {
      if (req.headers['x-yts-token'] !== pairingToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token de pareamento inválido.' }));
        return;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload.title || typeof payload.title !== 'string') {
          throw new Error('Campo "title" é obrigatório.');
        }
        const track = {
          title: String(payload.title).slice(0, 300),
          channel: payload.channel ? String(payload.channel).slice(0, 300) : '',
          isMusicCategory: payload.isMusicCategory !== false,
          videoId: payload.videoId ? String(payload.videoId).slice(0, 32) : null
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yts:track', track);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Não encontrado' }));
  });

  bridgeServer.on('error', (e) => {
    console.error('Erro no servidor local da extensão (porta ocupada?):', e.message);
  });

  bridgeServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`Bridge da extensão ouvindo em http://127.0.0.1:${BRIDGE_PORT}`);
  });
}

/* ---------- IPC handlers ---------- */
ipcMain.handle('spotify:login',   (_e, clientId) => spotifyLogin(clientId));
ipcMain.handle('spotify:refresh', (_e, tokens)   => spotifyRefresh(tokens));
ipcMain.handle('spotify:fetch',   (_e, args)     => spotifyFetch(args));
ipcMain.handle('yts:pairing-info', () => ({ port: BRIDGE_PORT, token: pairingToken }));
ipcMain.handle('yts:regenerate-pairing-token', () => regeneratePairingToken());

app.whenReady().then(() => {
  createMainWindow();
  startBridgeServer();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
