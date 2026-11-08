/* Пепел и Вереск — клавиатура и сенсорное управление */

const KEY_MAP = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "attack",
  ShiftLeft: "dodge", ShiftRight: "dodge",
  KeyQ: "ability",
  KeyE: "interact",
  KeyM: "map",
};

const MOVE_KEYS = new Set(["up", "down", "left", "right"]);

// Минимальный зазор между двумя нажатиями одной и той же кнопки.
// Нужен только против дребезга WebView: игровые кулдауны всё равно длиннее.
const ACTION_GAP = {
  attack: 110,
  dodge: 130,
  ability: 160,
  interact: 190,
  map: 220,
};

const nowMs = () =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

const touchList = (list) => (list ? Array.from(list) : []);

export class Input {
  constructor({ onAction, onPause, onChoice } = {}) {
    this.onAction = onAction || (() => {});
    this.onPause = onPause || (() => {});
    this.onChoice = onChoice || (() => {});
    this.keys = new Set();
    this.held = new Set();
    this.keyHeld = new Set();
    // Мышь и перо. Тач-события идут отдельным путём: Android WebView умеет
    // присылать повторный pointerdown/pointercancel для всё ещё нажатого пальца.
    this.pointerRecs = new Map();
    this.touchRecs = new Map();
    this.lastActionAt = new Map();
    this.lastTouchAt = -Infinity;
    this.buttons = new Map();
    this.joystick = { active: false, id: null, dx: 0, dy: 0, cx: 0, cy: 0 };
    this.enabled = true;
    this.joyEl = document.getElementById("joystick");
    this.stickEl = document.getElementById("stick");
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onBlur = this.reset.bind(this);
    this._onPointerUp = this.releasePointer.bind(this);
    this._onTouchEnd = this.releaseTouch.bind(this);
    this._onTouchStartAnywhere = () => {
      this.lastTouchAt = nowMs();
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("pointerup", this._onPointerUp, true);
    window.addEventListener("pointercancel", this._onPointerUp, true);
    window.addEventListener("mouseup", this._onPointerUp, true);
    window.addEventListener("touchend", this._onTouchEnd, true);
    window.addEventListener("touchcancel", this._onTouchEnd, true);
    window.addEventListener("touchstart", this._onTouchStartAnywhere, true);
    this.bindJoystick();
    this.bindButtons();
  }

  /* ---------- общее состояние ---------- */

  isActionDown(action) {
    if (this.keyHeld.has(action)) return true;
    for (const rec of this.pointerRecs.values()) {
      if (rec.action === action) return true;
    }
    for (const rec of this.touchRecs.values()) {
      if (rec.action === action) return true;
    }
    return false;
  }

  buttonFor(action) {
    for (const [el, a] of this.buttons) {
      if (a === action) return el;
    }
    return null;
  }

  syncAction(action) {
    const el = this.buttonFor(action);
    if (this.isActionDown(action)) {
      this.held.add(action);
      el?.classList.add("pressed");
    } else {
      this.held.delete(action);
      el?.classList.remove("pressed");
    }
  }

  // Единственная точка запуска действия. Нажатие -> ровно один вызов.
  trigger(action) {
    if (!this.enabled) return false;
    if (this.held.has(action)) return false;
    const now = nowMs();
    const gap = ACTION_GAP[action] || 90;
    if (now - (this.lastActionAt.get(action) || 0) < gap) return false;
    this.lastActionAt.set(action, now);
    const el = this.buttonFor(action);
    this.held.add(action);
    el?.classList.add("pressed");
    this.onAction(action);
    return true;
  }

  /* ---------- клавиатура ---------- */

  handleKeyDown(e) {
    if (!this.enabled) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Escape") {
      e.preventDefault();
      this.onPause();
      return;
    }
    if (/^Digit[1-4]$/.test(e.code)) {
      this.onChoice(Number(e.code.slice(5)) - 1);
      return;
    }
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (MOVE_KEYS.has(action)) {
      this.keys.add(action);
      return;
    }
    if (e.repeat || this.keyHeld.has(action)) return;
    this.keyHeld.add(action);
    this.trigger(action);
  }

  handleKeyUp(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (MOVE_KEYS.has(action)) {
      this.keys.delete(action);
      return;
    }
    this.keyHeld.delete(action);
    this.syncAction(action);
  }

  /* ---------- мышь и перо ---------- */

  releasePointer(e) {
    const type = e?.pointerType;
    // Тач отпускаем только настоящим touchend/touchcancel.
    if (type === "touch") return;
    const id = e?.pointerId;
    if (id == null) {
      // mouseup без pointerId — снимаем все мышиные удержания.
      for (const rec of [...this.pointerRecs.values()]) {
        this.pointerRecs.delete(rec.id);
        this.syncAction(rec.action);
      }
      return;
    }
    const rec = this.pointerRecs.get(id);
    if (!rec) return;
    this.pointerRecs.delete(id);
    this.syncAction(rec.action);
  }

  /* ---------- касания ---------- */

  releaseTouch(e) {
    const changed = touchList(e?.changedTouches);
    if (!changed.length) {
      // Некоторые сборки WebView присылают touchend без changedTouches.
      // Это всегда конец жеста: снимаем всё, что могли удержать.
      this.releaseAllTouches();
      this.releaseAllPointers();
      return;
    }
    for (const touch of changed) {
      const id = touch.identifier;
      const rec = this.touchRecs.get(id);
      if (!rec) continue;
      this.touchRecs.delete(id);
      this.syncAction(rec.action);
    }
    // Страховка от потерянного touchend: если живых касаний нет — чистим хвосты.
    if (!e?.touches || e.touches.length === 0) this.releaseAllTouches();
  }

  releaseAllTouches() {
    const actions = new Set();
    for (const rec of this.touchRecs.values()) actions.add(rec.action);
    this.touchRecs.clear();
    for (const action of actions) this.syncAction(action);
  }

  releaseAllPointers() {
    const actions = new Set();
    for (const rec of this.pointerRecs.values()) actions.add(rec.action);
    this.pointerRecs.clear();
    for (const action of actions) this.syncAction(action);
  }

  /* ---------- джойстик ---------- */

  bindJoystick() {
    if (!this.joyEl) return;
    const el = this.joyEl;
    const down = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (this.joystick.active) return;
      if (e.pointerType === "mouse" && nowMs() - this.lastTouchAt < 800) return;
      const r = el.getBoundingClientRect();
      this.joystick.active = true;
      this.joystick.id = e.pointerId;
      this.joystick.cx = r.left + r.width / 2;
      this.joystick.cy = r.top + r.height / 2;
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.trackPointer(e);
    };
    const move = (e) => {
      if (!this.joystick.active || e.pointerId !== this.joystick.id) return;
      e.preventDefault();
      this.trackPointer(e);
    };
    const up = (e) => {
      if (e.pointerId !== this.joystick.id) return;
      this.resetJoystick();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  trackPointer(e) {
    const max = (this.joyEl?.clientWidth || 120) * 0.32;
    let dx = e.clientX - this.joystick.cx;
    let dy = e.clientY - this.joystick.cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    const nx = dx / max;
    const ny = dy / max;
    this.joystick.dx = Math.abs(nx) < 0.14 ? 0 : nx;
    this.joystick.dy = Math.abs(ny) < 0.14 ? 0 : ny;
    if (this.stickEl) {
      this.stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  resetJoystick() {
    this.joystick.active = false;
    this.joystick.id = null;
    this.joystick.dx = 0;
    this.joystick.dy = 0;
    if (this.stickEl) this.stickEl.style.transform = "translate(0px, 0px)";
  }

  /* ---------- кнопки действий ---------- */

  bindButtons() {
    for (const el of document.querySelectorAll("[data-action]")) {
      const action = el.dataset.action;
      if (!action) continue;
      this.buttons.set(el, action);

      // Тач: touchstart/touchend — единственный источник истины.
      const touchDown = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.lastTouchAt = nowMs();
        const touches = touchList(e.changedTouches);
        if (!touches.length) return;
        // Палец уже держит эту кнопку (в том числе повторный touchstart
        // с другим identifier) — второй раз не срабатываем.
        if (this.isActionDown(action)) return;
        const added = [];
        for (const touch of touches) {
          const id = touch.identifier;
          if (id == null || this.touchRecs.has(id)) continue;
          this.touchRecs.set(id, { action, el, id });
          added.push(id);
        }
        if (!added.length) return;
        if (!this.trigger(action)) {
          for (const id of added) this.touchRecs.delete(id);
          this.syncAction(action);
        }
      };
      const touchEnd = (e) => {
        this.lastTouchAt = nowMs();
        this.releaseTouch(e);
      };

      // Мышь/перо: pointerdown, но только не тач.
      const pointerDown = (e) => {
        if (!this.enabled) return;
        if (e.pointerType === "touch") return;
        if (e.pointerType === "mouse" && nowMs() - this.lastTouchAt < 800) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        if (e.pointerId == null || this.pointerRecs.has(e.pointerId)) return;
        if (this.isActionDown(action)) return;
        this.pointerRecs.set(e.pointerId, { action, el, id: e.pointerId });
        try { el.setPointerCapture(e.pointerId); } catch {}
        if (!this.trigger(action)) {
          this.pointerRecs.delete(e.pointerId);
          this.syncAction(action);
        }
      };
      const pointerEnd = (e) => {
        if (e.pointerType === "touch") return;
        this.releasePointer(e);
      };

      el.addEventListener("touchstart", touchDown, { passive: false });
      el.addEventListener("touchend", touchEnd, { passive: false });
      el.addEventListener("touchcancel", touchEnd, { passive: false });
      el.addEventListener("pointerdown", pointerDown);
      el.addEventListener("pointerup", pointerEnd);
      el.addEventListener("pointercancel", pointerEnd);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  flashButton(action, on) {
    for (const [el, a] of this.buttons) {
      if (a === action) el.classList.toggle("pressed", on);
    }
  }

  /* ---------- прочее ---------- */

  get move() {
    let x = 0;
    let y = 0;
    if (this.keys.has("left")) x -= 1;
    if (this.keys.has("right")) x += 1;
    if (this.keys.has("up")) y -= 1;
    if (this.keys.has("down")) y += 1;
    if (this.joystick.active) {
      x += this.joystick.dx;
      y += this.joystick.dy;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  isHeld(action) {
    return this.held.has(action);
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!v) this.reset();
  }

  // Только визуал: убирает подсветку, но НЕ отпускает латч.
  // Вызывается, когда открывается карта/верстак/диалог под пальцем.
  clearPressed() {
    for (const el of this.buttons.keys()) el.classList.remove("pressed");
  }

  // Историческое имя: раньше чистило удержания и открывало дорогу
  // повторному действию прямо под пальцем. Теперь это безопасный визуал.
  clearHeld() {
    this.clearPressed();
  }

  releaseAll() {
    this.keyHeld.clear();
    this.pointerRecs.clear();
    this.touchRecs.clear();
    this.held.clear();
    for (const el of this.buttons.keys()) el.classList.remove("pressed");
  }

  reset() {
    this.keys.clear();
    this.releaseAll();
    this.resetJoystick();
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    window.removeEventListener("pointerup", this._onPointerUp, true);
    window.removeEventListener("pointercancel", this._onPointerUp, true);
    window.removeEventListener("mouseup", this._onPointerUp, true);
    window.removeEventListener("touchend", this._onTouchEnd, true);
    window.removeEventListener("touchcancel", this._onTouchEnd, true);
    window.removeEventListener("touchstart", this._onTouchStartAnywhere, true);
  }
}
