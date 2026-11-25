// ---------- put your YouTube video IDs here ----------
// For https://www.youtube.com/watch?v=dQw4w9WgXcQ the ID is dQw4w9WgXcQ
const VIDEO_ID_1 = '1A8HztiVc5M';
const VIDEO_ID_2 = 'nhBpBGhet4s&t=695s';

const fonts = ['Arial', 'Georgia', 'Courier New', 'Impact', 'Verdana'];

let helloCount = 1;
let stamps = [];
let currentVideo = 1;

let mouseX = 0;
let mouseY = 0;

let player1, player2;
let player1Box, player2Box;

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

function createVideoBox(id) {
  const box = document.createElement('div');
  box.id = id;
  box.style.width = '640px';
  box.style.height = '480px';
  box.style.margin = 'auto';
  document.body.appendChild(box);
  return box;
}

// ---------- DOM setup ----------
player1Box = createVideoBox('player1');
player2Box = createVideoBox('player2');
player2Box.style.display = 'none';

// Transparent layer that catches mouse events above the iframes
const overlay = document.createElement('div');
overlay.id = 'overlay';
document.body.appendChild(overlay);

// Moving text
const hello = document.createElement('div');
hello.textContent = 'HELLO ' + helloCount;
Object.assign(hello.style, {
  position: 'absolute',
  color: 'red',
  fontSize: '40px',
  zIndex: '10',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  transform: 'translate(-50%, -50%)',
  fontWeight: '100'
});
document.body.appendChild(hello);

// ---------- YouTube IFrame API ----------
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);

function makePlayer(elementId, videoId, autoplay) {
  return new YT.Player(elementId, {
    width: 640,
    height: 480,
    videoId: videoId,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      controls: 0,
      rel: 0,
      playsinline: 1,
      disablekb: 1
    },
    events: {
      onReady: (e) => e.target.mute(),
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

// The API calls this function automatically once it has loaded
function onYouTubeIframeAPIReady() {
  player1 = makePlayer('player1', VIDEO_ID_1, true);
  player2 = makePlayer('player2', VIDEO_ID_2, false);
}

// ---------- mouse move ----------
document.addEventListener('mousemove', (e) => {
  mouseX = e.pageX;
  mouseY = e.pageY;

  hello.style.left = mouseX + 'px';
  hello.style.top = mouseY + 'px';

  let weightValue = map(mouseX, 0, window.innerWidth, 100, 900);
  weightValue = constrain(weightValue, 100, 900);
  hello.style.fontWeight = Math.round(weightValue);
});

// ---------- keyboard: random font and colour ----------
document.addEventListener('keydown', () => {
  hello.style.fontFamily = fonts[Math.floor(random(fonts.length))];
  hello.style.color =
    `rgb(${Math.floor(random(256))}, ${Math.floor(random(256))}, ${Math.floor(random(256))})`;
});

// ---------- mouse: stamp text ----------
document.addEventListener('mousedown', () => {
  const stamp = document.createElement('div');
  stamp.textContent = 'HELLO ' + helloCount;

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
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '9'
  });

  document.body.appendChild(stamp);
  stamps.push(stamp);

  helloCount++;

  // Switch video after five stamps
  if (helloCount > 5) {
    stamps.forEach((s) => s.remove());
    stamps = [];

    if (currentVideo === 1) {
      player1.pauseVideo();
      player1Box.style.display = 'none';

      player2Box.style.display = 'block';
      player2.playVideo();

      currentVideo = 2;
    } else {
      player2.pauseVideo();
      player2Box.style.display = 'none';

      player1Box.style.display = 'block';
      player1.playVideo();

      currentVideo = 1;
    }

    helloCount = 1;
  }

  hello.textContent = 'HELLO ' + helloCount;
});