// =====================================================
//  DATA: all videos and texts live in videos.csv
//  Format: one row per text line, "video,text"
//  Rows with the same video belong together, in order.
// =====================================================
const CSV_FILE = 'videos.csv?v=project1-content-update';
const requestedVideo = new URLSearchParams(window.location.search).get('video');

const fonts = [
  { family: 'TWK Ghost Hairline', style: 'normal' },
  { family: 'TWK Ghost Thin', style: 'normal' },
  { family: 'TWK Ghost Light', style: 'normal' },
  { family: 'TWK Ghost Regular', style: 'normal' },
  { family: 'TWK Ghost Medium', style: 'normal' },
  { family: 'TWK Ghost Bold', style: 'normal' },
  { family: 'TWK Ghost Black', style: 'normal' },
  { family: 'TWK Ghost Hairline Italic', style: 'italic' },
  { family: 'TWK Ghost Thin Italic', style: 'italic' },
  { family: 'TWK Ghost Light Italic', style: 'italic' },
  { family: 'TWK Ghost Italic', style: 'italic' },
  { family: 'TWK Ghost Medium Italic', style: 'italic' },
  { family: 'TWK Ghost Bold Italic', style: 'italic' },
  { family: 'TWK Ghost Black Italic', style: 'italic' }
];
const textColors = ['#d60036', '#b319ab', '#0057ba', '#1b8e13', '#fff'];
let fontIndex = -1;

let videos = [];        // [{ id: '...', lines: ['...', '...'] }, ...]
let videoIndex = 0;     // which video is playing
let lineIndex = 0;      // which line is next to be stamped
let stamps = [];

let mouseX = 0;
let mouseY = 0;

let player;
let dataLoaded = false;
let apiReady = false;

// ---------- helpers ----------
function map(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function constrain(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function random(max) {
  return Math.random() * max;
}

function shuffleVideosAfterFirst() {
  for (let i = videos.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(random(i));
    [videos[i], videos[j]] = [videos[j], videos[i]];
  }
}

// Accepts a plain ID or a full YouTube link
function extractVideoId(value) {
  const match = value.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return match ? match[1] : value.trim();
}

// Small CSV parser: handles quotes, commas inside quotes, and ; or , as separator
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');                       // remove BOM
  const firstLine = text.split(/\r?\n/)[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Turn CSV rows into the videos array (grouped by video, in order of first appearance)
function buildVideos(rows) {
  const groups = new Map();
  rows.slice(1).forEach((r) => {                            // skip header row
    const id = extractVideoId(r[0] || '');
    const line = r.slice(1).join(',').trim();                // text may contain unquoted commas
    if (!id || !line) return;                               // skip empty rows
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(line);
  });
  return [...groups].map(([id, lines]) => ({ id, lines }));
}

// ---------- DOM setup ----------
const PLAYER_WIDTH = 640, PLAYER_HEIGHT = 480;
function resizePlayer() {
  const scale = Math.min(1, window.innerWidth / PLAYER_WIDTH, window.innerHeight / PLAYER_HEIGHT);
  const width = Math.max(1, Math.floor(PLAYER_WIDTH * scale));
  const height = Math.max(1, Math.floor(PLAYER_HEIGHT * scale));
  wrapper.style.width = width + 'px';
  wrapper.style.height = height + 'px';
  if (player && typeof player.setSize === 'function') player.setSize(width, height);
  return { width, height };
}

const wrapper = document.createElement('div');
Object.assign(wrapper.style, {
  position: 'fixed',          // centered in the window, independent of page layout
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: '1'
});
const inner = document.createElement('div');
inner.id = 'player';
wrapper.appendChild(inner);
document.body.appendChild(wrapper);
window.addEventListener('resize', resizePlayer);
resizePlayer();

// Transparent layer that catches mouse events above the iframe
const overlay = document.createElement('div');
overlay.id = 'overlay';
document.body.appendChild(overlay);

// Moving text
const hello = document.createElement('div');
Object.assign(hello.style, {
  position: 'absolute',
  color: '#fff',
  fontSize: '40px',
  zIndex: '10',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  transform: 'translate(-50%, -50%)',
  fontWeight: '100'
});
document.body.appendChild(hello);

// ---------- loading: wait for BOTH the CSV and the YouTube API ----------
fetch(CSV_FILE)
  .then((res) => {
    if (!res.ok) throw new Error('Could not load ' + CSV_FILE);
    return res.text();
  })
  .then((text) => {
    videos = buildVideos(parseCSV(text));
    if (videos.length === 0) throw new Error('No videos found in ' + CSV_FILE);
    if (requestedVideo) {
      const videoId = extractVideoId(requestedVideo);
      const selectedVideo = videos.find((video) => video.id === videoId);
      if (!selectedVideo) throw new Error('Video not found in ' + CSV_FILE + ': ' + videoId);
      videos = [selectedVideo];
    } else {
      shuffleVideosAfterFirst();
    }
    dataLoaded = true;
    startIfReady();
  })
  .catch((err) => console.error(err));

const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);

// The YouTube API calls this automatically once it has loaded
function onYouTubeIframeAPIReady() {
  apiReady = true;
  startIfReady();
}

function notifyEmbeddedContent(type) {
  if (window.parent !== window) {
    window.parent.postMessage({ type }, window.location.origin);
  }
}

function startIfReady() {
  if (!dataLoaded || !apiReady) return;

  hello.textContent = videos[0].lines[0];
  const { width, height } = resizePlayer();

  player = new YT.Player('player', {
    width,
    height,
    videoId: videos[0].id,
    playerVars: {
      autoplay: 1,
      mute: 1,
      controls: 0,
      rel: 0,
      playsinline: 1,
      disablekb: 1,
      cc_load_policy: 0
    },
    events: {
      onReady: (e) => {
        e.target.mute();
        e.target.playVideo();
        notifyEmbeddedContent('project1-content-ready');
      },
      onError: (e) => {
        console.log('YouTube error code:', e.data);
        notifyEmbeddedContent('project1-content-error');
      },
      // Manual loop: restart when the video ends
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          e.target.seekTo(0);
          e.target.playVideo();
        }
      }
    }
  });
}

// ---------- mouse move ----------
document.addEventListener('mousemove', (e) => {
  mouseX = e.pageX;
  mouseY = e.pageY;

  hello.style.left = mouseX + 'px';
  hello.style.top = mouseY + 'px';

  // Text thickness controlled by mouseX
  let weightValue = map(mouseX, 0, window.innerWidth, 100, 900);
  weightValue = constrain(weightValue, 100, 900);
  hello.style.fontWeight = Math.round(weightValue);
});

// ---------- keyboard: cycle fonts and choose a pin colour ----------
document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  fontIndex = (fontIndex + 1) % fonts.length;
  const font = fonts[fontIndex];
  hello.style.fontFamily = '"' + font.family + '"';
  hello.style.fontStyle = font.style;
  hello.style.color = textColors[Math.floor(random(textColors.length))];
});

// ---------- mouse: stamp the current line ----------
document.addEventListener('mousedown', () => {
  if (!dataLoaded || !player) return;

  // Browsers only allow sound after a click, so unmute on the first click
  if (player.isMuted && player.isMuted()) {
    player.unMute();
    player.setVolume(100);
  }

  const currentVideo = videos[videoIndex];

  const stamp = document.createElement('div');
  stamp.textContent = currentVideo.lines[lineIndex];

  // Copy current appearance of the moving text
  const cs = getComputedStyle(hello);
  Object.assign(stamp.style, {
    position: 'absolute',
    left: mouseX + 'px',
    top: mouseY + 'px',
    transform: 'translate(-50%, -50%)',
    color: cs.color,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    fontStyle: cs.fontStyle,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '9'
  });

  document.body.appendChild(stamp);
  stamps.push(stamp);

  lineIndex++;

  // All lines of this video stamped: clear and go to the next video
  if (lineIndex >= currentVideo.lines.length) {
    stamps.forEach((s) => s.remove());
    stamps = [];

    videoIndex = (videoIndex + 1) % videos.length;   // wraps back to the first video
    lineIndex = 0;

    player.loadVideoById(videos[videoIndex].id);
  }

  // Moving text shows the next line to be stamped
  hello.textContent = videos[videoIndex].lines[lineIndex];
});