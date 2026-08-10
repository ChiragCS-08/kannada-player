const CLIENT_ID = '1f0f58df47e7472dae2b20a76d2d7849';
const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const PLAYLIST_URI = 'spotify:playlist:0UT7EGipZpUqJfc81YHROT';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

const loginView = document.getElementById('login-view');
const playerView = document.getElementById('player-view');
const statusEl = document.getElementById('status');

function setStatus(msg) { statusEl.textContent = msg; }

// ---------- PKCE helpers ----------
function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const values = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) result += chars[values[i] % chars.length];
  return result;
}

async function redirectToAuth() {
  const verifier = randomString(64);
  sessionStorage.setItem('pkce_verifier', verifier);
  const challenge = base64url(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });

  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
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
  if (!res.ok) throw new Error('Token exchange failed: ' + await res.text());
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + await res.text());
  return res.json();
}

function saveTokens(data) {
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('expires_at', Date.now() + data.expires_in * 1000);
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
}

async function getValidAccessToken() {
  const expiresAt = Number(localStorage.getItem('expires_at') || 0);
  if (Date.now() < expiresAt - 30000) {
    return localStorage.getItem('access_token');
  }
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;
  const data = await refreshAccessToken(refreshToken);
  saveTokens(data);
  return data.access_token;
}

// ---------- Player UI ----------
let deviceId = null;

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function updateTrackUI(state) {
  if (!state) return;
  const track = state.track_window.current_track;
  document.getElementById('art').src = track.album.images[0]?.url || '';
  document.getElementById('track-name').textContent = track.name;
  document.getElementById('track-artist').textContent = track.artists.map(a => a.name).join(', ');
  document.getElementById('progress-fill').style.width = `${(state.position / state.duration) * 100}%`;
  document.getElementById('time-label').textContent = `${formatTime(state.position)} / ${formatTime(state.duration)}`;

  const playIcon = document.getElementById('play-icon');
  playIcon.innerHTML = state.paused
    ? '<path d="M8 5v14l11-7z"/>'
    : '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';

  const nextTrack = state.track_window.next_tracks[0];
  document.getElementById('up-next-name').textContent = nextTrack
    ? `${nextTrack.name} — ${nextTrack.artists.map(a => a.name).join(', ')}`
    : 'end of queue';

  document.getElementById('shuffle-btn').classList.toggle('active', !!state.shuffle);

  const repeatBtn = document.getElementById('repeat-btn');
  repeatBtn.classList.toggle('active', state.repeat_mode !== 0);
  repeatBtn.classList.toggle('repeat-one', state.repeat_mode === 2);
}

let progressInterval = null;

function startProgressTicker(player) {
  clearInterval(progressInterval);
  progressInterval = setInterval(async () => {
    const state = await player.getCurrentState();
    if (state && !state.paused) updateTrackUI(state);
  }, 1000);
}

async function initPlayer(token) {
  const player = new Spotify.Player({
    name: 'Now Playing Web Player',
    getOAuthToken: cb => cb(token),
    volume: 0.8
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    setStatus('Ready. Press play.');
  });

  player.addListener('not_ready', () => setStatus('Device offline.'));

  player.addListener('player_state_changed', state => {
    if (!state) return;
    updateTrackUI(state);
  });

  player.addListener('initialization_error', ({ message }) => setStatus('Init error: ' + message));
  player.addListener('authentication_error', ({ message }) => setStatus('Auth error: ' + message));
  player.addListener('account_error', ({ message }) => setStatus('Account error (Premium required): ' + message));

  await player.connect();
  startProgressTicker(player);

  document.getElementById('play-pause').onclick = async () => {
    const state = await player.getCurrentState();
    if (!state) {
      await apiPut(`/me/player/play?device_id=${deviceId}`, { context_uri: PLAYLIST_URI });
    } else {
      player.togglePlay();
    }
  };

  document.getElementById('next-btn').onclick = () => player.nextTrack();
  document.getElementById('prev-btn').onclick = () => player.previousTrack();

  document.getElementById('volume-slider').oninput = e => {
    player.setVolume(Number(e.target.value) / 100);
  };

  const volumeBtn = document.getElementById('volume-btn');
  const volumePopup = document.getElementById('volume-popup');
  volumeBtn.onclick = e => {
    e.stopPropagation();
    volumePopup.classList.toggle('open');
  };
  document.addEventListener('click', e => {
    if (!volumeBtn.contains(e.target) && !volumePopup.contains(e.target)) {
      volumePopup.classList.remove('open');
    }
  });

  document.getElementById('shuffle-btn').onclick = async () => {
    const state = await player.getCurrentState();
    const next = !(state && state.shuffle);
    await apiPut(`/me/player/shuffle?state=${next}&device_id=${deviceId}`);
  };

  document.getElementById('repeat-btn').onclick = async () => {
    const state = await player.getCurrentState();
    const modes = ['off', 'context', 'track'];
    const current = state ? state.repeat_mode : 0;
    const next = modes[(current + 1) % 3];
    await apiPut(`/me/player/repeat?state=${next}&device_id=${deviceId}`);
  };
}

async function apiPut(path, body) {
  const accessToken = await getValidAccessToken();
  await fetch(`https://api.spotify.com/v1${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// ---------- Boot ----------
async function boot() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    setStatus('Signing in...');
    const data = await exchangeCodeForToken(code);
    saveTokens(data);
    window.history.replaceState({}, document.title, '/');
  }

  const token = await getValidAccessToken();

  if (!token) {
    document.getElementById('login-btn').onclick = redirectToAuth;
    return;
  }

  loginView.style.display = 'none';
  playerView.style.display = 'block';

  window.onSpotifyWebPlaybackSDKReady = () => initPlayer(token);
  if (window.Spotify) initPlayer(token);
}

boot();
