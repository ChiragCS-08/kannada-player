const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const CLIENT_ID = '1f0f58df47e7472dae2b20a76d2d7849';
const PLAYLIST_ID = '0UT7EGipZpUqJfc81YHROT';
const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const SCOPES = 'playlist-read-private';
const ENV_PATH = path.join(__dirname, '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
loadEnv();

function saveRefreshToken(refreshToken) {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split('\n').filter(Boolean) : [];
  const filtered = lines.filter(line => !line.startsWith('SPOTIFY_REFRESH_TOKEN='));
  filtered.push(`SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
  fs.writeFileSync(ENV_PATH, filtered.join('\n') + '\n');
  process.env.SPOTIFY_REFRESH_TOKEN = refreshToken;
}

const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const basicAuth = () => Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

let pendingState = null;

http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = urlObj.pathname;

  if (urlPath === '/admin/login') {
    pendingState = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state: pendingState
    });
    res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${params.toString()}` });
    res.end();
    return;
  }

  if (urlPath === '/callback') {
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');

    if (error || !code || state !== pendingState) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Authorization failed or state mismatch. Try /admin/login again.');
      return;
    }
    pendingState = null;

    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth()}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI
        })
      });
      if (!tokenRes.ok) throw new Error(await tokenRes.text());
      const data = await tokenRes.json();
      saveRefreshToken(data.refresh_token);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. Run `node scripts/generate-tracks.js` to refresh tracks.json.');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed: ' + err.message);
    }
    return;
  }

  const filePath = path.join(__dirname, urlPath === '/' ? '/index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving on http://127.0.0.1:${PORT}`));
