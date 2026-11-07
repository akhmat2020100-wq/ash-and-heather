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
};

export class Input {
  constructor({ onAction, onPause, onChoice } = {}) {
    this.onAction = onAction || (() => {});
    this.onPause = onPause || (() => {});
    this.onChoice = onChoice || (() => {});
    this.keys = new Set();
    this.held = new Set();
    this.joystick = { active: false, id: null, dx: 0, dy: 0, cx: 0, cy: 0 };
    this.enabled = true;
    this.joyEl = document.getElementById("joystick");
    this.stickEl = document.getElementById("stick");
    this._onKeyDown = this.handleKeyDown.bind(this);
    this._onKeyUp = this.handleKeyUp.bind(this);
    this._onBlur = this.reset.bind(this);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    this.bindJoystick();
    this.bindButtons();
  }

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
    if (["up", "down", "left", "right"].includes(action)) {
      this.keys.add(action);
    } else if (!e.repeat) {
      this.held.add(action);
      this.onAction(action);
      this.flashButton(action, true);
    }
  }

  handleKeyUp(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (["up", "down", "left", "right"].includes(action)) {
      this.keys.delete(action);
    } else {
      this.held.delete(action);
      this.flashButton(action, false);
    }
  }

  bindJoystick() {
    if (!this.joyEl) return;
    const el = this.joyEl;
    const down = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (this.joystick.active) return;
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
    el.addEventListener("lostpointercapture", up);
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

  bindButtons() {
    this.buttons = new Map();
    for (const el of document.querySelectorAll("[data-action]")) {
      const action = el.dataset.action;
      this.buttons.set(el, action);
      const down = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch {}
        this.held.add(action);
        el.classList.add("pressed");
        this.onAction(action);
      };
      const up = (e) => {
        e.preventDefault();
        this.held.delete(action);
        el.classList.remove("pressed");
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  flashButton(action, on) {
    for (const [el, a] of this.buttons) {
      if (a === action) el.classList.toggle("pressed", on);
    }
  }

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

  clearHeld() {
    this.held.clear();
    for (const el of this.buttons.keys()) el.classList.remove("pressed");
  }

  reset() {
    this.keys.clear();
    this.clearHeld();
    this.resetJoystick();
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
  }
}
