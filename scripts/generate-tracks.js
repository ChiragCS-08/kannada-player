// Regenerates tracks.json from the live playlist using the owner's authorized
// refresh token (.env, local only). Run this after the playlist changes, then
// commit the updated tracks.json — GitHub Pages serves it as a static file.
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '1f0f58df47e7472dae2b20a76d2d7849';
const PLAYLIST_ID = '0UT7EGipZpUqJfc81YHROT';
const ENV_PATH = path.join(__dirname, '..', '.env');
const OUTPUT_PATH = path.join(__dirname, '..', 'tracks.json');

function loadEnv() {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
loadEnv();

const basicAuth = Buffer.from(`${CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');

async function getUserAccessToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN
    })
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + await res.text());
  return (await res.json()).access_token;
}

async function fetchPlaylistTracks(token) {
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

(async () => {
  const token = await getUserAccessToken();
  const tracks = await fetchPlaylistTracks(token);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tracks));
  console.log(`Wrote ${tracks.length} tracks to ${OUTPUT_PATH}`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
