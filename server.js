const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

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
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;

async function getUserAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;
  if (!process.env.SPOTIFY_REFRESH_TOKEN) throw new Error('Not authorized yet. Visit /admin/login once.');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN
    })
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + await res.text());
  const data = await res.json();
  cachedAccessToken = data.access_token;
  accessTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedAccessToken;
}

async function fetchPlaylistTracks() {
  const token = await getUserAccessToken();
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?fields=next,items(item(uri,name,artists(name),album(images)))&limit=100`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Playlist fetch failed: ' + await res.text());
    const data = await res.json();
    for (const entry of data.items) {
      const track = entry.item;
      if (!track) continue;
      tracks.push({
        uri: track.uri,
        name: track.name,
        artists: track.artists.map(a => a.name).join(', '),
        image: track.album.images[0]?.url || ''
      });
    }
    url = data.next;
  }
  return tracks;
}

let cachedTracks = null;
let tracksCachedAt = 0;
const TRACKS_TTL = 5 * 60 * 1000;

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
      cachedTracks = null;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. You can close this tab.');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed: ' + err.message);
    }
    return;
  }

  if (urlPath === '/api/playlist-tracks') {
    try {
      if (!cachedTracks || Date.now() - tracksCachedAt > TRACKS_TTL) {
        cachedTracks = await fetchPlaylistTracks();
        tracksCachedAt = Date.now();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cachedTracks));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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
