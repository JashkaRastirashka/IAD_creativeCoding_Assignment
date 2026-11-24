let videoId = "watch?v=1A8HztiVc5M";
let message = "HELLO";
let mouseY = 0;

let video = document.getElementById("video");
let canvas = document.getElementById("canvas");
let ctx = canvas.getContext("2d"); // the "pen" we draw with

video.src =
  "https://www.youtube.com/embed/" + videoId +
  "?autoplay=1&mute=1&controls=0&loop=1&playlist=" + videoId + "&playsinline=1";

// replaces p5's map()
function map(value, inMin, inMax, outMin, outMax) {
  return outMin + (value - inMin) / (inMax - inMin) * (outMax - outMin);
}

// replaces p5's constrain()
function constrain(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // make the 16:9 video cover the whole window
  let w, h;
  if (window.innerWidth / window.innerHeight > 16 / 9) {
    w = window.innerWidth;
    h = w * 9 / 16;
  } else {
    h = window.innerHeight;
    w = h * 16 / 9;
  }
  video.style.width = w + "px";
  video.style.height = h + "px";
  video.style.left = (window.innerWidth - w) / 2 + "px";
  video.style.top = (window.innerHeight - h) / 2 + "px";
}

// replaces p5's built-in mouseY
window.addEventListener("mousemove", function (event) {
  mouseY = event.clientY;
});
window.addEventListener("resize", resize);

// replaces p5's draw(): runs once per frame
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height); // transparent again

  let size = map(mouseY, 0, canvas.height, 20, canvas.height * 0.4);
  size = constrain(size, 20, canvas.height * 0.4);

  ctx.fillStyle = "white";
  ctx.font = "bold " + size + "px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);

  requestAnimationFrame(draw); // ask the browser to call draw again
}

resize();
draw();


// 3D model von einem Fernseher


// mouse X = typeface thin or thick
// mouse Y = text bigger or smaller

// mousePressed = typeface change

// buttonPressed = switch video

// load video im hintergrund (embedded)
// bevor es laeuft TV static + Slice of Life Logo
