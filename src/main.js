console.log("MAIN VERSION = 2026-02-10-FOA-2LIST");

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as Omnitone from "./vendor/omnitone.esm.js";

const O = Omnitone.default ?? Omnitone.Omnitone ?? Omnitone;

document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "black";

// ---------- UI (two items) ----------
// ---------- UI (two items) : video thumbnails ----------
const playlist = [
  { id: "v1", title: "Video 1", video: "/video1.webm", foa: "/foa1.wav" },
  { id: "v2", title: "Video 2", video: "/video2.webm", foa: "/foa2.wav" },
];
let currentIndex = 0;

// gallery container
const gallery = document.createElement("div");
gallery.id = "gallery";
gallery.style.position = "fixed";
gallery.style.left = "16px";
gallery.style.bottom = "16px";
gallery.style.zIndex = "20";
gallery.style.display = "flex";
gallery.style.gap = "12px";
gallery.style.alignItems = "flex-end";
gallery.style.padding = "10px";
gallery.style.background = "rgba(0,0,0,.25)";
gallery.style.border = "1px solid rgba(255,255,255,.15)";
gallery.style.borderRadius = "14px";
gallery.style.backdropFilter = "blur(6px)";
document.body.appendChild(gallery);

function mkThumb(item, idx) {
  const wrap = document.createElement("div");
  wrap.style.width = "220px";
  wrap.style.height = "124px";
  wrap.style.borderRadius = "12px";
  wrap.style.overflow = "hidden";
  wrap.style.position = "relative";
  wrap.style.cursor = "pointer";
  wrap.style.userSelect = "none";
  wrap.style.border = "1px solid rgba(255,255,255,.18)";
  wrap.style.transform = "translateZ(0)";

  const v = document.createElement("video");
  v.src = item.video;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.autoplay = true;          // ✅ 缩略图自动播放
  v.preload = "metadata";
  v.crossOrigin = "anonymous";
  v.style.width = "100%";
  v.style.height = "100%";
  v.style.objectFit = "cover";
  v.style.filter = "contrast(1.05) saturate(1.05)";
  wrap.appendChild(v);

  // label
  const label = document.createElement("div");
  label.textContent = item.title;
  label.style.position = "absolute";
  label.style.left = "8px";
  label.style.bottom = "8px";
  label.style.padding = "4px 8px";
  label.style.borderRadius = "999px";
  label.style.font = "12px/1.2 system-ui";
  label.style.color = "#fff";
  label.style.background = "rgba(0,0,0,.55)";
  label.style.border = "1px solid rgba(255,255,255,.15)";
  wrap.appendChild(label);

  // click to play
  wrap.addEventListener("click", async () => {
    setActive(idx);
    currentIndex = idx;
    try {
      await initAudioOnce();      // ✅ 用点击手势解锁音频
      await loadAndPlay(idx);     // ✅ 立即切换到该视频
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  });

  // Safari/Chrome 可能会阻止 autoplay 缩略图：尝试 play 一下，失败也无所谓
  v.addEventListener("canplay", async () => {
    try { await v.play(); } catch {}
  });

  return { wrap, v };
}

const thumbs = playlist.map((it, idx) => mkThumb(it, idx));
thumbs.forEach(t => gallery.appendChild(t.wrap));

function setActive(idx) {
  thumbs.forEach((t, i) => {
    t.wrap.style.outline = i === idx ? "3px solid rgba(255,255,255,.9)" : "none";
    t.wrap.style.boxShadow = i === idx ? "0 0 0 2px rgba(0,0,0,.35), 0 10px 30px rgba(0,0,0,.35)" : "none";
    t.wrap.style.opacity = i === idx ? "1" : "0.75";
  });
}
setActive(currentIndex);


// ---------- three scene ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 0.01);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.position = "fixed";
renderer.domElement.style.inset = "0";
renderer.domElement.style.zIndex = "0";
document.body.appendChild(renderer.domElement);

// controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableZoom = false;
controls.enablePan = false;
controls.autoRotate = false;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
// lock to horizontal rotation (optional)
controls.minPolarAngle = Math.PI / 2;
controls.maxPolarAngle = Math.PI / 2;

// auto-yaw driven by video progress
let baseYaw = 0;
let autoYaw = true;
let avStarted = false;

controls.addEventListener("start", () => (autoYaw = false));
controls.addEventListener("end", () => {
  const v = videoEl;
  if (v.duration > 0) {
    const progress = THREE.MathUtils.clamp(v.currentTime / v.duration, 0, 1);
    const angle = progress * Math.PI * 2;
    baseYaw = camera.rotation.y + angle;
  } else {
    baseYaw = camera.rotation.y;
  }
  autoYaw = true;
});

// ---------- 360 video texture ----------
const videoEl = document.createElement("video");
videoEl.crossOrigin = "anonymous";
videoEl.loop = false;
videoEl.muted = true; // audio handled by WebAudio(FOA)
videoEl.playsInline = true;
videoEl.preload = "auto";

const videoTex = new THREE.VideoTexture(videoEl);
videoTex.colorSpace = THREE.SRGBColorSpace;

const sphereGeo = new THREE.SphereGeometry(10, 96, 96);
sphereGeo.scale(-1, 1, 1);
const sphereMat = new THREE.MeshBasicMaterial({ map: videoTex });
scene.add(new THREE.Mesh(sphereGeo, sphereMat));

// ---------- FOA audio (WebAudio + Omnitone) ----------
let audioCtx, foaDecoder, foaBuffer, sourceNode;
let audioInited = false;

async function waitCanPlay(v) {
  if (v.readyState >= 2) return;
  await new Promise((resolve, reject) => {
    v.oncanplay = () => resolve();
    v.onerror = () => reject(new Error("video load error: check public/*.webm"));
  });
}

async function loadFOAWavFrom(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to fetch ${path} (${resp.status}) — put it in /public`);
  const arr = await resp.arrayBuffer();
  const buf = await audioCtx.decodeAudioData(arr);
  if (buf.numberOfChannels !== 4) throw new Error(`${path} has ${buf.numberOfChannels} channels, expected 4`);
  return buf;
}

async function initAudioOnce() {
  if (audioInited) {
    // ✅ 如果曾经被 suspend（比如切 tab/暂停），确保恢复
    if (audioCtx?.state === "suspended") await audioCtx.resume();
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const create = O.createFOADecoder ?? O.createFOARenderer ?? O.createRenderer;
  if (!create) throw new Error("No FOA factory in Omnitone. API keys=" + Object.keys(O).join(","));

  foaDecoder = await create(audioCtx);
  if (foaDecoder.initialize) await foaDecoder.initialize();

  await audioCtx.resume();
  audioInited = true;
}

function stopAudio() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch {}
    try { sourceNode.disconnect(); } catch {}
    sourceNode = null;
  }
}

function startAudioFrom(offsetSec) {
  if (!foaBuffer) return;

  stopAudio();

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = foaBuffer;

  const inNode = foaDecoder.input || foaDecoder._input;
  const outNode = foaDecoder.output || foaDecoder._output || foaDecoder.out;
  if (!inNode || !outNode) throw new Error("Omnitone nodes missing. keys=" + Object.keys(foaDecoder).join(","));

  sourceNode.connect(inNode);
  outNode.connect(audioCtx.destination);

  // ✅ offsetSec 可能略大于 buffer.duration，做个 clamp
  const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, foaBuffer.duration - 0.001)));
  sourceNode.start(0, safeOffset);
}

function updateFoaRotation() {
  if (!foaDecoder) return;
  const m4 = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
  const m3 = new THREE.Matrix3().setFromMatrix4(m4);
  const e = m3.elements;

  if (typeof foaDecoder.setRotationMatrix3 === "function") foaDecoder.setRotationMatrix3(e);
  else if (typeof foaDecoder.setRotationMatrix === "function") foaDecoder.setRotationMatrix(e);
}

async function loadAndPlay(idx) {
  const item = playlist[idx];

  avStarted = false;

  // ---------- 停止旧视频 ----------
  try {
    videoEl.pause();
    videoEl.currentTime = 0;
  } catch {}

  // ---------- 停止旧音频 ----------
  stopAudio();

  // ---------- 加载新 FOA ----------
  foaBuffer = await loadFOAWavFrom(item.foa);

  // ---------- 加载新视频 ----------
  videoEl.src = item.video;
  videoEl.load();
  await waitCanPlay(videoEl);

  // ---------- 播放：从 0 开始 ----------
  videoEl.currentTime = 0;

  // 确保 audioCtx 正在 running
  if (audioCtx?.state === "suspended") await audioCtx.resume();

  await videoEl.play();

  // yaw 基准
  baseYaw = camera.rotation.y;

  // ✅ 音频从 0 同步开始
  startAudioFrom(0);
  avStarted = true;

  // ---------- 同步处理：拖动 / 暂停 / 播放 ----------
  videoEl.onseeking = () => {
    if (!foaBuffer) return;
    avStarted = false;
    startAudioFrom(videoEl.currentTime);
    avStarted = true;
  };

  videoEl.onpause = async () => {
    avStarted = false;
    // 你想“暂停视频就暂停音频”：
    if (audioCtx?.state === "running") await audioCtx.suspend();
  };

  videoEl.onplay = async () => {
    if (audioCtx?.state === "suspended") await audioCtx.resume();
    startAudioFrom(videoEl.currentTime);
    avStarted = true;
  };

  // 播放结束：停掉音频 + 停止旋转
  videoEl.onended = () => {
    avStarted = false;
    stopAudio();
  };
}

// ---------- render loop ----------
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // rotate exactly 360° over the whole video duration, only after AV started
  if (avStarted && autoYaw && videoEl.duration > 0 && !videoEl.paused) {
    const progress = THREE.MathUtils.clamp(videoEl.currentTime / videoEl.duration, 0, 1);
    const angle = progress * Math.PI * 2;
    camera.rotation.set(0, baseYaw - angle, 0);
  }

  updateFoaRotation();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});




// console.log("MAIN VERSION = 2026-02-10-FOA-1");
// import * as THREE from "three";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// import * as Omnitone from "./vendor/omnitone.esm.js";

// const O = Omnitone.default ?? Omnitone.Omnitone ?? Omnitone;
// console.log("Omnitone module keys:", Object.keys(Omnitone));
// console.log("Omnitone API keys:", Object.keys(O));


// console.log("✅ main.js loaded");

// document.body.style.margin = "0";
// document.body.style.overflow = "hidden";
// document.body.style.background = "black";

// // ---------- three scene ----------
// const scene = new THREE.Scene();
// const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// camera.position.set(0, 0, 0.01);

// const renderer = new THREE.WebGLRenderer({ antialias: true });
// renderer.setSize(window.innerWidth, window.innerHeight);
// renderer.domElement.style.position = "fixed";
// renderer.domElement.style.inset = "0";
// renderer.domElement.style.zIndex = "0";
// document.body.appendChild(renderer.domElement);

// // controls: no 360 degree rotation 

// // const controls = new OrbitControls(camera, renderer.domElement);
// // controls.enableZoom = false;
// // controls.enablePan = false;
// // controls.autoRotate = false;

// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enableZoom = false;
// controls.enablePan = false;

// // 自动旋转
// // controls.autoRotate = true;
// // controls.autoRotateSpeed = 2;   // 数值越大转得越快（可调 0.2~2）

// // 关闭恒速 autoRotate（我们用视频进度驱动）
// controls.autoRotate = false;

// // 更顺滑（可选）
// controls.enableDamping = true;
// controls.dampingFactor = 0.05;

// // 防止上下翻（可选：只水平绕一圈）
// controls.minPolarAngle = Math.PI / 2;
// controls.maxPolarAngle = Math.PI / 2;

// // newly added
// controls.addEventListener("start", () => {
//   autoYaw = false;
// });

// controls.addEventListener("end", () => {
//   // 让松手后的当前朝向成为新的 baseYaw（保持进度连续）
//   if (videoEl.duration > 0) {
//     const progress = THREE.MathUtils.clamp(videoEl.currentTime / videoEl.duration, 0, 1);
//     const angle = progress * Math.PI * 2;
//     baseYaw = camera.rotation.y + angle;
//   } else {
//     baseYaw = camera.rotation.y;
//   }
//   autoYaw = true;
// });


// // newly added
// let baseYaw = 0;          // 起始 yaw（用户可以通过拖动改变它）
// let autoYaw = true;       // 是否让视频驱动 yaw
// let avStarted = false;    // ✅ 新增：音频真正start之后才允许自动旋转

// // ---------- 360 video texture ----------
// const videoEl = document.createElement("video");
// videoEl.src = "/video.webm";
// videoEl.crossOrigin = "anonymous";
// videoEl.loop = false;
// videoEl.muted = true;        // 音频由 WebAudio(FOA)播放
// videoEl.playsInline = true;
// videoEl.preload = "auto";

// const videoTex = new THREE.VideoTexture(videoEl);
// videoTex.colorSpace = THREE.SRGBColorSpace;

// const sphereGeo = new THREE.SphereGeometry(10, 96, 96);
// sphereGeo.scale(-1, 1, 1); // inside-out
// const sphereMat = new THREE.MeshBasicMaterial({ map: videoTex });
// scene.add(new THREE.Mesh(sphereGeo, sphereMat));

// // ---------- FOA audio (WebAudio + Omnitone) ----------
// let audioCtx, foaDecoder, foaBuffer, sourceNode;

// async function waitCanPlay(v) {
//   if (v.readyState >= 2) return;
//   await new Promise((resolve, reject) => {
//     v.oncanplay = () => resolve();
//     v.onerror = () => reject(new Error("video load error: check /public/video.webm"));
//   });
// }

// async function loadFOAWav() {
//   const resp = await fetch("/foa.wav");
//   if (!resp.ok) throw new Error(`Failed to fetch /foa.wav (${resp.status}) — put foa.wav in /public`);
//   const arr = await resp.arrayBuffer();
//   const buf = await audioCtx.decodeAudioData(arr);
//   if (buf.numberOfChannels !== 4) throw new Error(`foa.wav has ${buf.numberOfChannels} channels, expected 4`);
//   return buf;
// }

// function startAudioFrom(offsetSec) {
//   if (sourceNode) {
//     try { sourceNode.stop(); } catch {}
//     try { sourceNode.disconnect(); } catch {}
//   }
//   sourceNode = audioCtx.createBufferSource();
//   sourceNode.buffer = foaBuffer;

//   const inNode = foaDecoder.input || foaDecoder._input;
//   const outNode = foaDecoder.output || foaDecoder._output || foaDecoder.out;
  
//   if (!inNode || !outNode) {
//     throw new Error("Omnitone nodes missing. keys=" + Object.keys(foaDecoder).join(","));
//   }
  
//   sourceNode.connect(inNode);
//   outNode.connect(audioCtx.destination);

//   sourceNode.start(0, offsetSec);
// }

// function updateFoaRotation() {
//   if (!foaDecoder) return;
//   const m4 = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
//   const m3 = new THREE.Matrix3().setFromMatrix4(m4);
//   const e = m3.elements;

//   if (typeof foaDecoder.setRotationMatrix3 === "function") foaDecoder.setRotationMatrix3(e);
//   else if (typeof foaDecoder.setRotationMatrix === "function") foaDecoder.setRotationMatrix(e);
// }

// // ---------- start button wiring ----------
// async function startAll() {

//   avStarted = false; // newly added
  
//   audioCtx = new (window.AudioContext || window.webkitAudioContext)();
//   const create =
//   O.createFOADecoder ??
//   O.createFOARenderer ??
//   O.createRenderer;

//   if (!create) {
//     throw new Error("No FOA factory in Omnitone. API keys=" + Object.keys(O).join(","));
//   }

//   foaDecoder = await create(audioCtx);
//   if (foaDecoder.initialize) await foaDecoder.initialize();


//   foaBuffer = await loadFOAWav();

//   // DEBUG: 把 video 元素直接显示出来，确认能否播放
//   // videoEl.style.position = "fixed";
//   // videoEl.style.right = "16px";
//   // videoEl.style.bottom = "16px";
//   // videoEl.style.width = "320px";
//   // videoEl.style.border = "3px solid yellow";
//   // videoEl.style.zIndex = "99999";
//   // document.body.appendChild(videoEl);

//   await audioCtx.resume();
//   await waitCanPlay(videoEl);
//   await videoEl.play();

//   // newly added
//   // 记录当前朝向作为起点（开始自动旋转的基准）
//   baseYaw = camera.rotation.y;

//   // ✅ 先启动FOA，再允许旋转
//   startAudioFrom(videoEl.currentTime);
//   avStarted = true;

//   // keep sync on seek/play/pause
//   videoEl.addEventListener("seeking", () => startAudioFrom(videoEl.currentTime));
//   videoEl.addEventListener("pause", async () => {
//     avStarted = false; // ✅ 新增
//     if (audioCtx.state === "running") await audioCtx.suspend();
//   });
//   videoEl.addEventListener("play", async () => {
//     if (audioCtx.state === "suspended") await audioCtx.resume();
//     startAudioFrom(videoEl.currentTime);
//     avStarted = true; // ✅ 新增
//   });
// }

// window.addEventListener("DOMContentLoaded", () => {
//   const btn = document.getElementById("btn");
//   if (!btn) return;

//   btn.addEventListener("click", async () => {
//     console.log("✅ button clicked");
//     try {
//       btn.disabled = true;
//       await startAll();
//       btn.style.display = "none";
//     } catch (e) {
//       console.error(e);
//       alert(e?.message || String(e));
//       btn.disabled = false;
//     }
//   });
// });

// // render loop
// // function animate() {
// //   requestAnimationFrame(animate);
// //   controls.update();
// //   updateFoaRotation();
// //   renderer.render(scene, camera);
// // }

// // newly added
// function animate() {
//   requestAnimationFrame(animate);

//   // 先让 OrbitControls 响应用户拖动（会改 camera.quaternion）
//   controls.update();

//   // 用视频进度驱动：播放期间 yaw 走完 360°
//   if (avStarted && autoYaw && videoEl.duration > 0 && !videoEl.paused) {
//     const progress = THREE.MathUtils.clamp(videoEl.currentTime / videoEl.duration, 0, 1);
//     const angle = progress * Math.PI * 2;
//     camera.rotation.set(0, baseYaw - angle, 0);
//   }

//   updateFoaRotation();
//   renderer.render(scene, camera);
// }


// animate();

// window.addEventListener("resize", () => {
//   camera.aspect = window.innerWidth / window.innerHeight;
//   camera.updateProjectionMatrix();
//   renderer.setSize(window.innerWidth, window.innerHeight);
// });
