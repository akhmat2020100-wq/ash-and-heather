/*
 * Дымовая проверка браузерного клиента без Chromium:
 * подставляем минимальный DOM/canvas, загружаем main.js, запускаем соло,
 * несколько кадров, удар и диалог с Ирмой.
 */

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  get value() {
    return [...this.set].join(" ");
  }
}

function makeContext(canvas) {
  const gradient = () => ({ addColorStop() {} });
  return {
    canvas,
    save() {},
    restore() {},
    setTransform() {},
    translate() {},
    rotate() {},
    scale() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {},
    ellipse() {},
    rect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern() {
      return null;
    },
    measureText() {
      return { width: 42 };
    },
    setLineDash() {},
    getLineDash() {
      return [];
    },
  };
}

let elementSeq = 0;

class El {
  constructor(tag = "div", id = "") {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.key = ++elementSeq;
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList();
    this.dataset = {};
    this.style = {
      setProperty() {},
      removeProperty() {},
    };
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.checked = false;
    this._text = "";
    this._html = "";
    this.width = this.tagName === "CANVAS" ? 960 : 0;
    this.height = this.tagName === "CANVAS" ? 540 : 0;
    this._ctx = null;
  }

  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = String(v ?? "");
  }

  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = String(v ?? "");
    if (this._html === "") this.children = [];
  }

  get firstChild() {
    return this.children[0] || null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "title") this.title = value;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  closest() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
    };
  }

  getContext() {
    if (!this._ctx) this._ctx = makeContext(this);
    return this._ctx;
  }

  focus() {}
  blur() {}
}

const ids = new Map();
const dataAction = [];
const html = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
const tagRe = /<(input|button|section|div|canvas|span|p|h1|h2|label|a|svg|path)([^>]*?)\bid="([^"]+)"([^>]*)>/g;
let m;
while ((m = tagRe.exec(html))) {
  const tag = m[1];
  const attrs = `${m[2]} ${m[4]}`;
  const id = m[3];
  const el = new El(tag, id);
  const value = /\bvalue="([^"]*)"/.exec(attrs);
  if (value) el.value = value[1];
  if (/\bchecked\b/.test(attrs)) el.checked = true;
  const action = /\bdata-action="([^"]*)"/.exec(attrs);
  if (action) {
    el.dataset.action = action[1];
    dataAction.push(el);
  }
  const type = /\btype="([^"]*)"/.exec(attrs);
  if (type) el.type = type[1];
  const placeholder = /\bplaceholder="([^"]*)"/.exec(attrs);
  if (placeholder) el.placeholder = placeholder[1];
  ids.set(id, el);
}

// Элементы без id, но с data-action (на случай изменения разметки).
for (const el of ids.values()) {
  if (el.dataset.action && !dataAction.includes(el)) dataAction.push(el);
}

const body = new El("body");
const documentElement = new El("html");
documentElement.requestFullscreen = async () => {};
documentElement.webkitRequestFullscreen = async () => {};

const documentStub = {
  body,
  documentElement,
  hidden: false,
  visibilityState: "visible",
  fullscreenElement: null,
  getElementById(id) {
    return ids.get(id) || null;
  },
  createElement(tag) {
    return new El(tag);
  },
  querySelectorAll(sel) {
    if (sel === "[data-action]") return dataAction;
    return [];
  },
  addEventListener() {},
  removeEventListener() {},
  exitFullscreen: async () => {},
};

const listeners = {};
const windowStub = {
  innerWidth: 960,
  innerHeight: 540,
  devicePixelRatio: 1,
  addEventListener(type, fn) {
    (listeners[type] ||= []).push(fn);
  },
  removeEventListener(type, fn) {
    const list = listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  dispatchEvent(ev) {
    for (const fn of listeners[ev.type] || []) fn(ev);
    return true;
  },
  location: null,
};

const ashPort = process.env.ASH_PORT || "8090";
const locationStub = {
  protocol: "http:",
  host: `127.0.0.1:${ashPort}`,
  hostname: "127.0.0.1",
  origin: `http://127.0.0.1:${ashPort}`,
  href: `http://127.0.0.1:${ashPort}/`,
};
windowStub.location = locationStub;

const storage = new Map();
const localStorageStub = {
  getItem(k) {
    return storage.has(k) ? storage.get(k) : null;
  },
  setItem(k, v) {
    storage.set(k, String(v));
  },
  removeItem(k) {
    storage.delete(k);
  },
};

const rafQueue = [];
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.location = locationStub;
globalThis.localStorage = localStorageStub;
globalThis.navigator = { clipboard: { writeText: async () => {} } };
globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.AudioContext = undefined;

await import("../public/js/main.js");

let now = performance.now();
function frames(n, dt = 16.7) {
  for (let i = 0; i < n; i++) {
    now += dt;
    const q = rafQueue.splice(0);
    if (!q.length) throw new Error("нет запланированного кадра");
    for (const fn of q) fn(now);
  }
}

function key(code, type = "keydown") {
  windowStub.dispatchEvent({
    type,
    code,
    repeat: false,
    target: { tagName: "BODY" },
    preventDefault() {},
  });
}

frames(5);
if (!windowStub.__ASH__) throw new Error("__ASH__ не создан");

const smokeMode = process.env.SMOKE_MODE || "solo";
globalThis.__ASH_DEBUG__ = !!process.env.ASH_DEBUG;
windowStub.__ASH_DEBUG__ = globalThis.__ASH_DEBUG__;

if (smokeMode === "client") {
  const ash = windowStub.__ASH__;
  ash.startClient({
    name: "Гость",
    cls: "hunter",
    joinUrl: process.env.JOIN_URL || `ws://127.0.0.1:${ashPort}/ws`,
  }).catch((e) => console.error("START CLIENT ERROR", e));
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    frames(1);
    if (ash.scene && ash.scene.players?.length >= 2 && ash.latestSnap) break;
  }
  if (!ash.scene || !ash.scene.players?.some((p) => p.id === ash.myId)) {
    console.error("CLIENT DEBUG", {
      mode: ash.mode,
      running: ash.running,
      myId: ash.myId,
      connected: ash.net?.connected,
      snap: !!ash.latestSnap,
      snapPlayers: ash.latestSnap?.players?.map((p) => p.id),
      scene: !!ash.scene,
    });
    throw new Error("клиент не получил сцену от хоста");
  }
  const others = ash.scene.players.filter((p) => p.id !== ash.myId);
  if (!others.length) throw new Error("клиент не увидел хоста");
  console.log("CLIENT OK", {
    myId: ash.myId,
    players: ash.scene.players.map((p) => p.name),
    hostPos: others[0] && [Math.round(others[0].x), Math.round(others[0].y)],
    props: ash.scene.props?.length || 0,
  });
  process.exit(0);
}

if (smokeMode === "host") {
  const ash = windowStub.__ASH__;
  ash.startHost({ name: "Хост", cls: "lantern" }).catch((e) => {
    console.error("HOST ERROR", e);
    process.exit(1);
  });
  let ticks = 0;
  let readyAt = 0;
  const timer = setInterval(() => {
    frames(1);
    ticks++;
    if (readyAt) {
      if (Date.now() - readyAt > 8000) {
        clearInterval(timer);
        process.exit(0);
      }
      return;
    }
    if (ash.scene && ash.scene.players.length >= 2) {
      readyAt = Date.now();
      console.log("HOST OK", {
        myId: ash.myId,
        players: ash.scene.players.map((p) => p.name),
        mode: ash.mode,
      });
      return;
    }
    if (ticks > 900) {
      clearInterval(timer);
      console.error("HOST TIMEOUT", { mode: ash.mode, running: ash.running });
      process.exit(1);
    }
  }, 16);
} else {
  windowStub.__ASH__.startSolo({ name: "Тест", cls: "lantern" });
  frames(20);

  const ash = windowStub.__ASH__;
  if (!ash.world || !ash.scene) throw new Error("соло-мир не запустился");
  const me = ash.world.players.get("local");
  if (!me) throw new Error("нет локального игрока");
  if (!ash.scene.players.some((p) => p.id === "local")) throw new Error("игрок не попал в сцену");
  if (!ash.scene.props?.length) throw new Error("в сцене нет props");

  key("Space");
  frames(3);
  if (me.attackAnim <= 0 && me.attackCd <= 0) throw new Error("удар не сработал");
  key("Space", "keyup");

  const irma = ash.world.map.landmarks.irma;
  me.x = irma.x + 12;
  me.y = irma.y + 12;
  ash.world.action("local", "interact");
  frames(2);
  if (!me.dialogueView) throw new Error("диалог с Ирмой не открылся");
  if (!me.dialogueView.choices?.length) throw new Error("в диалоге нет выборов");
  ash.ui.finishTyping();
  ash.world.chooseDialogue(me, 2);
  if (ash.world.quest.main.stage !== 1) throw new Error("квест не начался");
  frames(3);

  ash.ui.showEnd("hope", { level: 2, kills: 3, embers: 3 });
  frames(3);
  if (ash.ui.el.end.classList.contains("hidden")) throw new Error("экран финала не показан");

  console.log("DOM smoke OK", {
    mode: ash.mode,
    player: me.name,
    stage: ash.world.quest.main.stage,
    props: ash.scene.props.length,
    enemies: ash.scene.enemies.length,
    effects: ash.renderer.effects.length,
  });
  process.exit(0);
}

