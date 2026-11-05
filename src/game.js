import * as THREE from 'three';

/* =========================================================================
   NEON RUSH
   A 3-lane synthwave endless runner.
   Built from the supplied Unity-style PlayerController: lane switching,
   continuous forward acceleration, jumping, coins and a game-over panel.
   ========================================================================= */

const LANES = [-2.6, 0, 2.6];
const START_SPEED = 8;
const MAX_SPEED = 20;
const SPEED_RATE = 0.12;
const GRAVITY = -30;
const JUMP_HEIGHT = 2.15;
const ROAD_LENGTH = 280;
const ROAD_TILE = 8.4;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const damp = (a, b, lambda, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const app = document.getElementById('app');
const canvas = document.getElementById('scene');
const ui = {
  distance: document.getElementById('distanceValue'),
  coins: document.getElementById('coinValue'),
  coinPill: document.getElementById('coinPill'),
  coinToast: document.getElementById('coinToast'),
  speed: document.getElementById('speedValue'),
  speedBar: document.getElementById('speedBar'),
  menu: document.getElementById('menuScreen'),
  gameover: document.getElementById('gameoverScreen'),
  pause: document.getElementById('pauseScreen'),
  play: document.getElementById('playBtn'),
  retry: document.getElementById('retryBtn'),
  home: document.getElementById('homeBtn'),
  resume: document.getElementById('resumeBtn'),
  quit: document.getElementById('quitBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  soundBtn: document.getElementById('soundBtn'),
  finalScore: document.getElementById('finalScore'),
  finalDistance: document.getElementById('finalDistance'),
  finalCoins: document.getElementById('finalCoins'),
  finalSpeed: document.getElementById('finalSpeed'),
  finalQuip: document.getElementById('resultQuip'),
  newBest: document.getElementById('newBest'),
  menuBest: document.getElementById('menuBest'),
  menuDistance: document.getElementById('menuDistance'),
  goBurst: document.getElementById('goBurst'),
  flash: document.querySelector('.fx-flash'),
  rotateHint: document.getElementById('rotateHint'),
};

/* -------------------------------------------------------------------------
   Persistence
   ------------------------------------------------------------------------- */
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
const records = {
  bestScore: Number(store.get('neonrush.bestScore', 0)) || 0,
  bestDistance: Number(store.get('neonrush.bestDistance', 0)) || 0,
};

/* -------------------------------------------------------------------------
   Tiny WebAudio synth — all sfx and music are generated, no assets.
   ------------------------------------------------------------------------- */
class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.enabled = true;
    this.musicTimer = null;
    this.step = 0;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.42 : 0;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.42;
    this.musicGain.connect(this.master);
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
  }

  resume() {
    this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.enabled ? 0.42 : 0, this.ctx.currentTime, 0.03);
    }
    return this.enabled;
  }

  tone(freq, dur, type = 'sine', gain = 0.1, slideTo = null, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.2, gain = 0.08, filterFreq = 900, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const size = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  coin(streak = 0) {
    const base = 740 * Math.pow(1.045, Math.min(streak, 14));
    this.tone(base, 0.1, 'sine', 0.13);
    this.tone(base * 1.5, 0.16, 'sine', 0.075, base * 1.76, 0.045);
  }

  jump() {
    this.tone(220, 0.2, 'triangle', 0.08, 660);
    this.noise(0.12, 0.035, 1400);
  }

  land() {
    this.noise(0.1, 0.045, 500);
    this.tone(90, 0.1, 'sine', 0.06, 55);
  }

  slide() {
    this.noise(0.28, 0.07, 2200);
    this.tone(420, 0.22, 'sawtooth', 0.025, 130);
  }

  hit() {
    this.noise(0.55, 0.22, 900);
    this.tone(72, 0.55, 'sawtooth', 0.13, 32);
    this.tone(140, 0.35, 'square', 0.05, 48);
  }

  click() {
    this.tone(680, 0.06, 'square', 0.035);
    this.tone(1020, 0.08, 'sine', 0.03, 1100, 0.03);
  }

  startMusic() {
    this.resume();
    if (!this.ctx || this.musicTimer) return;
    this.musicTimer = setInterval(() => this.musicStep(), 185);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  musicStep() {
    if (!this.ctx || !this.enabled || app.dataset.state !== 'playing') return;
    const s = this.step++;
    const arp = [220, 329.63, 440, 329.63, 261.63, 392, 523.25, 392, 246.94, 369.99, 493.88, 369.99, 196, 293.66, 392, 587.33];
    const bass = [55, 55, 65.41, 49, 55, 55, 73.42, 49];
    this.tone(arp[s % 16], 0.14, 'triangle', 0.024);
    if (s % 4 === 0) this.tone(bass[Math.floor(s / 8) % 8], 0.5, 'sine', 0.055);
    if (s % 2 === 0) this.noise(0.035, 0.012, 7000);
    if (s % 8 === 4) this.noise(0.09, 0.02, 3000);
  }
}
const synth = new Synth();

/* -------------------------------------------------------------------------
   Renderer / camera / scene
   ------------------------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a0729, 0.0088);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 420);
camera.position.set(0, 3.45, 7.6);

const clock = new THREE.Clock();

/* -------------------------------------------------------------------------
   Shared texture helpers
   ------------------------------------------------------------------------- */
function textureFromCanvas(canvasEl, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvasEl);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.86)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return textureFromCanvas(c, { srgb: false });
}
const GLOW_TEX = makeGlowTexture();

function makeSoftShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return textureFromCanvas(c, { srgb: false });
}
const SHADOW_TEX = makeSoftShadowTexture();

function glowSprite(color, size, opacity = 0.7) {
  const m = new THREE.SpriteMaterial({
    map: GLOW_TEX,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}

function standard(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.52,
    metalness: 0.28,
    ...opts,
  });
}

function neon(color, intensity = 2.2) {
  return new THREE.MeshStandardMaterial({
    color: 0x101018,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0.2,
  });
}

function addBox(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/* -------------------------------------------------------------------------
   Sky, stars, synth sun, distant skyline
   ------------------------------------------------------------------------- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x0a0322) },
    midColor: { value: new THREE.Color(0x2e0b55) },
    horizonColor: { value: new THREE.Color(0xd12f7c) },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 midColor;
    uniform vec3 horizonColor;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition).y;
      vec3 col = mix(horizonColor, midColor, smoothstep(-0.03, 0.20, h));
      col = mix(col, topColor, smoothstep(0.12, 0.72, h));
      float glow = smoothstep(0.16, 0.0, abs(h - 0.015));
      col += vec3(0.24, 0.045, 0.12) * glow;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 20), skyMat);
scene.add(sky);

// stars
{
  const count = 620;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const colors = [new THREE.Color(0xc9f7ff), new THREE.Color(0xffbfea), new THREE.Color(0xffffff), new THREE.Color(0xffe3af)];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const y = rand(0.06, 0.95);
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(theta) * r * 320;
    pos[i * 3 + 1] = y * 320 + 8;
    pos[i * 3 + 2] = Math.sin(theta) * r * 320;
    const c = colors[randInt(0, colors.length - 1)];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.25,
    map: GLOW_TEX,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
}

// synthwave sun
function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 90, 0, 440);
  g.addColorStop(0, '#fff6a6');
  g.addColorStop(0.35, '#ffb347');
  g.addColorStop(0.66, '#ff397d');
  g.addColorStop(1, '#d100a8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(256, 256, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) {
    const y = 286 + i * 22;
    ctx.fillRect(0, y, 512, 5 + i * 1.4);
  }
  return textureFromCanvas(c, { srgb: true });
}
{
  const sunMat = new THREE.SpriteMaterial({
    map: makeSunTexture(),
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0.92,
  });
  const sun = new THREE.Sprite(sunMat);
  sun.position.set(24, 23, -205);
  sun.scale.set(66, 66, 1);
  scene.add(sun);
  const halo = glowSprite(0xff4d9d, 150, 0.34);
  halo.position.set(24, 23, -206);
  scene.add(halo);
  const halo2 = glowSprite(0xff9a5b, 82, 0.3);
  halo2.position.set(24, 23, -205.5);
  scene.add(halo2);
}

// distant skyline silhouettes
function makeWindowTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#080314';
  ctx.fillRect(0, 0, 128, 256);
  const palette = ['#39f6ff', '#ff5bd4', '#ffcf5a', '#9e8bff', '#ff9d6b'];
  let s = seed;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 7; col++) {
      if (r() < 0.29) {
        ctx.fillStyle = palette[Math.floor(r() * palette.length)];
        ctx.globalAlpha = 0.22 + r() * 0.56;
        const w = r() < 0.25 ? 12 : 8;
        ctx.fillRect(6 + col * 18, 6 + row * 12, w, r() < 0.2 ? 7 : 4);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(5,1,16,0.24)';
  for (let col = 0; col < 8; col++) ctx.fillRect(2 + col * 17, 0, 2, 256);
  return textureFromCanvas(c);
}
const windowTextures = [makeWindowTexture(11), makeWindowTexture(77), makeWindowTexture(209)];

{
  const count = 26;
  for (let i = 0; i < count; i++) {
    const w = rand(4, 13);
    const h = rand(5, 30);
    const mat = new THREE.MeshBasicMaterial({
      map: windowTextures[i % 3],
      fog: true,
      color: 0xb9a9e6,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, rand(3, 8)), mat);
    m.position.set(rand(-95, 95), -8 + h / 2, rand(-215, -165));
    scene.add(m);
  }
}

/* lights */
const hemi = new THREE.HemisphereLight(0xffa1e2, 0x1a0a34, 1.45);
scene.add(hemi);

// soft chase light that keeps the runner readable from behind
const playerFill = new THREE.PointLight(0x8fdcff, 7, 14, 2);
playerFill.position.set(0, 3.4, 5.8);
scene.add(playerFill);

const sunLight = new THREE.DirectionalLight(0xffb08a, 2.5);
sunLight.position.set(14, 27, 16);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -16;
sunLight.shadow.camera.right = 16;
sunLight.shadow.camera.top = 16;
sunLight.shadow.camera.bottom = -16;
sunLight.shadow.camera.near = 2;
sunLight.shadow.camera.far = 70;
sunLight.shadow.bias = -0.0012;
sunLight.shadow.normalBias = 0.035;
sunLight.target.position.set(0, 0, -4);
scene.add(sunLight, sunLight.target);

const cyanLight = new THREE.PointLight(0x39f6ff, 18, 26, 2);
cyanLight.position.set(-5.5, 3.2, 1);
scene.add(cyanLight);
const magentaLight = new THREE.PointLight(0xff2fd0, 22, 30, 2);
magentaLight.position.set(6, 4.5, -4);
scene.add(magentaLight);
const warmRim = new THREE.PointLight(0xffb25e, 13, 24, 2);
warmRim.position.set(0, 5, -12);
scene.add(warmRim);

/* -------------------------------------------------------------------------
   Road, neon rails, bridge and arches
   ------------------------------------------------------------------------- */
function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0716';
  ctx.fillRect(0, 0, 512, 1024);
  // asphalt grain
  for (let i = 0; i < 4200; i++) {
    const v = randInt(12, 36);
    ctx.fillStyle = `rgba(${v + 4},${v},${v + 14},${rand(0.05, 0.22)})`;
    ctx.fillRect(rand(0, 512), rand(0, 1024), rand(1, 2.4), rand(1, 4));
  }
  // faint tire sheen
  const sheen = ctx.createLinearGradient(0, 0, 512, 0);
  sheen.addColorStop(0, 'rgba(70,20,90,0.16)');
  sheen.addColorStop(0.2, 'rgba(30,20,50,0)');
  sheen.addColorStop(0.5, 'rgba(80,100,140,0.08)');
  sheen.addColorStop(0.8, 'rgba(30,20,50,0)');
  sheen.addColorStop(1, 'rgba(70,20,90,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 1024);
  // lane dividers (road is 10.4 wide, lanes 2.6)
  ctx.fillStyle = 'rgba(225,245,255,0.55)';
  for (const x of [0.355, 0.645]) {
    for (let y = 0; y < 1024; y += 108) {
      ctx.fillRect(512 * x - 2, y, 4, 52);
    }
  }
  // outer lines
  ctx.fillStyle = 'rgba(57,246,255,0.42)';
  ctx.fillRect(9, 0, 3, 1024);
  ctx.fillRect(500, 0, 3, 1024);
  // subtle chevrons
  ctx.strokeStyle = 'rgba(140,240,255,0.045)';
  ctx.lineWidth = 5;
  for (let y = -60; y < 1024; y += 170) {
    ctx.beginPath();
    ctx.moveTo(90, y + 60);
    ctx.lineTo(256, y);
    ctx.lineTo(422, y + 60);
    ctx.stroke();
  }
  return textureFromCanvas(c, { repeat: true });
}
const roadTex = makeRoadTexture();
roadTex.repeat.set(1, ROAD_LENGTH / ROAD_TILE);
const roadMat = new THREE.MeshStandardMaterial({
  map: roadTex,
  color: 0xded6f2,
  roughness: 0.46,
  metalness: 0.42,
});
const road = new THREE.Mesh(new THREE.PlaneGeometry(10.4, ROAD_LENGTH), roadMat);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -ROAD_LENGTH / 2 + 24);
road.receiveShadow = true;
scene.add(road);

// ground far below the elevated track
const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a0416, roughness: 0.92, metalness: 0.12 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(460, 460), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -8.4, -100);
scene.add(ground);

// shoulders
const shoulderMat = standard(0x100a22, { roughness: 0.8, metalness: 0.2 });
const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, ROAD_LENGTH), shoulderMat);
shoulderL.position.set(-6.05, -0.22, -ROAD_LENGTH / 2 + 24);
shoulderL.receiveShadow = true;
scene.add(shoulderL);
const shoulderR = shoulderL.clone();
shoulderR.position.x = 6.05;
scene.add(shoulderR);

// neon rail lines
function neonStrip(x, color) {
  const mat = neon(color, 2.8);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, ROAD_LENGTH), mat);
  bar.position.set(x, 0.055, -ROAD_LENGTH / 2 + 24);
  scene.add(bar);

  const glowMat = new THREE.MeshBasicMaterial({
    map: GLOW_TEX,
    color,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, ROAD_LENGTH), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.065, -ROAD_LENGTH / 2 + 24);
  scene.add(glow);
}
neonStrip(-5.14, 0x39f6ff);
neonStrip(5.14, 0xff2fd0);

// side barrier blocks with scrolling light slots
function makeBarrierTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0718';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#39f6ff';
  for (let y = 8; y < 256; y += 42) ctx.fillRect(8, y, 48, 7);
  ctx.fillStyle = 'rgba(255,47,208,0.8)';
  for (let y = 28; y < 256; y += 42) ctx.fillRect(22, y, 20, 3);
  return textureFromCanvas(c, { repeat: true });
}
const sideBarTex = makeBarrierTexture();
sideBarTex.repeat.set(1, 24);
const sideBarMat = new THREE.MeshStandardMaterial({
  map: sideBarTex,
  color: 0xb9aed8,
  roughness: 0.42,
  metalness: 0.55,
  emissive: 0xffffff,
  emissiveMap: sideBarTex,
  emissiveIntensity: 0.35,
});
for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.05, ROAD_LENGTH), sideBarMat);
  wall.position.set(side * 5.62, 0.4, -ROAD_LENGTH / 2 + 24);
  wall.receiveShadow = true;
  scene.add(wall);
}

// bridge pylons
const pylonMat = standard(0x130c2a, { roughness: 0.8, metalness: 0.3 });
const pylonAccent = neon(0x39f6ff, 1.25);
const pylons = [];
for (let i = 0; i < 16; i++) {
  const g = new THREE.Group();
  addBox(g, 0.62, 8.6, 0.62, -5.82, -4.2, 0, pylonMat);
  addBox(g, 0.62, 8.6, 0.62, 5.82, -4.2, 0, pylonMat);
  addBox(g, 12.1, 0.35, 0.7, 0, -0.55, 0, pylonMat);
  addBox(g, 0.08, 3.6, 0.08, -5.82, -3.5, 0.36, pylonAccent);
  addBox(g, 0.08, 3.6, 0.08, 5.82, -3.5, 0.36, pylonAccent);
  g.position.z = 20 - i * 17.5;
  scene.add(g);
  pylons.push(g);
}

// arches over the track
const arches = [];
const archDark = standard(0x160d2f, { roughness: 0.55, metalness: 0.55 });
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  const accentColor = i % 3 === 0 ? 0x39f6ff : i % 3 === 1 ? 0xff2fd0 : 0xffa63b;
  const accent = neon(accentColor, 2.4);
  addBox(g, 0.34, 7.7, 0.34, -5.75, 3.7, 0, archDark);
  addBox(g, 0.34, 7.7, 0.34, 5.75, 3.7, 0, archDark);
  addBox(g, 11.6, 0.36, 0.36, 0, 7.4, 0, archDark);
  addBox(g, 0.09, 5.8, 0.09, -5.55, 4.0, 0.2, accent);
  addBox(g, 0.09, 5.8, 0.09, 5.55, 4.0, 0.2, accent);
  addBox(g, 9.9, 0.09, 0.09, 0, 7.2, 0.2, accent);
  const glow = glowSprite(accentColor, 3.2, 0.18);
  glow.position.set(0, 7.3, 0.3);
  g.add(glow);
  g.position.z = 10 - i * 29;
  scene.add(g);
  arches.push(g);
}

/* -------------------------------------------------------------------------
   Scrolling city
   ------------------------------------------------------------------------- */
const buildings = [];
const buildingBaseMats = windowTextures.map((tex) => new THREE.MeshStandardMaterial({
  map: tex,
  emissiveMap: tex,
  emissive: 0xffffff,
  emissiveIntensity: 0.5,
  color: 0x8d7fbe,
  roughness: 0.82,
  metalness: 0.16,
}));

function placeBuilding(b, first = false) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const w = rand(5, 10);
  const h = rand(8, 34);
  const d = rand(5, 11);
  b.scale.set(w, h, d);
  b.position.x = side * rand(11.5, 34);
  b.position.y = -8.2 + h / 2;
  b.position.z = first ? rand(-210, 30) : rand(-235, -195);
  b.userData.side = side;
  b.userData.h = h;
  b.userData.w = w;
  if (b.userData.roof) {
    b.userData.roof.position.set(0, 0.5 + 0.03, 0);
    b.userData.roof.material.color.setHex(Math.random() < 0.55 ? 0x39f6ff : 0xff2fd0);
  }
  if (b.userData.antenna) {
    b.userData.antenna.position.set(rand(-0.35, 0.35), 0.5 + 0.16, rand(-0.35, 0.35));
  }
}
{
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 44; i++) {
    const b = new THREE.Mesh(unit, buildingBaseMats[i % 3]);
    b.castShadow = false;
    b.receiveShadow = false;
    const roofMat = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x39f6ff : 0xff2fd0, fog: true });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.55), roofMat);
    roof.position.y = 0.53;
    b.add(roof);
    const antennaMat = neon(0xffb04a, 1.2);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 5), antennaMat);
    antenna.position.y = 0.65;
    if (i % 3 === 0) b.add(antenna);
    b.userData.roof = roof;
    b.userData.antenna = antenna;
    placeBuilding(b, true);
    scene.add(b);
    buildings.push(b);
  }
}

// neon signs on poles
function makeSignTexture(text, sub, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.font = '900 92px Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 110);
  ctx.font = '700 24px Arial, sans-serif';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(sub, 256, 196);
  return textureFromCanvas(c, { srgb: true });
}
const signDefs = [
  ['NEON', 'NIGHT DISTRICT', '#39f6ff'],
  ['RUSH', 'NO BRAKES', '#ff5bd4'],
  ['24/7', 'OPEN ALL NIGHT', '#ffcf5a'],
  ['GOLD', 'FOLLOW THE LIGHT', '#ffd54a'],
  ['未来', 'SECTOR 09', '#ff4fd8'],
  ['سرعة', 'طريق النيون', '#7fffd4'],
  ['TURBO', 'MAX VELOCITY', '#ff8a4a'],
];
const signs = [];
for (let i = 0; i < 10; i++) {
  const def = signDefs[i % signDefs.length];
  const color = new THREE.Color(def[2]);
  const g = new THREE.Group();
  const panelMat = standard(0x0b0619, { roughness: 0.45, metalness: 0.5 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 0.16), panelMat);
  g.add(panel);
  const faceMat = new THREE.MeshBasicMaterial({
    map: makeSignTexture(def[0], def[1], def[2]),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.95), faceMat);
  face.position.z = 0.1;
  g.add(face);
  const glow = glowSprite(color, 6.5, 0.23);
  glow.position.z = 0.18;
  g.add(glow);
  const poleMat = standard(0x120b26, { metalness: 0.6, roughness: 0.5 });
  addBox(g, 0.16, 7.5, 0.16, 0, -3.9, -0.18, poleMat);
  g.userData.face = face;
  g.userData.glow = glow;
  g.userData.signColor = color;
  placeSign(g, true);
  scene.add(g);
  signs.push(g);
}
function placeSign(g, first = false) {
  const side = Math.random() < 0.5 ? -1 : 1;
  g.position.set(side * rand(8.2, 12.5), rand(5.8, 12.5), first ? rand(-190, 10) : rand(-230, -190));
  g.rotation.y = side * rand(-0.18, 0.18);
  g.scale.setScalar(rand(0.85, 1.3));
}

/* -------------------------------------------------------------------------
   Ambient dust and speed streaks
   ------------------------------------------------------------------------- */
const dust = (() => {
  const count = 170;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const colors = [new THREE.Color(0x39f6ff), new THREE.Color(0xff5bd4), new THREE.Color(0xffd36b), new THREE.Color(0xa58bff)];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rand(-18, 18);
    pos[i * 3 + 1] = rand(-3, 13);
    pos[i * 3 + 2] = rand(-100, 12);
    const c = colors[randInt(0, 3)];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.11,
    map: GLOW_TEX,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  }));
  scene.add(pts);
  return pts;
})();

/* -------------------------------------------------------------------------
   The runner
   ------------------------------------------------------------------------- */
const runner = {
  root: new THREE.Group(),
  body: new THREE.Group(),
  leftHip: new THREE.Group(),
  rightHip: new THREE.Group(),
  leftKnee: new THREE.Group(),
  rightKnee: new THREE.Group(),
  leftArm: new THREE.Group(),
  rightArm: new THREE.Group(),
  scarf: [],
  x: 0,
  lane: 1,
  jumpY: 0,
  vy: 0,
  grounded: true,
  slideTimer: 0,
  phase: 0,
  lateralVel: 0,
};
const suitMat = standard(0x1a254d, { roughness: 0.72, metalness: 0.08 });
const jacketMat = standard(0x086577, { roughness: 0.7, metalness: 0.06, emissive: 0x05424f, emissiveIntensity: 0.55 });
const darkMat = standard(0x080b1c, { roughness: 0.42, metalness: 0.45 });
const packMat = standard(0x11162c, { roughness: 0.88, metalness: 0.08 });
const skinMat = standard(0xd79b78, { roughness: 0.6, metalness: 0 });
const cyanMat = neon(0x39f6ff, 2.4);
const magentaMat = neon(0xff2fd0, 2.2);
const orangeMat = neon(0xffa33d, 2.4);
const whiteMat = neon(0xeafcff, 2.8);
const soleMat = neon(0x39f6ff, 1.7);
const pCyan = new THREE.MeshStandardMaterial({ color: 0x25dbe8, emissive: 0x0a9fb2, emissiveIntensity: 1.0, roughness: 0.58, metalness: 0.06 });
const pOrange = new THREE.MeshStandardMaterial({ color: 0xff9a24, emissive: 0xc74d00, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.05 });
const pMagenta = new THREE.MeshStandardMaterial({ color: 0xff43bc, emissive: 0xa80079, emissiveIntensity: 0.9, roughness: 0.58, metalness: 0.05 });
const pSole = new THREE.MeshStandardMaterial({ color: 0xa9f7ff, emissive: 0x21cfdf, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.05 });

function capsule(radius, length, material, radial = 8) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, radial), material);
  m.castShadow = true;
  return m;
}

{
  const root = runner.root;
  root.position.set(0, 0, 0);
  scene.add(root);

  const body = runner.body;
  body.position.y = 0;
  root.add(body);

  // hips / torso
  const hips = addBox(body, 0.5, 0.22, 0.34, 0, 0.96, 0, darkMat);
  hips.castShadow = true;
  const torso = capsule(0.29, 0.42, jacketMat, 10);
  torso.position.set(0, 1.37, 0);
  body.add(torso);
  const chestPanel = addBox(body, 0.34, 0.23, 0.06, 0, 1.44, -0.272, pCyan);
  chestPanel.castShadow = false;
  const belt = addBox(body, 0.47, 0.09, 0.31, 0, 1.05, 0, pOrange);
  belt.castShadow = false;

  // neck + helmet
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), skinMat);
  neck.position.y = 1.76;
  body.add(neck);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 14), darkMat);
  helmet.position.y = 1.93;
  helmet.castShadow = true;
  body.add(helmet);
  const helmetStripe = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.018, 6, 20), pCyan);
  helmetStripe.rotation.x = Math.PI / 2;
  helmetStripe.position.y = 1.98;
  body.add(helmetStripe);
  const visor = addBox(body, 0.33, 0.12, 0.09, 0, 1.93, -0.19, pOrange);
  visor.castShadow = false;
  const visorGlow = glowSprite(0xff9d42, 0.9, 0.45);
  visorGlow.position.set(0, 1.93, -0.28);
  body.add(visorGlow);

  // backpack
  const pack = addBox(body, 0.48, 0.6, 0.2, 0, 1.37, 0.28, packMat);
  pack.castShadow = true;
  addBox(body, 0.055, 0.37, 0.03, -0.14, 1.41, 0.39, pCyan);
  addBox(body, 0.055, 0.37, 0.03, 0.14, 1.41, 0.39, pMagenta);
  // side rails + top rim
  addBox(body, 0.035, 0.5, 0.22, -0.228, 1.38, 0.29, pOrange);
  addBox(body, 0.035, 0.5, 0.22, 0.228, 1.38, 0.29, pOrange);
  addBox(body, 0.42, 0.035, 0.21, 0, 1.66, 0.29, pCyan);
  // luminous chevron on the pack, readable from the chase camera
  const chevronL = addBox(body, 0.14, 0.038, 0.025, -0.07, 1.51, 0.395, pOrange);
  chevronL.rotation.z = -0.52;
  const chevronR = addBox(body, 0.14, 0.038, 0.025, 0.07, 1.51, 0.395, pOrange);
  chevronR.rotation.z = 0.52;
  addBox(body, 0.26, 0.032, 0.022, 0, 1.27, 0.395, pCyan);
  // shoulder pads
  addBox(body, 0.16, 0.055, 0.26, -0.39, 1.69, 0, pOrange);
  addBox(body, 0.16, 0.055, 0.26, 0.39, 1.69, 0, pOrange);

  // arms
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.395, 1.6, 0);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), jacketMat);
    shoulder.castShadow = true;
    pivot.add(shoulder);
    const upper = capsule(0.095, 0.32, jacketMat);
    upper.position.y = -0.22;
    pivot.add(upper);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.018, 5, 14), pOrange);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.28;
    pivot.add(ring);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), darkMat);
    hand.position.y = -0.49;
    hand.castShadow = true;
    pivot.add(hand);
    addBox(pivot, 0.1, 0.035, 0.11, 0, -0.47, -0.01, pCyan);
    body.add(pivot);
    return pivot;
  }
  runner.leftArm = makeArm(-1);
  runner.rightArm = makeArm(1);

  // legs, built from hip + knee pivots for a lively run cycle
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.165, 0.94, 0);
    const upper = capsule(0.11, 0.3, suitMat);
    upper.position.y = -0.23;
    hip.add(upper);
    addBox(hip, 0.026, 0.29, 0.03, side * 0.105, -0.23, 0.01, pCyan);
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    const lower = capsule(0.095, 0.3, suitMat);
    lower.position.y = -0.22;
    knee.add(lower);
    addBox(knee, 0.024, 0.27, 0.028, side * 0.09, -0.22, 0.01, pOrange);
    const kneePad = addBox(knee, 0.17, 0.12, 0.12, 0, -0.02, -0.08, pMagenta);
    kneePad.castShadow = false;
    const shoe = addBox(knee, 0.24, 0.13, 0.34, 0, -0.45, -0.075, darkMat);
    shoe.castShadow = true;
    addBox(knee, 0.2, 0.035, 0.28, 0, -0.515, -0.075, pSole);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  }
  const left = makeLeg(-1);
  const right = makeLeg(1);
  runner.leftHip = left.hip;
  runner.rightHip = right.hip;
  runner.leftKnee = left.knee;
  runner.rightKnee = right.knee;

  // trailing scarf
  for (let i = 0; i < 6; i++) {
    const s = addBox(body, 0.22 - i * 0.02, 0.058, 0.23, -0.18 - i * 0.035, 1.67 - i * 0.04, 0.36 + i * 0.215, i % 2 ? pCyan : pOrange);
    s.castShadow = false;
    runner.scarf.push(s);
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}

// soft blob shadow under the runner
const blobShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1.5, 1.9),
  new THREE.MeshBasicMaterial({
    map: SHADOW_TEX,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    color: 0x000000,
  })
);
blobShadow.rotation.x = -Math.PI / 2;
blobShadow.position.y = 0.012;
scene.add(blobShadow);

/* -------------------------------------------------------------------------
   Obstacles
   ------------------------------------------------------------------------- */
const obstaclePools = { train: [], barrier: [], drone: [] };
const activeObstacles = [];

function makeHazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a0c08';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ff9d2e';
  for (let x = -80; x < 300; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 26, 0);
    ctx.lineTo(x + 58, 0);
    ctx.lineTo(x + 32, 64);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,235,180,0.18)';
  ctx.fillRect(0, 4, 256, 3);
  return textureFromCanvas(c, { srgb: true });
}
const HAZARD_TEX = makeHazardTexture();
const hazardMat = new THREE.MeshStandardMaterial({
  map: HAZARD_TEX,
  roughness: 0.46,
  metalness: 0.24,
  emissive: 0xffffff,
  emissiveMap: HAZARD_TEX,
  emissiveIntensity: 0.24,
});

function buildTrain() {
  const g = new THREE.Group();
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x10121f,
    emissive: 0x39f6ff,
    emissiveIntensity: 1.7,
    roughness: 0.3,
    metalness: 0.25,
  });
  const bodyMat = standard(0x1b2142, { roughness: 0.34, metalness: 0.72 });
  const body = addBox(g, 2.08, 2.28, 6.2, 0, 1.24, 0, bodyMat);
  body.castShadow = true;
  addBox(g, 2.0, 0.14, 5.9, 0, 2.43, 0, bodyMat);
  addBox(g, 0.05, 0.03, 5.15, -0.72, 2.51, 0, accentMat);
  addBox(g, 0.05, 0.03, 5.15, 0.72, 2.51, 0, accentMat);
  // front cab / glass
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a30,
    roughness: 0.22,
    metalness: 0.55,
    emissive: 0x0a6e82,
    emissiveIntensity: 0.24,
  });
  for (const side of [-1, 1]) {
    addBox(g, 0.72, 0.66, 0.06, side * 0.45, 1.62, 3.16, glassMat);
  }
  addBox(g, 0.12, 0.82, 0.08, 0, 1.62, 3.17, darkMat);
  addBox(g, 1.78, 0.12, 0.08, 0, 2.12, 3.15, accentMat);
  addBox(g, 0.34, 0.18, 0.04, 0, 1.32, 3.19, accentMat);
  // nose
  addBox(g, 1.9, 0.42, 0.45, 0, 0.38, 3.1, darkMat);
  addBox(g, 1.62, 0.06, 0.5, 0, 0.61, 3.13, accentMat);
  // side windows and stripe
  for (const side of [-1, 1]) {
    addBox(g, 0.035, 0.34, 4.5, side * 1.05, 1.86, -0.1, glassMat);
    addBox(g, 0.04, 0.055, 5.35, side * 1.055, 1.33, 0, accentMat);
    addBox(g, 0.035, 0.06, 4.7, side * 1.05, 0.33, 0, cyanMat);
  }
  // headlights
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), whiteMat);
    lamp.position.set(side * 0.66, 0.83, 3.18);
    g.add(lamp);
    const glow = glowSprite(0xfff2c2, 0.95, 0.48);
    glow.position.set(side * 0.66, 0.83, 3.24);
    g.add(glow);
  }
  // rear light
  const rearGlow = glowSprite(0xff335f, 1.2, 0.24);
  rearGlow.position.set(0, 1.1, -3.16);
  g.add(rearGlow);

  const o = {
    type: 'train', group: g, active: false, lane: 1, z: 0,
    halfW: 0.94, halfZ: 3.18, yMin: 0, yMax: 2.55,
    accentMat, glowParts: [rearGlow], phase: Math.random() * 6,
  };
  g.visible = false;
  scene.add(g);
  return o;
}

function buildBarrier() {
  const g = new THREE.Group();
  const frame = standard(0x1a1226, { roughness: 0.42, metalness: 0.65 });
  addBox(g, 0.15, 0.82, 0.26, -0.98, 0.41, 0, frame);
  addBox(g, 0.15, 0.82, 0.26, 0.98, 0.41, 0, frame);
  addBox(g, 2.3, 0.16, 0.36, 0, 0.03, 0, frame);
  const bar = addBox(g, 2.2, 0.42, 0.22, 0, 0.67, 0, hazardMat);
  bar.castShadow = true;
  addBox(g, 2.04, 0.055, 0.08, 0, 0.91, -0.02, orangeMat);
  addBox(g, 0.6, 0.11, 0.09, 0, 0.67, 0.12, orangeMat);
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), orangeMat);
    light.position.set(side * 0.84, 0.98, 0);
    g.add(light);
    const glow = glowSprite(0xffa63b, 0.5, 0.45);
    glow.position.set(side * 0.84, 0.99, 0.1);
    g.add(glow);
  }
  const o = {
    type: 'barrier', group: g, active: false, lane: 1, z: 0,
    halfW: 1.08, halfZ: 0.24, yMin: 0, yMax: 0.93,
    phase: Math.random() * 6,
  };
  g.visible = false;
  scene.add(g);
  return o;
}

function buildDrone() {
  const g = new THREE.Group();
  const shell = standard(0x191126, { roughness: 0.3, metalness: 0.7 });
  const accent = neon(0xff2fd0, 2.6);
  const body = addBox(g, 0.92, 0.22, 0.58, 0, 1.58, 0, shell);
  body.castShadow = true;
  addBox(g, 0.55, 0.07, 0.44, 0, 1.7, -0.01, accent);
  // arms and rotors
  const rotors = [];
  for (const [x, z] of [[-0.57, -0.4], [0.57, -0.4], [-0.57, 0.4], [0.57, 0.4]]) {
    addBox(g, 0.62, 0.055, 0.07, x * 0.62, 1.62, z * 0.62, shell);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 12), darkMat);
    rotor.position.set(x, 1.73, z);
    rotor.castShadow = false;
    g.add(rotor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 5, 16), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 1.735, z);
    g.add(ring);
    rotors.push(rotor);
  }
  // scanner
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff2fd0,
    transparent: true,
    opacity: 0.11,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.74, 1.22, 18, 1, true), beamMat);
  beam.position.y = 0.97;
  g.add(beam);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), neon(0xff365c, 3.2));
  eye.position.set(0, 1.55, 0.3);
  g.add(eye);
  const halo = glowSprite(0xff2f66, 1.6, 0.42);
  halo.position.set(0, 1.55, 0.34);
  g.add(halo);
  const o = {
    type: 'drone', group: g, active: false, lane: 1, z: 0,
    halfW: 0.72, halfZ: 0.42, yMin: 1.16, yMax: 2.4,
    rotors, beamMat, phase: Math.random() * 6,
  };
  g.visible = false;
  scene.add(g);
  return o;
}

function getObstacle(type) {
  const pool = obstaclePools[type];
  let o = pool.find((item) => !item.active);
  if (!o) {
    o = type === 'train' ? buildTrain() : type === 'barrier' ? buildBarrier() : buildDrone();
    pool.push(o);
  }
  return o;
}

function spawnObstacle(type, lane, z) {
  const o = getObstacle(type);
  o.active = true;
  o.lane = lane;
  o.z = z;
  o.group.visible = true;
  o.group.position.set(LANES[lane], 0, z);
  o.group.rotation.set(0, 0, 0);
  o.group.scale.set(1, 1, 1);
  if (type === 'train') {
    const color = Math.random() < 0.55 ? 0x39f6ff : 0xff2fd0;
    o.accentMat.emissive.setHex(color);
    o.accentMat.color.setHex(color);
    if (o.glowParts[0]) o.glowParts[0].material.color.setHex(0xff335f);
  }
  if (type === 'drone') {
    o.phase = Math.random() * Math.PI * 2;
  }
  activeObstacles.push(o);
  return o;
}

function releaseObstacle(o) {
  o.active = false;
  o.group.visible = false;
}

/* -------------------------------------------------------------------------
   Coins
   ------------------------------------------------------------------------- */
const coinGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.06, 20);
const coinInnerGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.07, 14);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffb31f,
  emissive: 0xff9a00,
  emissiveIntensity: 0.95,
  roughness: 0.26,
  metalness: 0.8,
});
const coinInnerMat = new THREE.MeshStandardMaterial({
  color: 0x8a4c00,
  emissive: 0xffd34e,
  emissiveIntensity: 0.75,
  roughness: 0.35,
  metalness: 0.65,
});
const coinPool = [];
const activeCoins = [];

function buildCoin() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(coinGeo, coinMat);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const inner = new THREE.Mesh(coinInnerGeo, coinInnerMat);
  inner.rotation.x = Math.PI / 2;
  inner.position.z = 0.001;
  g.add(inner);
  const glow = glowSprite(0xffb52f, 0.48, 0.13);
  glow.position.z = -0.06;
  g.add(glow);
  const c = { group: g, active: false, x: 0, y: 0, z: 0, spin: Math.random() * 6, bob: Math.random() * 6 };
  g.visible = false;
  scene.add(g);
  return c;
}

function spawnCoin(x, y, z) {
  let c = coinPool.find((item) => !item.active);
  if (!c) {
    c = buildCoin();
    coinPool.push(c);
  }
  c.active = true;
  c.x = x; c.y = y; c.z = z;
  c.spin = rand(0, Math.PI * 2);
  c.bob = rand(0, Math.PI * 2);
  c.group.visible = true;
  c.group.position.set(x, y, z);
  c.group.scale.set(1, 1, 1);
  activeCoins.push(c);
  return c;
}

function spawnCoinLine(lane, zStart, count, spacing, y = 1.16) {
  for (let i = 0; i < count; i++) {
    spawnCoin(LANES[lane], y, zStart - i * spacing);
  }
}

function spawnCoinArc(lane, zCenter, count = 5) {
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    spawnCoin(LANES[lane], 1.15 + Math.sin(t * Math.PI) * 1.6, zCenter + 4.5 - i * 2.25);
  }
}

/* -------------------------------------------------------------------------
   Particles
   ------------------------------------------------------------------------- */
const PARTICLE_MAX = 360;
const particleSystem = (() => {
  const positions = new Float32Array(PARTICLE_MAX * 3);
  const colors = new Float32Array(PARTICLE_MAX * 3);
  positions.fill(-999);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    size: 0.2,
    map: GLOW_TEX,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    geo, positions, colors,
    data: Array.from({ length: PARTICLE_MAX }, () => ({
      life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, drag: 0.98,
    })),
    cursor: 0,
  };
})();

function spawnParticles(pos, count, colorHex, opts = {}) {
  const color = new THREE.Color(colorHex);
  const spread = opts.spread ?? 3;
  const up = opts.up ?? 2.2;
  for (let i = 0; i < count; i++) {
    const idx = particleSystem.cursor++ % PARTICLE_MAX;
    const d = particleSystem.data[idx];
    d.life = d.maxLife = rand(0.35, 0.85);
    d.vx = rand(-spread, spread);
    d.vy = rand(0.2, up);
    d.vz = rand(-spread, spread * 0.7);
    d.r = color.r; d.g = color.g; d.b = color.b;
    d.drag = 0.965;
    const i3 = idx * 3;
    particleSystem.positions[i3] = pos.x + rand(-0.15, 0.15);
    particleSystem.positions[i3 + 1] = pos.y + rand(-0.15, 0.15);
    particleSystem.positions[i3 + 2] = pos.z + rand(-0.15, 0.15);
    particleSystem.colors[i3] = d.r;
    particleSystem.colors[i3 + 1] = d.g;
    particleSystem.colors[i3 + 2] = d.b;
  }
  particleSystem.geo.attributes.position.needsUpdate = true;
  particleSystem.geo.attributes.color.needsUpdate = true;
}

function updateParticles(dt) {
  const { positions, colors, data } = particleSystem;
  let changed = false;
  for (let i = 0; i < PARTICLE_MAX; i++) {
    const d = data[i];
    if (d.life <= 0) continue;
    d.life -= dt;
    const i3 = i * 3;
    d.vy -= 7.5 * dt;
    d.vx *= d.drag;
    d.vz *= d.drag;
    positions[i3] += d.vx * dt;
    positions[i3 + 1] += d.vy * dt;
    positions[i3 + 2] += d.vz * dt;
    const k = Math.max(0, d.life / d.maxLife);
    colors[i3] = d.r * k;
    colors[i3 + 1] = d.g * k;
    colors[i3 + 2] = d.b * k;
    if (d.life <= 0) positions[i3 + 1] = -999;
    changed = true;
  }
  if (changed) {
    particleSystem.geo.attributes.position.needsUpdate = true;
    particleSystem.geo.attributes.color.needsUpdate = true;
  }
}

/* -------------------------------------------------------------------------
   Game state and rules
   ------------------------------------------------------------------------- */
const state = {
  mode: 'menu',
  distance: 0,
  coins: 0,
  speed: START_SPEED,
  topSpeed: START_SPEED,
  spawnAccum: 0,
  nextGap: 26,
  crashTime: 0,
  shake: 0,
  coinStreak: 0,
  coinStreakTimer: 0,
  worldSpeed: 6,
  hudAccum: 0,
  introDone: false,
};

const scoreOf = () => Math.floor(state.distance) + state.coins * 15;

function difficulty() {
  return clamp((state.speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0, 1);
}

function spawnWaveAt(z) {
  const diff = difficulty();
  const lanes = shuffle([0, 1, 2]);
  const blockedCount = Math.random() < 0.16 + diff * 0.62 ? 2 : 1;
  const blocked = lanes.slice(0, blockedCount);
  const free = lanes.slice(blockedCount);

  for (const lane of blocked) {
    const roll = Math.random();
    let type;
    if (roll < 0.18 + diff * 0.18) type = 'drone';
    else if (roll < 0.76 + diff * 0.05) type = 'train';
    else type = 'barrier';
    spawnObstacle(type, lane, z + (type === 'barrier' ? rand(-0.5, 0.5) : 0));
  }

  if (free.length) {
    const lane = free[0];
    spawnCoinLine(lane, z + 13, 7, 2.15, 1.16);
    if (Math.random() < 0.5) spawnCoinLine(lane, z - 11, 2, 2.2, 1.16);
  }

  for (const lane of blocked) {
    const barriers = activeObstacles.filter((o) => o.active && o.lane === lane && Math.abs(o.z - z) < 3 && o.type === 'barrier');
    if (barriers.length) spawnCoinArc(lane, z);
  }
}

function clearWorldObjects() {
  for (const o of activeObstacles) {
    o.active = false;
    o.group.visible = false;
  }
  activeObstacles.length = 0;
  for (const c of activeCoins) {
    c.active = false;
    c.group.visible = false;
  }
  activeCoins.length = 0;
}

function spawnIntro() {
  spawnCoinLine(1, -8, 6, 2.35, 1.16);
  const sideLane = Math.random() < 0.5 ? 0 : 2;
  spawnObstacle('train', sideLane, -24);
  spawnCoinLine(1, -16, 5, 2.3, 1.16);
  spawnWaveAt(-58);
  spawnWaveAt(-90);
}

function resetRunner() {
  runner.lane = 1;
  runner.x = 0;
  runner.jumpY = 0;
  runner.vy = 0;
  runner.grounded = true;
  runner.slideTimer = 0;
  runner.lateralVel = 0;
  runner.root.position.set(0, 0, 0);
  runner.root.rotation.set(0, 0, 0);
  runner.body.rotation.set(0, 0, 0);
  runner.body.position.set(0, 0, 0);
  runner.body.scale.set(1, 1, 1);
  ui.distance.textContent = '0';
  ui.coins.textContent = '0';
  ui.speed.textContent = Math.round(START_SPEED * 3.6);
  ui.speedBar.style.width = '12%';
}

function resetRun(withIntro = true) {
  state.distance = 0;
  state.coins = 0;
  state.speed = START_SPEED;
  state.topSpeed = START_SPEED;
  state.spawnAccum = 0;
  state.nextGap = 26;
  state.crashTime = 0;
  state.shake = 0;
  state.coinStreak = 0;
  state.coinStreakTimer = 0;
  state.worldSpeed = START_SPEED;
  clearWorldObjects();
  resetRunner();
  if (withIntro) spawnIntro();
}

function collectCoin(c) {
  c.active = false;
  c.group.visible = false;
  state.coins++;
  state.coinStreak++;
  state.coinStreakTimer = 1.4;
  ui.coins.textContent = state.coins;
  ui.coinPill.classList.remove('is-bumping');
  void ui.coinPill.offsetWidth;
  ui.coinPill.classList.add('is-bumping');
  ui.coinToast.textContent = `+1`;
  ui.coinToast.classList.remove('is-active');
  void ui.coinToast.offsetWidth;
  ui.coinToast.classList.add('is-active');
  synth.coin(state.coinStreak);
  spawnParticles(c.group.position, 12, 0xffcf4a, { spread: 2.2, up: 2.4 });
}

function crashInto(o) {
  if (state.mode !== 'playing') return;
  state.mode = 'crash';
  state.crashTime = 0;
  state.shake = 1.15;
  app.dataset.state = 'crash';
  ui.flash.classList.remove('is-active');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('is-active');
  synth.hit();
  if (navigator.vibrate) { try { navigator.vibrate([25, 40, 70]); } catch { /* noop */ } }
  const p = new THREE.Vector3(runner.x, runner.jumpY + 1, 0);
  spawnParticles(p, 46, 0xff4a4a, { spread: 5.4, up: 5.2 });
  spawnParticles(p, 22, 0xffc24a, { spread: 4.5, up: 4.4 });
}

function finishRun() {
  state.mode = 'gameover';
  app.dataset.state = 'gameover';
  const score = scoreOf();
  const distance = Math.floor(state.distance);
  const isBest = score > records.bestScore;
  if (isBest) records.bestScore = score;
  if (distance > records.bestDistance) records.bestDistance = distance;
  store.set('neonrush.bestScore', records.bestScore);
  store.set('neonrush.bestDistance', records.bestDistance);

  ui.finalScore.textContent = score.toLocaleString('en-US');
  ui.finalDistance.innerHTML = `${distance.toLocaleString('en-US')}<em>m</em>`;
  ui.finalCoins.textContent = state.coins;
  ui.finalSpeed.innerHTML = `${Math.round(state.topSpeed * 3.6)}<em>km/h</em>`;
  ui.newBest.hidden = !isBest;
  ui.finalQuip.textContent = isBest
    ? 'New record burned into the grid.'
    : state.coins > 20
      ? 'A rich run. The city still wants more.'
      : state.distance > 400
        ? 'So close to the horizon. Run it back.'
        : 'The city always wins the first round.';

  ui.gameover.classList.remove('is-hidden');
  ui.gameover.setAttribute('aria-hidden', 'false');
  updateMenuRecords();
  synth.stopMusic();
}

function updateMenuRecords() {
  ui.menuBest.textContent = records.bestScore.toLocaleString('en-US');
  ui.menuDistance.innerHTML = `${records.bestDistance.toLocaleString('en-US')}<em>m</em>`;
}

/* -------------------------------------------------------------------------
   Interaction
   ------------------------------------------------------------------------- */
function requestLane(direction) {
  if (state.mode !== 'playing') return;
  const next = clamp(runner.lane + direction, 0, 2);
  if (next === runner.lane) return;
  runner.lane = next;
  synth.tone(170, 0.12, 'sine', 0.028, 430);
}

function requestJump() {
  if (state.mode !== 'playing' || !runner.grounded) return;
  runner.slideTimer = 0;
  runner.vy = Math.sqrt(2 * JUMP_HEIGHT * -GRAVITY);
  runner.grounded = false;
  synth.jump();
  spawnParticles(new THREE.Vector3(runner.x, 0.15, 0.2), 8, 0x39f6ff, { spread: 1.7, up: 1.5 });
}

function requestSlide() {
  if (state.mode !== 'playing') return;
  if (runner.grounded) {
    if (runner.slideTimer <= 0.04) synth.slide();
    runner.slideTimer = 0.68;
  } else {
    runner.vy = Math.min(runner.vy, -16);
  }
}

/* -------------------------------------------------------------------------
   Runner movement + animation
   ------------------------------------------------------------------------- */
function updateRunner(dt) {
  if (state.mode === 'playing') {
    const targetX = LANES[runner.lane];
    const previousX = runner.x;
    runner.x = damp(runner.x, targetX, 14, dt);
    runner.lateralVel = dt > 0 ? (runner.x - previousX) / dt : 0;

    if (!runner.grounded) {
      runner.vy += GRAVITY * dt;
      runner.jumpY += runner.vy * dt;
      if (runner.jumpY <= 0) {
        runner.jumpY = 0;
        runner.vy = 0;
        runner.grounded = true;
        synth.land();
        spawnParticles(new THREE.Vector3(runner.x, 0.12, 0), 7, 0xb46bff, { spread: 1.8, up: 1.0 });
      }
    }
    runner.slideTimer = Math.max(0, runner.slideTimer - dt);
    runner.root.position.set(runner.x, runner.jumpY, 0);
  } else if (state.mode === 'menu') {
    runner.x = damp(runner.x, 0, 7, dt);
    runner.jumpY = 0;
    runner.vy = 0;
    runner.grounded = true;
    runner.slideTimer = 0;
    runner.lateralVel = 0;
    runner.root.position.set(runner.x, 0, 0);
  } else if (state.mode === 'crash') {
    runner.root.rotation.x = damp(runner.root.rotation.x, -1.25, 2.6, dt);
    runner.root.rotation.z = damp(runner.root.rotation.z, 0.34, 2.2, dt);
    runner.root.position.y = damp(runner.root.position.y, 0.22, 3, dt);
    runner.root.position.z = damp(runner.root.position.z, 2.3, 2.2, dt);
    runner.jumpY = runner.root.position.y;
  }
  animateRunner(dt);
}

function animateRunner(dt) {
  const running = state.mode === 'playing' || state.mode === 'menu';
  const pace = state.mode === 'menu' ? 7.4 : 8.2 + state.speed * 0.7;
  if (running) {
    runner.phase += dt * pace;
  } else if (state.mode === 'crash') {
    runner.phase += dt * 4;
  }

  runner.slideBlend = damp(runner.slideBlend || 0, runner.slideTimer > 0 ? 1 : 0, 13, dt);
  const slide = runner.slideBlend;
  const s = Math.sin(runner.phase);
  const c = Math.cos(runner.phase);
  const airborne = !runner.grounded && state.mode === 'playing';

  if (airborne) {
    runner.leftHip.rotation.x = damp(runner.leftHip.rotation.x, -0.62, 12, dt);
    runner.rightHip.rotation.x = damp(runner.rightHip.rotation.x, 0.35, 12, dt);
    runner.leftKnee.rotation.x = damp(runner.leftKnee.rotation.x, 1.15, 12, dt);
    runner.rightKnee.rotation.x = damp(runner.rightKnee.rotation.x, 0.5, 12, dt);
    runner.leftArm.rotation.x = damp(runner.leftArm.rotation.x, -1.55, 10, dt);
    runner.rightArm.rotation.x = damp(runner.rightArm.rotation.x, -1.2, 10, dt);
    runner.leftArm.rotation.z = 0.22;
    runner.rightArm.rotation.z = -0.22;
  } else if (state.mode === 'crash') {
    runner.leftArm.rotation.x = damp(runner.leftArm.rotation.x, -2.4, 7, dt);
    runner.rightArm.rotation.x = damp(runner.rightArm.rotation.x, 1.7, 7, dt);
    runner.leftArm.rotation.z = damp(runner.leftArm.rotation.z, 0.8, 7, dt);
    runner.rightArm.rotation.z = damp(runner.rightArm.rotation.z, -0.65, 7, dt);
    runner.leftHip.rotation.x = damp(runner.leftHip.rotation.x, 0.9, 8, dt);
    runner.rightHip.rotation.x = damp(runner.rightHip.rotation.x, -0.7, 8, dt);
    runner.leftKnee.rotation.x = damp(runner.leftKnee.rotation.x, 0.6, 8, dt);
    runner.rightKnee.rotation.x = damp(runner.rightKnee.rotation.x, 0.9, 8, dt);
  } else {
    const swing = state.mode === 'menu' ? 0.58 : 0.83;
    runner.leftHip.rotation.x = damp(runner.leftHip.rotation.x, s * swing, 20, dt);
    runner.rightHip.rotation.x = damp(runner.rightHip.rotation.x, -s * swing, 20, dt);
    runner.leftKnee.rotation.x = damp(runner.leftKnee.rotation.x, Math.max(0, -s) * 1.15, 20, dt);
    runner.rightKnee.rotation.x = damp(runner.rightKnee.rotation.x, Math.max(0, s) * 1.15, 20, dt);
    runner.leftArm.rotation.x = damp(runner.leftArm.rotation.x, -s * 0.78, 16, dt);
    runner.rightArm.rotation.x = damp(runner.rightArm.rotation.x, s * 0.78, 16, dt);
    runner.leftArm.rotation.z = damp(runner.leftArm.rotation.z, 0.06, 10, dt);
    runner.rightArm.rotation.z = damp(runner.rightArm.rotation.z, -0.06, 10, dt);
  }

  // blend into a low, forward slide pose
  runner.body.rotation.x = damp(runner.body.rotation.x, -1.03 * slide, 16, dt);
  const bob = running ? Math.abs(c) * 0.035 : 0;
  runner.body.position.y = damp(runner.body.position.y, bob - slide * 0.08, 18, dt);
  runner.body.rotation.z = damp(runner.body.rotation.z, -runner.lateralVel * 0.021, 9, dt);

  if (slide > 0.2) {
    runner.leftHip.rotation.x = damp(runner.leftHip.rotation.x, -0.12, 14, dt);
    runner.rightHip.rotation.x = damp(runner.rightHip.rotation.x, -0.42, 14, dt);
    runner.leftKnee.rotation.x = damp(runner.leftKnee.rotation.x, 0.2, 14, dt);
    runner.rightKnee.rotation.x = damp(runner.rightKnee.rotation.x, 0.15, 14, dt);
    runner.leftArm.rotation.x = damp(runner.leftArm.rotation.x, 1.1, 12, dt);
    runner.rightArm.rotation.x = damp(runner.rightArm.rotation.x, 0.85, 12, dt);
  }

  for (let i = 0; i < runner.scarf.length; i++) {
    const sc = runner.scarf[i];
    sc.rotation.x = -0.12 + Math.sin(runner.phase * 0.6 - i * 0.8) * 0.12;
    sc.rotation.y = Math.sin(runner.phase * 0.4 - i * 0.6) * 0.15;
  }

  blobShadow.position.x = runner.x;
  blobShadow.position.z = 0.05;
  const shadowScale = clamp(1 - runner.jumpY * 0.16, 0.48, 1);
  blobShadow.scale.set(shadowScale, shadowScale, 1);
  blobShadow.material.opacity = clamp(0.38 - runner.jumpY * 0.1, 0.1, 0.38);
}

/* -------------------------------------------------------------------------
   World scrolling
   ------------------------------------------------------------------------- */
function updateEnvironment(scroll) {
  roadTex.offset.y = (roadTex.offset.y + scroll / ROAD_TILE) % 1;
  sideBarTex.offset.y = (sideBarTex.offset.y + scroll / 11.6) % 1;

  for (const b of buildings) {
    b.position.z += scroll;
    if (b.position.z > 38) placeBuilding(b, false);
  }
  for (const s of signs) {
    s.position.z += scroll;
    if (s.position.z > 18) placeSign(s, false);
    const flicker = 0.19 + Math.sin(performance.now() * 0.002 + s.position.z * 0.04) * 0.04;
    s.userData.glow.material.opacity = flicker;
  }
  for (const a of arches) {
    a.position.z += scroll;
    if (a.position.z > 28) a.position.z -= 261;
  }
  for (const p of pylons) {
    p.position.z += scroll;
    if (p.position.z > 28) p.position.z -= 280;
  }

  const positions = dust.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    let z = positions.getZ(i) + scroll * 1.25;
    if (z > 14) {
      z -= 116;
      positions.setX(i, rand(-18, 18));
      positions.setY(i, rand(-3, 13));
    }
    positions.setZ(i, z);
  }
  positions.needsUpdate = true;
}

function updateObstacles(dt, scroll) {
  const time = performance.now() * 0.001;
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const o = activeObstacles[i];
    if (!o.active) {
      activeObstacles.splice(i, 1);
      continue;
    }
    o.z += scroll;
    o.group.position.z = o.z;
    if (o.type === 'drone') {
      o.group.position.y = Math.sin(time * 3.2 + o.phase) * 0.075;
      for (const r of o.rotors) r.rotation.y += dt * 28;
      o.beamMat.opacity = 0.09 + Math.abs(Math.sin(time * 4 + o.phase)) * 0.08;
    }
    if (o.type === 'barrier') {
      o.group.rotation.z = Math.sin(time * 18 + o.phase) * 0.006;
    }
    if (o.z > 20) {
      releaseObstacle(o);
      activeObstacles.splice(i, 1);
    }
  }
}

function updateCoins(dt, scroll) {
  const time = performance.now() * 0.001;
  for (let i = activeCoins.length - 1; i >= 0; i--) {
    const c = activeCoins[i];
    if (!c.active) {
      activeCoins.splice(i, 1);
      continue;
    }
    c.z += scroll;
    c.group.position.z = c.z;
    c.group.position.y = c.y + Math.sin(time * 3.1 + c.bob) * 0.065;
    c.group.rotation.y += dt * 3.4;
    const pulse = 1 + Math.sin(time * 5 + c.bob) * 0.06;
    c.group.scale.setScalar(pulse);
    if (c.z > 7.4) {
      c.active = false;
      c.group.visible = false;
      activeCoins.splice(i, 1);
    }
  }
}

/* -------------------------------------------------------------------------
   Collisions
   ------------------------------------------------------------------------- */
function checkCollisions(dt) {
  const playerX = runner.x;
  const playerBottom = runner.jumpY;
  const playerTop = runner.jumpY + (runner.slideTimer > 0.04 ? 0.9 : 1.84);
  const sweep = state.speed * dt * 0.75;

  for (const o of activeObstacles) {
    if (!o.active) continue;
    if (o.z > 8 || o.z < -8) continue;
    const laneCenter = LANES[o.lane];
    if (Math.abs(playerX - laneCenter) > o.halfW + 0.36) continue;
    if (Math.abs(o.z) > o.halfZ + 0.36 + sweep) continue;
    if (playerTop > o.yMin && playerBottom < o.yMax) {
      crashInto(o);
      return;
    }
  }

  for (const c of activeCoins) {
    if (!c.active) continue;
    if (Math.abs(c.z) > 0.92 + sweep) continue;
    if (Math.abs(c.x - playerX) > 0.72) continue;
    if (c.y < playerBottom + 0.05 || c.y > playerTop + 0.18) continue;
    collectCoin(c);
  }
}

/* -------------------------------------------------------------------------
   Camera + HUD
   ------------------------------------------------------------------------- */
let targetFov = 62;
const camLook = new THREE.Vector3(-1.4, 1.4, -5.8);
function updateCamera(dt) {
  const menu = state.mode === 'menu';
  const diff = difficulty();
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 0.82;
  const targetX = menu ? (portrait ? -0.32 : -1.4) : runner.x * 0.4;
  const targetY = 3.3 + runner.jumpY * 0.16;
  const targetZ = menu ? (portrait ? 7.0 : 6.7) : 6.45;
  camera.position.x = damp(camera.position.x, targetX, menu ? 2.2 : 4.5, dt);
  camera.position.y = damp(camera.position.y, targetY, 4, dt);
  camera.position.z = damp(camera.position.z, targetZ, 4, dt);

  const lookX = menu ? (portrait ? -0.9 : -5.2) : runner.x * 0.22;
  const lookY = 1.32 + runner.jumpY * 0.2;
  camLook.x = damp(camLook.x, lookX, menu ? 2.2 : 4.5, dt);
  camLook.y = damp(camLook.y, lookY, 4, dt);
  camLook.z = damp(camLook.z, menu ? -5.8 : -5.6, 4, dt);
  camera.lookAt(camLook);
  camera.rotation.z += menu ? 0 : -runner.lateralVel * 0.0065;

  targetFov = 62 + diff * 7 + (portrait ? 5 : 0);
  camera.fov = damp(camera.fov, targetFov, 3, dt);
  camera.updateProjectionMatrix();

  playerFill.position.x = runner.x * 0.5;
  playerFill.position.y = 3.4 + runner.jumpY * 0.35;

  if (state.shake > 0.001) {
    const shake = state.shake;
    camera.position.x += rand(-1, 1) * shake * 0.22;
    camera.position.y += rand(-1, 1) * shake * 0.18;
    camera.rotation.z += rand(-1, 1) * shake * 0.018;
    state.shake = Math.max(0, state.shake - dt * 2.2);
  }
  cyanLight.position.x = -5.5 + Math.sin(performance.now() * 0.0008) * 0.6;
  magentaLight.position.z = -4 + Math.cos(performance.now() * 0.0007) * 1.2;
}

function updateHud(dt) {
  state.hudAccum += dt;
  if (state.hudAccum < 0.06) return;
  state.hudAccum = 0;
  const distance = Math.floor(state.distance);
  const kmh = Math.round(state.speed * 3.6);
  ui.distance.textContent = distance.toLocaleString('en-US');
  ui.speed.textContent = kmh;
  const bar = clamp((state.speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0, 1);
  ui.speedBar.style.width = `${12 + bar * 88}%`;
  const fx = state.mode === 'menu' ? 0.08 : bar;
  app.style.setProperty('--speed-fx', fx.toFixed(3));
}

/* -------------------------------------------------------------------------
   Game transitions
   ------------------------------------------------------------------------- */
function hideScreens() {
  for (const el of [ui.menu, ui.gameover, ui.pause]) {
    el.classList.add('is-hidden');
    el.setAttribute('aria-hidden', 'true');
  }
}

function startRun() {
  resetRun(true);
  state.mode = 'playing';
  app.dataset.state = 'playing';
  hideScreens();
  ui.newBest.hidden = true;
  ui.gameover.classList.add('is-hidden');
  ui.pause.classList.add('is-hidden');
  ui.flash.classList.remove('is-active');
  ui.coinToast.classList.remove('is-active');
  ui.goBurst.classList.remove('is-active');
  void ui.goBurst.offsetWidth;
  ui.goBurst.classList.add('is-active');
  synth.resume();
  synth.startMusic();
  synth.click();
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  state.worldSpeed = 0;
  app.dataset.state = 'paused';
  ui.pause.classList.remove('is-hidden');
  ui.pause.setAttribute('aria-hidden', 'false');
  synth.stopMusic();
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  app.dataset.state = 'playing';
  ui.pause.classList.add('is-hidden');
  ui.pause.setAttribute('aria-hidden', 'true');
  synth.resume();
  synth.startMusic();
  synth.click();
}

function endRun() {
  if (state.mode !== 'paused') return;
  ui.pause.classList.add('is-hidden');
  ui.pause.setAttribute('aria-hidden', 'true');
  state.mode = 'crash';
  state.crashTime = 0.95;
  finishRun();
}

function goHome() {
  synth.stopMusic();
  resetRun(false);
  state.mode = 'menu';
  state.worldSpeed = 5;
  app.dataset.state = 'menu';
  ui.gameover.classList.add('is-hidden');
  ui.gameover.setAttribute('aria-hidden', 'true');
  ui.pause.classList.add('is-hidden');
  ui.pause.setAttribute('aria-hidden', 'true');
  ui.menu.classList.remove('is-hidden');
  ui.menu.setAttribute('aria-hidden', 'false');
  ui.flash.classList.remove('is-active');
  ui.newBest.hidden = true;
  updateMenuRecords();
}

function togglePause() {
  if (state.mode === 'playing') pauseGame();
  else if (state.mode === 'paused') resumeGame();
}

/* -------------------------------------------------------------------------
   Main loop
   ------------------------------------------------------------------------- */
function tick(dt) {
  if (state.mode === 'playing') {
    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RATE * dt);
    state.topSpeed = Math.max(state.topSpeed, state.speed);
    state.distance += state.speed * dt;
    state.worldSpeed = state.speed;

    state.coinStreakTimer = Math.max(0, state.coinStreakTimer - dt);
    if (state.coinStreakTimer <= 0) state.coinStreak = 0;

    updateRunner(dt);

    state.spawnAccum += state.speed * dt;
    if (state.spawnAccum >= state.nextGap) {
      state.spawnAccum = 0;
      state.nextGap = rand(27, 33) - difficulty() * 8;
      spawnWaveAt(-105);
    }
  } else if (state.mode === 'menu') {
    state.worldSpeed = damp(state.worldSpeed, 5.8, 2, dt);
    updateRunner(dt);
  } else if (state.mode === 'crash') {
    state.crashTime += dt;
    state.worldSpeed = damp(state.worldSpeed, 0, 3.2, dt);
    updateRunner(dt);
    if (state.crashTime > 0.95) finishRun();
  } else if (state.mode === 'paused') {
    updateCamera(dt);
    return;
  } else if (state.mode === 'gameover') {
    state.worldSpeed = damp(state.worldSpeed, 0, 3, dt);
    runner.phase += dt * 1.2;
  }

  const scroll = state.worldSpeed * dt;
  updateEnvironment(scroll);
  updateObstacles(dt, scroll);
  updateCoins(dt, scroll);

  if (state.mode === 'playing') checkCollisions(dt);

  updateParticles(dt);
  updateCamera(dt);
  updateHud(dt);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  tick(dt);
  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------
   Events
   ------------------------------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  const key = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(key)) e.preventDefault();
  if (e.repeat) return;

  if (key === 'KeyM') {
    const on = synth.toggle();
    ui.soundBtn.classList.toggle('is-muted', !on);
    ui.soundBtn.setAttribute('aria-label', on ? 'Mute sound' : 'Enable sound');
    return;
  }

  if (state.mode === 'menu') {
    if (key === 'Enter' || key === 'Space') startRun();
    return;
  }
  if (state.mode === 'gameover') {
    if (key === 'Enter' || key === 'Space' || key === 'KeyR') startRun();
    if (key === 'Escape') goHome();
    return;
  }
  if (key === 'Escape' || key === 'KeyP') {
    togglePause();
    return;
  }
  if (state.mode !== 'playing') return;

  if (key === 'ArrowLeft' || key === 'KeyA') requestLane(-1);
  else if (key === 'ArrowRight' || key === 'KeyD') requestLane(1);
  else if (key === 'Space' || key === 'ArrowUp' || key === 'KeyW') requestJump();
  else if (key === 'ArrowDown' || key === 'KeyS') requestSlide();
});

let swipeStart = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'playing') return;
  swipeStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!swipeStart || state.mode !== 'playing') { swipeStart = null; return; }
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  const threshold = clamp(window.innerWidth * 0.045, 24, 46);
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
    requestLane(dx > 0 ? 1 : -1);
  } else if (Math.abs(dy) > threshold) {
    if (dy < 0) requestJump();
    else requestSlide();
  }
  swipeStart = null;
});
canvas.addEventListener('pointercancel', () => { swipeStart = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// on-screen touch controls
for (const btn of document.querySelectorAll('.touch-btn')) {
  const action = btn.dataset.action;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('is-pressed');
    if (action === 'left') requestLane(-1);
    else if (action === 'right') requestLane(1);
    else if (action === 'jump') requestJump();
    else if (action === 'slide') requestSlide();
  });
  const release = (e) => {
    e.preventDefault();
    btn.classList.remove('is-pressed');
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', () => btn.classList.remove('is-pressed'));
}

ui.play.addEventListener('click', startRun);
ui.retry.addEventListener('click', startRun);
ui.home.addEventListener('click', goHome);
ui.resume.addEventListener('click', resumeGame);
ui.quit.addEventListener('click', endRun);
ui.pauseBtn.addEventListener('click', togglePause);
ui.soundBtn.addEventListener('click', () => {
  synth.resume();
  const on = synth.toggle();
  ui.soundBtn.classList.toggle('is-muted', !on);
  ui.soundBtn.setAttribute('aria-label', on ? 'Mute sound' : 'Enable sound');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') pauseGame();
});
window.addEventListener('blur', () => {
  if (state.mode === 'playing') pauseGame();
});

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
updateMenuRecords();
ui.gameover.classList.add('is-hidden');
ui.pause.classList.add('is-hidden');
ui.menu.setAttribute('aria-hidden', 'false');

// debug/testing hook
window.NeonRush = {
  state,
  runner,
  camera,
  startRun,
  pauseGame,
  resumeGame,
  goHome,
  get score() { return scoreOf(); },
  get records() { return records; },
  /* Fast-forward the simulation for automated verification. */
  advance(seconds = 1) {
    const steps = Math.min(1800, Math.max(1, Math.round(seconds * 60)));
    for (let i = 0; i < steps; i++) tick(1 / 60);
    renderer.render(scene, camera);
    return { mode: state.mode, distance: +state.distance.toFixed(2), coins: state.coins };
  },
  obstacles() {
    return activeObstacles
      .filter((o) => o.active)
      .map((o) => ({ type: o.type, lane: o.lane, z: +o.z.toFixed(2) }))
      .sort((a, b) => b.z - a.z);
  },
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  },
};

renderer.render(scene, camera);
requestAnimationFrame(frame);

