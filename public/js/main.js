/* Пепел и Вереск — точка входа и игровой цикл */
import { World } from "./world.js";
import { createMap, TILE } from "./map.js";
import { CLASSES, TIPS } from "./data.js";
import { Renderer } from "./render.js";
import { Input } from "./input.js";
import { AudioEngine } from "./audio.js";
import { UI } from "./ui.js";
import { Net, defaultWsUrl, expandJoinCandidates } from "./net.js";

const SAVE_KEY = "ash-heather-save-v1";
const SETTINGS_KEY = "ash-heather-settings-v1";

const canvas = document.getElementById("game");
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
const ui = new UI({ sound: (name) => audio.play(name) });

let settings = loadSettings();
let saveData = loadSave();

let mode = null; // solo | host | client
let world = null;
let clientMap = null;
let net = null;
let myId = null;
let myName = "Странник";
let myClass = "lantern";
let running = false;
let paused = false;
let gameEnded = false;
let scene = null;
let latestSnap = null;
let prevSnap = null;
let snapAge = 0;
let lastEventId = 0;
let interp = new Map();
let roomAddress = "";
let pendingJoins = [];
let clientReadyTimer = null;
let finalSnapSent = false;
let sessionToken = 0;

let lastFrame = performance.now();
let hudTimer = 0;
let saveTimer = 0;
let snapTimer = 0;
let hostDbgTimer = 1;
let moveTimer = 0;
let holdTimer = 0;
let hitSoundTimer = 0;
let tipTimer = 0;
let tipIndex = 0;
let lastSentMove = { x: 0, y: 0 };

/* ---------- настройки и сохранение ---------- */
function loadSettings() {
  const base = { music: 55, sfx: 75, reduce: false, hints: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.player) return null;
    return data;
  } catch {
    return null;
  }
}

function persistSave() {
  if (!world || !myId || gameEnded) return;
  if (mode !== "solo" && mode !== "host") return;
  try {
    const data = world.serialize(myId);
    if (data) {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      saveData = loadSave();
      ui.setContinueAvailable(true);
    }
  } catch {}
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  saveData = null;
  ui.setContinueAvailable(false);
}

function applySettings(next) {
  settings = { ...settings, ...next };
  audio.setMusic(settings.music / 100);
  audio.setSfx(settings.sfx / 100);
  renderer.setReduced(!!settings.reduce);
  if (!settings.hints) ui.setHint("");
  persistSettings();
}

function randomSeed() {
  return ((Date.now() & 0x7fffffff) ^ (Math.random() * 0x7fffffff)) >>> 0;
}

function setupMap(sessionMode) {
  if (sessionMode === "client") {
    if (clientMap) renderer.sceneTiles = clientMap.tiles;
    return;
  }
  if (world) renderer.sceneTiles = world.map.tiles;
  renderer.setReduced(!!settings.reduce);
}

/* ---------- меню ---------- */
ui.onSolo = () => {
  audio.unlock();
  ui.openChar("solo");
};
ui.onHost = async () => {
  audio.unlock();
  ui.openChar("host");
  try {
    const d = await fetchStatus();
    if (d && !d.host) ui.setRoomChip("");
  } catch {}
};
ui.onJoin = () => {
  audio.unlock();
  ui.openChar("join");
  if (window.AshNative?.isEmbedded?.()) {
    const value = String(ui.el.joinUrl.value || "");
    if (!value || /^wss?:\/\/(127\.0\.0\.1|localhost)(?=[:/]|$)/i.test(value)) ui.setJoinAddress("");
  } else if (!ui.el.joinUrl.value && location.protocol.startsWith("http")) {
    ui.setJoinAddress(defaultWsUrl());
  }
};
ui.onCharBack = () => ui.showMenu();
ui.onCharStart = (cfg) => {
  audio.unlock();
  if (ui.mode === "join") startClient(cfg);
  else if (ui.mode === "host") startHost(cfg);
  else startSolo(cfg);
};
ui.onContinue = () => {
  audio.unlock();
  const data = loadSave();
  if (!data) {
    ui.toast("Сохранение не найдено.");
    return;
  }
  startSolo({ name: data.player.name, cls: data.player.cls }, data);
};
ui.onPause = () => togglePause();
ui.onResume = () => resumeGame();
ui.onMenu = () => {
  endSession();
  ui.showMenu();
};
ui.onEndMenu = () => {
  endSession();
  ui.showMenu();
};
ui.onSettingsChange = (s) => applySettings(s);
ui.onFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      const fn = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (!fn) throw new Error("no fullscreen");
      await fn.call(document.documentElement);
    } else {
      await document.exitFullscreen();
    }
  } catch {
    ui.toast("Полный экран недоступен в этом браузере.");
  }
};

/* ---------- запуск сессий ---------- */
function resetSessionState() {
  running = false;
  paused = false;
  gameEnded = false;
  scene = null;
  latestSnap = null;
  prevSnap = null;
  snapAge = 0;
  lastEventId = 0;
  interp = new Map();
  finalSnapSent = false;
  pendingJoins = [];
  roomAddress = "";
  snapTimer = 0;
  moveTimer = 0;
  holdTimer = 0;
  tipTimer = 0;
  lastSentMove = { x: 0, y: 0 };
  if (clientReadyTimer) {
    clearTimeout(clientReadyTimer);
    clientReadyTimer = null;
  }
}

function beginVisuals() {
  ui.showGame();
  ui.updateRotate(true);
  renderer.setReduced(!!settings.reduce);
  showTipSoon();
}

function showTipSoon() {
  tipTimer = 2.2;
  tipIndex = Math.floor(Math.random() * TIPS.length);
}

function startSolo(cfg, restore) {
  const token = ++sessionToken;
  resetSessionState();
  ui.setFade(true);
  mode = "solo";
  myId = "local";
  myName = cfg.name || "Странник";
  myClass = cfg.cls || "lantern";
  const seed = restore?.seed ?? randomSeed();
  try {
    world = new World({ seed, solo: true });
    let ok = false;
    if (restore) ok = world.restoreSave(restore, "local");
    if (!ok) world.addPlayer("local", myName, myClass);
    const me = world.players.get("local");
    if (me) {
      myName = me.name;
      myClass = me.cls;
    }
    setupMap();
    running = true;
    ui.setRoomChip("глава I · один в тумане");
    beginVisuals();
    setTimeout(() => {
      if (token !== sessionToken) return;
      ui.setFade(false);
      if (restore) ui.toast("Огонь помнит тебя. Глава продолжается.");
      else ui.toast("Ты входишь в туман. Имя пока при тебе.");
      persistSave();
    }, 260);
  } catch (err) {
    console.error(err);
    ui.setFade(false);
    ui.toast("Не удалось зажечь мир: " + (err?.message || "ошибка"));
    endSession();
    ui.showMenu();
  }
}

async function startHost(cfg) {
  const token = ++sessionToken;
  resetSessionState();
  ui.setFade(true);
  mode = "host";
  myName = cfg.name || "Странник";
  myClass = cfg.cls || "lantern";
  try {
    let nativeUrl = "";
    if (window.AshNative?.startHost) {
      try {
        nativeUrl = String(window.AshNative.startHost() || "");
        if (nativeUrl) roomAddress = nativeUrl;
      } catch (err) {
        throw new Error("Не удалось запустить локальный сервер приложения");
      }
    }
    net = new Net({
      onMessage: handleHostMessage,
      onClose: handleHostClose,
      onError: (e) => ui.toast(e.message),
    });
    const wsUrl = defaultWsUrl();
    const welcome = await net.connect(wsUrl, { role: "host", name: myName, cls: myClass });
    if (token !== sessionToken) {
      net.close(true);
      return;
    }
    myId = welcome.id;
    world = new World({ seed: randomSeed() });
    world.addPlayer(myId, myName, myClass);
    setupMap();
    running = true;
    ui.setRoomChip("хост · 1/4");
    beginVisuals();
    if (!roomAddress) roomAddress = await resolveRoomAddress();
    updateRoomLabel();
    if (roomAddress) {
      ui.toast(`Друзья открывают: ${roomAddress}`);
    } else if (window.AshNative?.isEmbedded?.()) {
      ui.toast("WiFi не найден. Включи WiFi, чтобы друзья смогли подключиться.");
    } else {
      ui.toast("Хост открыт. Покажи друзьям адрес этой вкладки.");
    }
    for (const j of pendingJoins) addRemotePlayer(j);
    pendingJoins = [];
    setTimeout(() => {
      if (token === sessionToken) ui.setFade(false);
    }, 260);
    persistSave();
  } catch (err) {
    console.error(err);
    try { net?.close(true); } catch {}
    net = null;
    world = null;
    running = false;
    mode = null;
    ui.setFade(false);
    ui.toast(err?.message || "Не удалось создать игру");
    ui.openChar("host");
  }
}

async function startClient(cfg) {
  const token = ++sessionToken;
  resetSessionState();
  const address = (cfg.joinUrl || "").trim();
  if (!address) {
    ui.toast("Введи адрес хоста.");
    return;
  }
  ui.setFade(true);
  mode = "client";
  myName = cfg.name || "Странник";
  myClass = cfg.cls || "lantern";
  let lastErr = null;
  try {
    const candidates = await expandJoinCandidates(address);
    net = new Net({
      onMessage: handleClientMessage,
      onClose: handleClientClose,
      onError: (e) => ui.toast(e.message),
    });
    let welcome = null;
    for (const url of candidates) {
      try {
        welcome = await net.connect(url, { role: "client", name: myName, cls: myClass });
        break;
      } catch (err) {
        lastErr = err;
        net.close(true);
      }
    }
    if (!welcome) throw lastErr || new Error("Хост не отвечает");
    if (token !== sessionToken) {
      net.close(true);
      return;
    }
    myId = welcome.id;
    running = true;
    ui.showGame();
    ui.updateRotate(true);
    ui.setRoomChip("кооп · входим в туман…");
    ui.setFade(false);
    clientReadyTimer = setTimeout(() => {
      if (token === sessionToken && running && !latestSnap) {
        ui.toast("Хост не прислал мир. Проверь адрес и WiFi.");
        endSession();
        ui.openChar("join");
      }
    }, 10000);
  } catch (err) {
    console.error(err);
    try { net?.close(true); } catch {}
    net = null;
    mode = null;
    running = false;
    ui.setFade(false);
    ui.setRoomChip("");
    ui.toast(err?.message || "Не удалось подключиться");
    ui.openChar("join");
  }
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveRoomAddress() {
  try {
    if (window.AshNative?.getLanUrl) {
      const url = window.AshNative.getLanUrl();
      if (url) return String(url);
    }
  } catch {}
  try {
    const data = await fetchStatus();
    if (data?.lan?.length) return `http://${data.lan[0]}:${data.port || location.port || 8080}`;
  } catch {}
  if (/^https?:/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) return location.origin;
  return "";
}

function updateRoomLabel() {
  if (!running && !world && !latestSnap) return;
  const count = latestSnap?.players?.length || world?.players?.size || 1;
  if (mode === "solo") {
    ui.setRoomChip("глава I · один в тумане");
  } else if (mode === "host") {
    const short = roomAddress ? roomAddress.replace(/^https?:\/\//, "") : "";
    ui.setRoomChip(short ? `хост · ${count}/4 · ${short}` : `хост · ${count}/4`);
  } else if (mode === "client") {
    ui.setRoomChip(`кооп · ${count}/4`);
  }
}

function endSession(showFade = false) {
  sessionToken += 1;
  if (world && myId && !gameEnded) persistSave();
  try { net?.close(true); } catch {}
  net = null;
  world = null;
  clientMap = null;
  mode = null;
  running = false;
  paused = false;
  gameEnded = false;
  scene = null;
  latestSnap = null;
  prevSnap = null;
  myId = null;
  interp = new Map();
  renderer.sceneTiles = null;
  ui.hideDialogue();
  ui.hidePause();
  ui.el.settings?.classList.add("hidden");
  ui.el.help?.classList.add("hidden");
  ui.el.end?.classList.add("hidden");
  ui.showHud(false);
  ui.setRoomChip("");
  if (showFade) ui.setFade(true);
}

/* INIT_MAIN_2 */
/* ---------- сетевые события ---------- */
function handleHostMessage(msg) {
  if (mode !== "host") return;
  if (msg.t === "join") {
    if (!world) pendingJoins.push(msg);
    else addRemotePlayer(msg);
  } else if (msg.t === "leave") {
    if (!world || !msg.id) return;
    const p = world.players.get(msg.id);
    const name = p?.name || "Странник";
    world.removePlayer(msg.id);
    ui.toast(`${name} ушёл в туман.`);
    updateRoomLabel();
  } else if (msg.t === "input") {
    if (world && msg.from) world.setMove(msg.from, msg.mx, msg.my);
  } else if (msg.t === "action") {
    if (world && msg.from) world.action(msg.from, msg.action, msg.data || {});
  } else if (msg.t === "chat") {
    if (msg.text) ui.toast(`${msg.name}: ${msg.text}`);
  }
}

function handleHostClose() {
  if (mode !== "host" || !running) return;
  ui.toast("Локальный сервер закрылся. Комната погасла.");
  endSession();
  ui.showMenu();
}

function addRemotePlayer(j) {
  if (!world) {
    pendingJoins.push(j);
    return;
  }
  if (world.players.has(j.id)) return;
  const spawn = world.findSpawn(46 * TILE, 35.5 * TILE);
  world.addPlayer(j.id, j.name, j.cls, { x: spawn.x, y: spawn.y });
  net?.send({ t: "event", to: j.id, type: "worldSeed", seed: world.seed });
  ui.toast(`${j.name || "Странник"} присоединился к костру.`);
  ui.setRoomChip(`хост · ${world.players.size}/4${roomAddress ? " · " + roomAddress.replace(/^https?:\/\//, "") : ""}`);
  audio.play("ember");
}

function maxEventId(events) {
  let max = 0;
  for (const e of events || []) if (e.id > max) max = e.id;
  return max;
}

function handleClientMessage(msg) {
  if (mode !== "client" || !running) return;
  if (window.__ASH_DEBUG__) console.log("[client msg]", msg.t, msg.snap ? `t=${msg.snap.t} players=${msg.snap.players?.length}` : "");
  if (msg.t === "snap") {
    const snap = msg.snap;
    if (!snap) return;
    if (!clientMap && msg.seed != null) {
      clientMap = createMap(msg.seed);
      renderer.sceneTiles = clientMap.tiles;
    }
    latestSnap = snap;
    snapAge = 0;
    if (!prevSnap) {
      lastEventId = maxEventId(snap.events);
    } else if (snap.events) {
      handleEvents(snap.events);
    }
    prevSnap = snap;
    if (clientReadyTimer) {
      clearTimeout(clientReadyTimer);
      clientReadyTimer = null;
    }
    updateRoomLabel();
    return;
  }
  if (msg.t === "event") {
    if (msg.type === "worldSeed" && !clientMap) {
      clientMap = createMap(msg.seed);
      renderer.sceneTiles = clientMap.tiles;
    }
    return;
  }
  if (msg.t === "hostLeft") {
    ui.toast(msg.message || "Хост покинул игру. Комната закрыта.");
    endSession();
    ui.showMenu();
    return;
  }
  if (msg.t === "presence") {
    updateRoomLabel();
  }
}

function handleClientClose() {
  if (mode !== "client" || !running) return;
  ui.toast("Связь с хостом потеряна.");
  endSession();
  ui.showMenu();
}

/* ---------- ввод ---------- */
const input = new Input({
  onAction: (action) => {
    audio.unlock();
    if (!running || paused || gameEnded || !myId) return;
    if (!ui.el.settings.classList.contains("hidden") || !ui.el.help.classList.contains("hidden")) return;
    if (ui.isDialogueOpen()) {
      if (action === "attack") {
        if (ui.typing) ui.finishTyping();
        else if (!ui.dialogueView?.choices?.length) ui.dialogueHandlers.close();
      }
      return;
    }
    sendAction(action);
    if (action === "attack") holdTimer = 0.28;
  },
  onPause: () => {
    if (!running || gameEnded) return;
    if (!ui.el.settings.classList.contains("hidden")) {
      ui.closeSettings();
      return;
    }
    if (!ui.el.help.classList.contains("hidden")) {
      ui.closeHelp();
      return;
    }
    togglePause();
  },
  onChoice: (index) => {
    if (running && ui.isDialogueOpen()) ui.chooseDialogue(index);
  },
});

function sendAction(action, data = {}) {
  if (!running || !myId) return;
  if (mode === "client") {
    net?.send({ t: "action", action, data });
  } else if (world) {
    world.action(myId, action, data);
  }
}

function togglePause() {
  if (!running || gameEnded) return;
  if (paused) {
    resumeGame();
    return;
  }
  paused = true;
  input.setEnabled(false);
  input.reset();
  if (mode === "client") net?.send({ t: "input", mx: 0, my: 0 });
  else if (world && myId) world.setMove(myId, 0, 0);
  lastSentMove = { x: 0, y: 0 };
  const note = mode === "solo"
    ? "Мир замер вместе с тобой."
    : mode === "host"
      ? "Ты остановил время для всей комнаты. Остальные ждут."
      : "Для тебя время остановилось. Остальные продолжают путь.";
  ui.showPause(note, true);
}

function resumeGame() {
  if (!running) return;
  paused = false;
  input.setEnabled(true);
  input.clearHeld();
  ui.hidePause();
  ui.el.settings?.classList.add("hidden");
}

window.addEventListener("resize", () => ui.updateRotate(running));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running && !paused && !gameEnded && mode === "solo") togglePause();
});
window.addEventListener("beforeunload", () => {
  if (world && myId && !gameEnded && (mode === "solo" || mode === "host")) persistSave();
  try { net?.close(true); } catch {}
});

/* ---------- игровой цикл ---------- */
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);
  if (running) {
    try {
      tick(dt);
    } catch (err) {
      console.error("[loop]", err);
    }
  } else {
    renderer.update(dt, null, null);
    renderer.draw(null);
  }
}

/* INIT_MAIN_3 */
function tick(dt) {
  const dialogueOpen = ui.isDialogueOpen();
  const canControl = !paused && !gameEnded && !dialogueOpen;
  const mv = canControl ? input.move : { x: 0, y: 0 };

  if (mode === "client") {
    moveTimer -= dt;
    const changed = Math.abs(mv.x - lastSentMove.x) > 0.03 || Math.abs(mv.y - lastSentMove.y) > 0.03;
    if (moveTimer <= 0 && (changed || (mv.x || mv.y))) {
      net?.send({ t: "input", mx: mv.x, my: mv.y });
      lastSentMove = { x: mv.x, y: mv.y };
      moveTimer = 0.05;
    } else if (!mv.x && !mv.y && (lastSentMove.x || lastSentMove.y)) {
      net?.send({ t: "input", mx: 0, my: 0 });
      lastSentMove = { x: 0, y: 0 };
    }
  } else if (world && myId) {
    world.setMove(myId, mv.x, mv.y);
  }

  if (canControl && input.isHeld("attack")) {
    holdTimer -= dt;
    if (holdTimer <= 0) {
      sendAction("attack");
      holdTimer = 0.16;
    }
  } else {
    holdTimer = 0;
  }

  if ((mode === "solo" || mode === "host") && world) {
    if (!paused && !gameEnded) {
      world.update(dt);
      handleEvents(world.events);
      saveTimer -= dt;
      if (saveTimer <= 0) {
        saveTimer = 15;
        persistSave();
      }
    }
    scene = buildLocalScene();
    if (mode === "host") {
      if (window.__ASH_DEBUG__) {
        hostDbgTimer -= dt;
        if (hostDbgTimer <= 0) {
          hostDbgTimer = 1;
          console.log("[host state]", {
            players: world.players.size,
            connected: !!net?.connected,
            ended: gameEnded,
            snapTimer,
            time: Math.round(world.time * 10) / 10,
          });
        }
      }
      snapTimer -= dt;
      if (net?.connected && (!gameEnded || !finalSnapSent) && (snapTimer <= 0 || (gameEnded && !finalSnapSent))) {
        snapTimer = 0.066;
        const snap = world.snapshot(null);
        const sent = net.send({ t: "snap", seed: world.seed, snap });
        if (window.__ASH_DEBUG__ && Math.random() < 0.12) console.log("[host snap]", snap.t, sent, snap.players.length);
        if (gameEnded) finalSnapSent = true;
      }
    }
  } else if (mode === "client") {
    snapAge += dt;
    scene = buildClientScene(dt);
    if (!gameEnded && latestSnap && snapAge > 6) {
      ui.toast("Тишина в тумане. Хост не отвечает.");
      endSession();
      ui.showMenu();
      return;
    }
  }

  if (!scene) {
    renderer.update(dt, null, null);
    renderer.draw(null);
    return;
  }

  const me = scene.players?.find((p) => p.id === myId) || scene.players?.[0];
  if (me) {
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.07;
      ui.updateHud(scene, myId);
    }
    if (me.dialogue && !gameEnded) {
      ui.renderDialogue(me.dialogue, {
        choose: (i) => sendAction("choice", { index: i }),
        close: () => sendAction("closeDialogue"),
      });
    } else if (running) {
      ui.hideDialogue();
    }
    const hint = settings.hints && !paused && !gameEnded ? computeHint(scene, me) : "";
    ui.setHint(hint);
  }

  if (settings.hints && tipTimer > 0 && !paused && !gameEnded) {
    tipTimer -= dt;
    if (tipTimer <= 0) {
      ui.toast(TIPS[tipIndex % TIPS.length]);
      tipIndex++;
      tipTimer = 75 + Math.random() * 30;
    }
  }

  renderer.update(dt, scene, myId);
  renderer.draw(scene, myId);
  audio.update(dt);
}

function buildLocalScene() {
  if (!world) return null;
  const snap = world.snapshot(null);
  snap.props = world.map.props;
  snap.landmarks = world.map.landmarks;
  snap.myId = myId;
  return snap;
}

function buildClientScene(dt) {
  if (!latestSnap) return null;
  const snap = latestSnap;
  if (!snap.players?.some((p) => p.id === myId)) return null;
  const k = 1 - Math.pow(0.00002, Math.min(dt, 0.05));
  const smooth = (key, x, y) => {
    let ip = interp.get(key);
    if (!ip || Math.hypot(ip.x - x, ip.y - y) > 220) {
      ip = { x, y };
      interp.set(key, ip);
    }
    ip.x += (x - ip.x) * k;
    ip.y += (y - ip.y) * k;
    return ip;
  };
  const players = (snap.players || []).map((p) => {
    const ip = smooth("p:" + p.id, p.x, p.y);
    return { ...p, x: ip.x, y: ip.y };
  });
  const enemies = (snap.enemies || []).map((e) => {
    const ip = smooth("e:" + e.id, e.x, e.y);
    return { ...e, x: ip.x, y: ip.y };
  });
  const age = Math.min(snapAge, 0.09);
  const projectiles = (snap.projectiles || []).map((p) => ({
    ...p,
    x: p.x + p.vx * age,
    y: p.y + p.vy * age,
  }));
  return {
    ...snap,
    players,
    enemies,
    projectiles,
    props: clientMap?.props || [],
    landmarks: clientMap?.landmarks || {},
    myId,
  };
}

function computeHint(scene, me) {
  if (!me || me.downed || me.talking) return "";
  const players = scene.players || [];
  for (const other of players) {
    if (other.id === me.id || !other.downed) continue;
    if (Math.hypot(me.x - other.x, me.y - other.y) < 74) return `Действие — поднять ${other.name}`;
  }
  const npcs = scene.npcs || [];
  let best = null;
  for (const npc of npcs) {
    const d = Math.hypot(me.x - npc.x, me.y - npc.y);
    if (d < 68 && (!best || d < best.d)) best = { d, text: `Действие — поговорить · ${npc.name}` };
  }
  for (const p of scene.props || []) {
    if (!p.interact) continue;
    const d = Math.hypot(me.x - p.x, me.y - p.y);
    if (d > 70 + (p.r || 0) * 0.4) continue;
    let text = "Действие — осмотреть";
    if (p.interact.kind === "campfire") text = "Действие — отдохнуть у огня";
    else if (p.interact.kind === "door") text = scene.flags?.chapelOpen ? "Действие — войти в часовню" : "Действие — осмотреть дверь";
    else if (p.interact.kind === "shrine") text = "Действие — коснуться алтаря";
    else if (p.interact.kind === "dialogue") {
      if (p.interact.script === "nameTree") text = "Действие — слушать Дерево Имён";
      else if (p.interact.script?.startsWith("note")) text = "Действие — прочитать";
      else text = "Действие — коснуться";
    }
    if (!best || d < best.d) best = { d, text };
  }
  return best?.text || "";
}

/* INIT_MAIN_4 */
let lastHitSoundAt = 0;
let lastSlashSoundAt = 0;

function eventPlayerPos(id) {
  const fromWorld = world?.players.get(id);
  if (fromWorld) return { x: fromWorld.x, y: fromWorld.y };
  const fromSnap = latestSnap?.players?.find((p) => p.id === id);
  if (fromSnap) return { x: fromSnap.x, y: fromSnap.y };
  return null;
}

function handleEvents(events) {
  if (!events || !events.length) return;
  for (const e of events) {
    if (!e || e.id <= lastEventId) continue;
    lastEventId = e.id;
    routeEvent(e);
  }
}

function routeEvent(e) {
  switch (e.type) {
    case "whisper":
      ui.toast(`«${e.text}»`);
      audio.play("whisper");
      break;
    case "toast":
      ui.toast(e.text);
      break;
    case "dialogue":
    case "dialogueAdvance":
      audio.play("dialogue");
      break;
    case "hit":
      renderer.addBurst("hit", e.x, e.y, { color: e.boss ? "#a9d3ef" : "#d08a7a", count: e.boss ? 9 : 5 });
      if (e.elite || e.boss || e.amount >= 16) {
        renderer.addFloater(e.x, e.y - 22, `−${e.amount}`, e.boss ? "#cfe4f4" : "#f0c8b8", e.boss);
      }
      if (performance.now() - lastHitSoundAt > 55) {
        lastHitSoundAt = performance.now();
        audio.play("hit");
      }
      break;
    case "slash":
      renderer.addBurst("slash", e.x, e.y, { a: e.a, range: e.range, cls: e.cls });
      if (performance.now() - lastSlashSoundAt > 55) {
        lastSlashSoundAt = performance.now();
        audio.play("slash");
      }
      break;
    case "shoot":
      renderer.addBurst("particle", e.x + Math.cos(e.a) * 14, e.y + Math.sin(e.a) * 14, {
        a: e.a, spread: 0.5, speed: 60, color: "#d7e8c8", count: 3, ttl: 0.25,
      });
      audio.play("shoot");
      break;
    case "pierce":
      renderer.addBurst("particle", e.x, e.y, { a: e.a, spread: 0.35, speed: 110, color: "#b8e0c4", count: 6, ttl: 0.3 });
      audio.play("pierce");
      break;
    case "cone":
      renderer.addBurst("cone", e.x, e.y, { a: e.a, angle: e.angle, radius: e.radius });
      audio.play("cone");
      renderer.shake(3);
      break;
    case "nova":
      renderer.addBurst("nova", e.x, e.y, { radius: e.radius });
      audio.play("nova");
      break;
    case "playerHurt": {
      renderer.addBurst("hit", e.x, e.y, { color: "#c9605a", count: 9 });
      renderer.shake(e.id === myId ? 6 : 2);
      if (e.id === myId) {
        renderer.addFloater(e.x, e.y - 26, `−${e.amount}`, "#ffb0a0");
        audio.play("hurt");
      }
      break;
    }
    case "down":
      audio.play("down");
      renderer.shake(8);
      if (e.id === myId) {
        ui.toast("Тьма сомкнулась. Держись.");
        input.reset();
      }
      break;
    case "revive":
      audio.play("revive");
      renderer.addBurst("particle", e.x || 0, e.y || 0, { color: "#ffd18a", count: 18, speed: 70, lift: 30 });
      break;
    case "dodge":
      renderer.addBurst("particle", e.x, e.y, { color: "#c8d6c0", count: 5, speed: 50, ttl: 0.35 });
      audio.play("dodge");
      break;
    case "rest": {
      const pos = eventPlayerPos(e.id);
      if (pos) renderer.addBurst("particle", pos.x, pos.y, { color: "#ffd18a", count: 16, speed: 45, lift: 40, ttl: 0.9 });
      audio.play("rest");
      if (mode === "solo" || mode === "host") persistSave();
      break;
    }
    case "ember": {
      const pos = eventPlayerPos(e.id);
      if (pos) renderer.addBurst("particle", pos.x, pos.y, { color: "#ffd18a", count: 20, speed: 60, lift: 35, ttl: 0.8 });
      audio.play("ember");
      break;
    }
    case "levelUp": {
      const pos = eventPlayerPos(e.id);
      if (pos) renderer.addBurst("particle", pos.x, pos.y, { color: "#ffe6bd", count: 24, speed: 90, lift: 60, ttl: 0.9 });
      audio.play("levelUp");
      break;
    }
    case "quest":
      break;
    case "bossIntro":
      ui.toast("Плакальщик у Часовни проснулся. Он плачет о забытых именах.");
      audio.play("bossIntro");
      renderer.shake(7);
      break;
    case "bossPhase":
      ui.toast(e.phase === 3 ? "Маска треснула. Плакальщик больше не сдерживается." : "Плакальщик плачет громче. Слёзы стали острее.");
      audio.play("bossPhase");
      renderer.shake(5);
      break;
    case "bossTears":
      renderer.addBurst("particle", e.x, e.y, { color: "#a9d3ef", count: 20, speed: 120, ttl: 0.7 });
      audio.play("bossTears");
      break;
    case "bossSlam":
      renderer.addBurst("slam", e.x, e.y, { radius: e.radius || 130 });
      audio.play("bossSlam");
      renderer.shake(13);
      break;
    case "bossSummon":
      ui.toast("Тени собираются вокруг Плакальщика.");
      break;
    case "bossDead":
      renderer.addBurst("particle", e.x, e.y, { color: "#cfe4f4", count: 40, speed: 130, ttl: 1.4, gravity: 10 });
      renderer.addBurst("slam", e.x, e.y, { radius: 170 });
      renderer.shake(11);
      audio.play("ember");
      break;
    case "enemyDied":
      if (!e.boss) renderer.addBurst("particle", e.x, e.y, { color: "#6d7180", count: 8, speed: 50, ttl: 0.6 });
      break;
    case "heart":
      audio.play("chime");
      break;
    case "enemyShoot":
      break;
    case "projectileHit":
      renderer.addBurst("particle", e.x, e.y, { color: e.type === "tear" ? "#a9d3ef" : "#d8c7a1", count: 3, speed: 35, ttl: 0.25 });
      break;
    case "memoryFail":
      ui.toast(e.text || "Слишком мало Памяти.");
      break;
    case "memoryEmpty":
      ui.toast("Память пуста. Мгла ближе, чем была.");
      break;
    case "nothing":
      break;
    case "ending":
      showEnding(e.ending);
      break;
    default:
      break;
  }
}

function showEnding(kind) {
  if (gameEnded) return;
  gameEnded = true;
  paused = false;
  input.setEnabled(false);
  input.reset();
  ui.setHint("");
  let me = null;
  if (mode === "client") {
    me = latestSnap?.players?.find((p) => p.id === myId) || latestSnap?.players?.[0];
  } else if (world) {
    me = world.players.get(myId);
  }
  const embers = mode === "client" ? latestSnap?.flags?.embers ?? 0 : world?.flags.embers ?? 0;
  ui.showEnd(kind, {
    level: me?.level ?? 1,
    kills: me?.kills ?? 0,
    embers,
  });
  audio.play("ending");
  clearSave();
}

/* ---------- инициализация ---------- */
function boot() {
  ui.onSettingsChange = (s) => applySettings(s);
  ui.applySettings(settings);
  ui.setContinueAvailable(!!saveData);
  renderer.setReduced(!!settings.reduce);
  ui.showMenu();
  ui.hideBoot();
  setTimeout(() => ui.setFade(false), 30);

  const unlock = () => audio.unlock();
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });

  ui.el.roomChip?.addEventListener("click", async () => {
    if (!roomAddress) return;
    try {
      await navigator.clipboard.writeText(roomAddress);
      ui.toast("Адрес скопирован. Передай его друзьям.");
    } catch {
      ui.toast(roomAddress);
    }
  });

  window.__ASH__ = {
    get world() { return world; },
    get scene() { return scene; },
    get mode() { return mode; },
    get net() { return net; },
    get myId() { return myId; },
    get latestSnap() { return latestSnap; },
    get running() { return running; },
    renderer,
    ui,
    audio,
    settings,
    startSolo,
    startHost,
    startClient,
  };

  // Аппаратная кнопка «Назад» в APK вызывает эту функцию.
  window.AshBack = () => {
    if (running) {
      if (!ui.el.settings.classList.contains("hidden")) {
        ui.closeSettings();
        return true;
      }
      if (!ui.el.help.classList.contains("hidden")) {
        ui.closeHelp();
        return true;
      }
      if (gameEnded) {
        endSession();
        ui.showMenu();
        return true;
      }
      if (ui.isDialogueOpen()) return true;
      togglePause();
      return true;
    }
    if (ui.el.settings && !ui.el.settings.classList.contains("hidden")) {
      ui.closeSettings();
      return true;
    }
    if (ui.el.help && !ui.el.help.classList.contains("hidden")) {
      ui.closeHelp();
      return true;
    }
    if (ui.el.char && !ui.el.char.classList.contains("hidden")) {
      ui.showMenu();
      return true;
    }
    return false;
  };

  requestAnimationFrame(loop);
}

boot();

