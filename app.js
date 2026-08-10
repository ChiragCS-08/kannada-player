const els = {
  art: document.getElementById('art'),
  name: document.getElementById('track-name'),
  artist: document.getElementById('track-artist'),
  fill: document.getElementById('progress-fill'),
  time: document.getElementById('time-label'),
  playIcon: document.getElementById('play-icon'),
  upNext: document.getElementById('up-next-name'),
  status: document.getElementById('status'),
  embedHost: document.getElementById('embed-host')
};

let tracks = [];
let currentIndex = 0;
let controller = null;
let advancing = false;

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function renderTrack() {
  const track = tracks[currentIndex];
  if (!track) return;
  els.art.src = track.image;
  els.name.textContent = track.name;
  els.artist.textContent = track.artists;
  const next = tracks[(currentIndex + 1) % tracks.length];
  els.upNext.textContent = next ? `${next.name} — ${next.artists}` : '—';
}

function loadIndex(index, autoplay) {
  currentIndex = (index + tracks.length) % tracks.length;
  advancing = false;
  renderTrack();
  controller.loadUri(tracks[currentIndex].uri);
  if (autoplay) controller.play();
}

window.onSpotifyIframeApiReady = (IFrameAPI) => {
  fetch('tracks.json')
    .then(res => res.json())
    .then(data => {
      tracks = data;
      if (!tracks.length) {
        els.status.textContent = 'Playlist unavailable.';
        return;
      }
      currentIndex = Math.floor(Math.random() * tracks.length);
      renderTrack();

      IFrameAPI.createController(els.embedHost, {
        uri: tracks[currentIndex].uri,
        width: '300',
        height: '152'
      }, embedController => {
        controller = embedController;
        els.status.textContent = 'Ready. Press play.';

        controller.addListener('playback_update', e => {
          const { position, duration, isPaused, isBuffering } = e.data;

          if (duration > 0) {
            els.fill.style.width = `${(position / duration) * 100}%`;
            els.time.textContent = `${formatTime(position)} / ${formatTime(duration)}`;
          }

          els.playIcon.innerHTML = isPaused
            ? '<path d="M8 5v14l11-7z"/>'
            : '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';

          els.status.textContent = isBuffering ? 'Buffering…' : '';

          if (!advancing && duration > 0 && position >= duration - 400 && isPaused) {
            advancing = true;
            loadIndex(currentIndex + 1, true);
          }
        });
      });
    })
    .catch(() => { els.status.textContent = 'Could not load playlist.'; });
};

document.getElementById('play-pause').onclick = () => controller && controller.togglePlay();
document.getElementById('next-btn').onclick = () => controller && loadIndex(currentIndex + 1, true);
document.getElementById('prev-btn').onclick = () => controller && loadIndex(currentIndex - 1, true);
