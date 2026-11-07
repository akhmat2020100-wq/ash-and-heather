/* Пепел и Вереск — рендер мира на canvas */
import { CLASSES, ENEMY_TYPES } from "./data.js";
import { TILE, T, MAP_W, MAP_H } from "./map.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TILE_COLORS = {
  [T.HEATHER]: ["#2f3a33", "#32403a", "#2b352f", "#354439"],
  [T.DIRT]: ["#4a4038", "#51453c", "#453b34", "#54473d"],
  [T.STONE]: ["#3b3d42", "#414349", "#36383d", "#46484f"],
  [T.WATER]: ["#1c3038", "#20363f", "#182b32", "#243d46"],
  [T.WALL]: ["#2a2a31", "#2f2f37", "#26262c", "#33333b"],
  [T.TREE]: ["#1c2822", "#202e26", "#18231e", "#233229"],
  [T.ROCK]: ["#33353a", "#393b41", "#2d2f34", "#3e4046"],
  [T.FLOOR]: ["#34343b", "#393941", "#2f2f35", "#3d3d45"],
  [T.ASH]: ["#55514b", "#5b5750", "#4e4a45", "#615d55"],
  [T.BRIDGE]: ["#4d3f30", "#554636", "#463a2c", "#5b4c3b"],
  [T.MOSS]: ["#364a38", "#3b503c", "#314534", "#405744"],
};

const SIGILS = { lantern: "ᛟ", hunter: "ᚱ", executioner: "ᚦ" };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.cam = { x: (MAP_W * TILE) / 2, y: (MAP_H * TILE) / 2, zoom: 1 };
    this.time = 0;
    this.reduced = false;
    this.effects = [];
    this.floaters = [];
    this.ambient = [];
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.lightCanvas = document.createElement("canvas");
    this.lightCtx = this.lightCanvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.floor(rect.width));
    this.h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.zoom = clamp(Math.min(this.w / 880, this.h / 520), 0.82, 1.55);
    this.lightCanvas.width = Math.max(1, Math.floor((this.w * this.dpr) / 2));
    this.lightCanvas.height = Math.max(1, Math.floor((this.h * this.dpr) / 2));
  }

  setReduced(v) {
    this.reduced = !!v;
    if (v) this.ambient.length = 0;
  }

  shake(amount) {
    if (this.reduced) amount *= 0.3;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeT = 0.25;
  }

  addBurst(kind, x, y, opts = {}) {
    if (this.reduced && kind !== "slam") return;
    const n = opts.count || (kind === "hit" ? 6 : kind === "slash" ? 8 : 12);
    if (kind === "slash") {
      this.effects.push({ kind, x, y, a: opts.a || 0, range: opts.range || 48, t: 0, ttl: 0.2, cls: opts.cls });
      return;
    }
    if (kind === "nova" || kind === "slam" || kind === "cone" || kind === "ring") {
      this.effects.push({
        kind,
        x,
        y,
        radius: opts.radius || 90,
        angle: opts.angle || 0,
        a: opts.a || 0,
        color: opts.color,
        t: 0,
        ttl: kind === "slam" ? 0.6 : 0.45,
      });
      return;
    }
    if (kind === "beam") {
      this.effects.push({ kind, x, y, x2: opts.x2, y2: opts.y2, color: opts.color || "#d9c9a8", t: 0, ttl: 0.18 });
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = opts.a != null ? opts.a + (Math.random() - 0.5) * (opts.spread || 1.6) : Math.random() * TAU;
      const sp = (opts.speed || 80) * (0.4 + Math.random());
      this.effects.push({
        kind: "particle",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.lift || 0),
        r: 1 + Math.random() * (opts.size || 2.2),
        color: opts.color || "#e8a54b",
        t: 0,
        ttl: opts.ttl || 0.5 + Math.random() * 0.4,
        gravity: opts.gravity ?? 120,
      });
    }
  }

  addFloater(x, y, text, color = "#e6dcc8", big = false) {
    this.floaters.push({ x, y, text, color, t: 0, ttl: 1.1, big });
    if (this.floaters.length > 40) this.floaters.shift();
  }

  update(dt, scene, myId) {
    this.time += dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeAmt = 0;
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      if (e.kind === "particle") {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vy += e.gravity * dt;
        e.vx *= 0.985;
      }
      if (e.t >= e.ttl) this.effects.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      f.y -= 26 * dt;
      if (f.t >= f.ttl) this.floaters.splice(i, 1);
    }
    // camera follow
    let tx = this.cam.x;
    let ty = this.cam.y;
    let target = null;
    if (scene) {
      const me = scene.players?.find((p) => p.id === myId) || scene.players?.[0];
      if (me) target = me;
    }
    if (target) {
      tx = target.x;
      ty = target.y - 10;
    }
    const k = 1 - Math.pow(0.0016, dt);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);

    if (!this.reduced) {
      const spawn = dt * (this.ambient.length < 60 ? 14 : 0);
      for (let i = 0; i < spawn; i++) {
        this.ambient.push({
          x: this.cam.x + (Math.random() - 0.5) * 1200,
          y: this.cam.y + (Math.random() - 0.5) * 800,
          vx: -8 - Math.random() * 14,
          vy: -4 - Math.random() * 10,
          r: 0.6 + Math.random() * 1.6,
          a: 0.1 + Math.random() * 0.3,
          tw: Math.random() * TAU,
        });
      }
      for (const p of this.ambient) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (Math.abs(p.x - this.cam.x) > 900 || Math.abs(p.y - this.cam.y) > 650) {
          p.x = this.cam.x + (Math.random() - 0.5) * 1100;
          p.y = this.cam.y + 500;
        }
      }
    }
  }

  worldTransform(ctx, scene) {
    const { w, h } = this;
    const zoom = this.zoom;
    let sx = 0;
    let sy = 0;
    if (this.shakeAmt > 0) {
      sx = (Math.random() - 0.5) * this.shakeAmt * 2;
      sy = (Math.random() - 0.5) * this.shakeAmt * 2;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(w / 2 + sx, h / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
  }

  viewBounds() {
    const zoom = this.zoom;
    return {
      x0: this.cam.x - this.w / 2 / zoom - TILE,
      x1: this.cam.x + this.w / 2 / zoom + TILE,
      y0: this.cam.y - this.h / 2 / zoom - TILE,
      y1: this.cam.y + this.h / 2 / zoom + TILE,
    };
  }

  draw(scene, myId, opts = {}) {
    const ctx = this.ctx;
    const reduced = this.reduced;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#14181e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!scene) {
      this.drawMenuBackdrop(ctx);
      return;
    }
    this.worldTransform(ctx, scene);
    const vb = this.viewBounds();
    this.drawTiles(ctx, vb);
    this.drawGroundDetails(ctx, vb, scene);

    const drawables = [];
    for (const prop of scene.props || []) {
      if (prop.x < vb.x0 - 80 || prop.x > vb.x1 + 80 || prop.y < vb.y0 - 80 || prop.y > vb.y1 + 120) continue;
      drawables.push({ y: prop.sort ?? prop.y, kind: "prop", data: prop });
    }
    for (const npc of scene.npcs || []) {
      if (npc.x < vb.x0 || npc.x > vb.x1 || npc.y < vb.y0 || npc.y > vb.y1) continue;
      drawables.push({ y: npc.y, kind: "npc", data: npc });
    }
    for (const p of scene.players || []) {
      drawables.push({ y: p.y, kind: "player", data: p });
    }
    for (const e of scene.enemies || []) {
      if (e.x < vb.x0 || e.x > vb.x1 || e.y < vb.y0 || e.y > vb.y1) continue;
      drawables.push({ y: e.y, kind: "enemy", data: e });
    }
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d.kind === "prop") this.drawProp(ctx, d.data, scene);
      else if (d.kind === "npc") this.drawNpc(ctx, d.data, scene, myId);
      else if (d.kind === "player") this.drawPlayer(ctx, d.data, myId, scene);
      else if (d.kind === "enemy") this.drawEnemy(ctx, d.data);
    }

    for (const p of scene.pickups || []) this.drawPickup(ctx, p);
    for (const p of scene.projectiles || []) this.drawProjectile(ctx, p);
    this.drawEffects(ctx);

    // player/channel rings above ground
    for (const p of scene.players || []) {
      if (p.channeling && p.reviveProgress > 0) {
        this.drawArc(ctx, p.x, p.y + 4, 26, -Math.PI / 2, -Math.PI / 2 + TAU * p.reviveProgress, "rgba(232,165,75,0.85)", 3);
      }
      if (p.downed) {
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(this.time * 3) * 0.15;
        ctx.strokeStyle = "#a94b4b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20 + Math.sin(this.time * 2) * 3, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    this.drawWorldFog(ctx, vb, scene);
    this.drawLighting(ctx, scene);
    this.drawObjective(ctx, scene, opts);
    this.drawAmbient(ctx);
    this.drawFloaters(ctx);
    this.drawScreenVignette(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawTiles(ctx, vb) {
    const x0 = Math.max(0, Math.floor(vb.x0 / TILE));
    const x1 = Math.min(MAP_W - 1, Math.floor(vb.x1 / TILE));
    const y0 = Math.max(0, Math.floor(vb.y0 / TILE));
    const y1 = Math.min(MAP_H - 1, Math.floor(vb.y1 / TILE));
    const tiles = this.sceneTiles;
    if (!tiles) return;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tiles[ty * MAP_W + tx];
        const pal = TILE_COLORS[t] || TILE_COLORS[T.HEATHER];
        const n = hash(tx, ty);
        ctx.fillStyle = pal[(n * pal.length) | 0];
        const px = tx * TILE;
        const py = ty * TILE;
        ctx.fillRect(px, py, TILE + 0.5, TILE + 0.5);
        if (t === T.HEATHER || t === T.MOSS) {
          ctx.fillStyle = t === T.MOSS ? "rgba(90,120,80,0.22)" : "rgba(120,105,140,0.16)";
          for (let i = 0; i < 3; i++) {
            const h1 = hash(tx * 5 + i, ty * 7 + i * 3);
            const h2 = hash(tx * 11 + i * 5, ty * 3 + i);
            ctx.fillRect(px + h1 * 30, py + h2 * 30, 1.4, 2.2);
          }
        } else if (t === T.DIRT || t === T.ASH) {
          ctx.fillStyle = t === T.ASH ? "rgba(220,214,204,0.16)" : "rgba(20,14,10,0.2)";
          for (let i = 0; i < 2; i++) {
            const h1 = hash(tx * 3 + i, ty * 9 + i);
            const h2 = hash(tx * 7 + i, ty * 5 + i);
            ctx.fillRect(px + h1 * 30, py + h2 * 30, 1.6, 1.2);
          }
        } else if (t === T.WATER) {
          const w = Math.sin(this.time * 1.3 + tx * 0.7 + ty * 0.4);
          ctx.strokeStyle = `rgba(160,200,215,${0.08 + (w + 1) * 0.035})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + 4, py + 9 + w * 2);
          ctx.lineTo(px + 14, py + 9 + w * 2);
          ctx.moveTo(px + 17, py + 22 - w * 2);
          ctx.lineTo(px + 28, py + 22 - w * 2);
          ctx.stroke();
        } else if (t === T.STONE || t === T.FLOOR) {
          ctx.strokeStyle = "rgba(0,0,0,0.14)";
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE, TILE);
          if (n > 0.65) {
            ctx.strokeStyle = "rgba(255,255,255,0.035)";
            ctx.beginPath();
            ctx.moveTo(px + 6 + n * 12, py + 4);
            ctx.lineTo(px + 12 + n * 8, py + 18);
            ctx.lineTo(px + 9 + n * 10, py + 27);
            ctx.stroke();
          }
        } else if (t === T.WALL) {
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py + 16);
          ctx.lineTo(px + 32, py + 16);
          ctx.moveTo(px + 16, py);
          ctx.lineTo(px + 16, py + 16);
          ctx.moveTo(px + 8, py + 16);
          ctx.lineTo(px + 8, py + 32);
          ctx.moveTo(px + 24, py + 16);
          ctx.lineTo(px + 24, py + 32);
          ctx.stroke();
        }
      }
    }
  }

  drawGroundDetails(ctx, vb, scene) {
    // path wear, root lines, puddles, and the chapel threshold
    const tileAt = (tx, ty) => {
      if (!this.sceneTiles || tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.TREE;
      return this.sceneTiles[ty * MAP_W + tx];
    };
    for (let ty = Math.floor(vb.y0 / TILE); ty <= vb.y1 / TILE; ty++) {
      for (let tx = Math.floor(vb.x0 / TILE); tx <= vb.x1 / TILE; tx++) {
        const t = tileAt(tx, ty);
        const n = hash(tx * 13, ty * 17);
        if ((t === T.DIRT || t === T.HEATHER) && n > 0.93) {
          const px = tx * TILE + 6;
          const py = ty * TILE + 8;
          ctx.strokeStyle = "rgba(48,38,30,0.75)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + 8, py + 4, px + 15, py + 1);
          ctx.stroke();
          ctx.strokeStyle = "rgba(70,58,44,0.6)";
          ctx.beginPath();
          ctx.moveTo(px + 5, py + 6);
          ctx.quadraticCurveTo(px + 10, py + 9, px + 14, py + 5);
          ctx.stroke();
        }
        if (t === T.STONE && n > 0.88) {
          ctx.fillStyle = "rgba(20,24,28,0.35)";
          ctx.beginPath();
          ctx.ellipse(tx * TILE + 16, ty * TILE + 20, 8, 3, 0.3, 0, TAU);
          ctx.fill();
        }
      }
    }
    // chapel rune circle
    const chapel = scene.landmarks?.chapel;
    if (chapel) {
      ctx.save();
      ctx.globalAlpha = scene.flags?.chapelOpen ? 0.5 : 0.24;
      ctx.strokeStyle = "#c9b27a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(44 * TILE, 11 * TILE, 46, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = this.time * 0.15 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(44 * TILE, 11 * TILE, 34, a, a + 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* --- методы, добавляемые к прототипу --- */
Renderer.prototype.drawArc = function (ctx, x, y, r, a0, a1, color, width = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
  ctx.restore();
};

Renderer.prototype.drawShadow = function (ctx, x, y, rx, ry, alpha = 0.35) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
};

Renderer.prototype.drawProp = function (ctx, p, scene) {
  const t = this.time;
  switch (p.type) {
    case "hut": {
      const x = p.x;
      const y = p.y;
      const w = p.w;
      const h = p.h;
      ctx.save();
      ctx.fillStyle = "#2a2226";
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = "#332a2e";
      ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.55);
      ctx.fillStyle = "#1b1519";
      ctx.fillRect(x - w * 0.12, y, w * 0.24, h * 0.5);
      ctx.fillStyle = "#4a3a32";
      ctx.fillRect(x - w * 0.42, y - h * 0.3, w * 0.16, h * 0.18);
      ctx.fillStyle = "rgba(232,165,75,0.28)";
      ctx.fillRect(x - w * 0.39, y - h * 0.27, w * 0.1, h * 0.12);
      // roof
      ctx.fillStyle = "#3b2f38";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.58, y - h * 0.5);
      ctx.lineTo(x, y - h * 0.92);
      ctx.lineTo(x + w * 0.58, y - h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * w * 0.09, y - h * 0.5);
        ctx.lineTo(x + i * w * 0.045, y - h * 0.88);
        ctx.stroke();
      }
      // chimney
      ctx.fillStyle = "#2b2429";
      ctx.fillRect(x + w * 0.25, y - h * 0.86, w * 0.1, h * 0.22);
      ctx.restore();
      break;
    }
    case "tent": {
      ctx.save();
      ctx.fillStyle = "#3a3a2c";
      ctx.beginPath();
      ctx.moveTo(p.x - p.w / 2, p.y + p.h / 2);
      ctx.lineTo(p.x, p.y - p.h / 2);
      ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#161812";
      ctx.beginPath();
      ctx.moveTo(p.x - p.w * 0.16, p.y + p.h / 2);
      ctx.lineTo(p.x, p.y - p.h * 0.12);
      ctx.lineTo(p.x + p.w * 0.16, p.y + p.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#57533c";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.h / 2);
      ctx.lineTo(p.x, p.y - p.h / 2 - 16);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "deadTree":
    case "tree": {
      const seed = p.x * 0.13 + p.y * 0.07;
      const sway = Math.sin(t * 0.5 + seed) * 1.6;
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + 4, p.r * 0.9, p.r * 0.34, 0.4);
      ctx.fillStyle = p.type === "tree" ? "#2a2019" : "#241d19";
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y + 4);
      ctx.lineTo(p.x - 2, p.y - p.r * 1.1);
      ctx.lineTo(p.x + 2, p.y - p.r * 1.1);
      ctx.lineTo(p.x + 4, p.y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.type === "tree" ? "#2a2019" : "#241d19";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      const branch = (bx, by, len, ang) => {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + Math.cos(ang) * len * 0.6, by + Math.sin(ang) * len * 0.6, bx + Math.cos(ang) * len + sway, by + Math.sin(ang) * len);
        ctx.stroke();
      };
      branch(p.x, p.y - p.r * 0.7, p.r * 0.9, -2.4 + sway * 0.02);
      branch(p.x, p.y - p.r * 0.85, p.r * 0.8, -0.7 - sway * 0.02);
      branch(p.x, p.y - p.r * 0.5, p.r * 0.7, 2.5);
      if (p.type === "tree") {
        ctx.fillStyle = "rgba(44,58,49,0.85)";
        ctx.beginPath();
        ctx.ellipse(p.x - 8, p.y - p.r * 1.2, p.r * 0.9, p.r * 0.55, -0.2, 0, TAU);
        ctx.ellipse(p.x + 8, p.y - p.r * 1.3, p.r * 0.8, p.r * 0.5, 0.2, 0, TAU);
        ctx.ellipse(p.x, p.y - p.r * 1.5, p.r * 0.7, p.r * 0.5, 0, 0, TAU);
        ctx.fill();
      } else if (Math.sin(t + seed) > 0.93) {
        ctx.fillStyle = "rgba(200,210,220,0.25)";
        ctx.beginPath();
        ctx.arc(p.x + 10, p.y - p.r, 1.5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "rock": {
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + p.r * 0.35, p.r * 0.9, p.r * 0.32, 0.4);
      ctx.fillStyle = "#3a3a3e";
      ctx.beginPath();
      const pts = 7;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * TAU;
        const rr = p.r * (0.7 + hash(p.x + i, p.y) * 0.4);
        const px = p.x + Math.cos(a) * rr;
        const py = p.y + Math.sin(a) * rr * 0.72;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.beginPath();
      ctx.ellipse(p.x - p.r * 0.2, p.y - p.r * 0.3, p.r * 0.4, p.r * 0.2, -0.4, 0, TAU);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "bush": {
      ctx.save();
      ctx.fillStyle = "rgba(38,48,38,0.9)";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + hash(p.x, p.y) * 2;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * p.r * 0.45, p.y + Math.sin(a) * p.r * 0.3, p.r * 0.55, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(118,86,124,0.55)";
      for (let i = 0; i < 4; i++) {
        const a = hash(p.x + i, p.y + i) * TAU;
        ctx.fillRect(p.x + Math.cos(a) * p.r * 0.55, p.y + Math.sin(a) * p.r * 0.4 - 2, 1.6, 1.6);
      }
      ctx.restore();
      break;
    }
    case "campfire": {
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + 3, p.r * 1.1, p.r * 0.45, 0.45);
      ctx.fillStyle = "#3f3831";
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        ctx.beginPath();
        ctx.ellipse(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r * 0.5, 3.4, 2.4, a, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = "#5a4130";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y + 4);
      ctx.lineTo(p.x + 7, p.y - 3);
      ctx.moveTo(p.x + 7, p.y + 4);
      ctx.lineTo(p.x - 7, p.y - 3);
      ctx.stroke();
      const flick = Math.sin(t * 9 + p.x) * 1.6 + Math.sin(t * 13.7) * 0.8;
      const flame = (ox, h, color, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(p.x + ox - 4, p.y);
        ctx.quadraticCurveTo(p.x + ox - 2, p.y - h * 0.55, p.x + ox + flick, p.y - h);
        ctx.quadraticCurveTo(p.x + ox + 3, p.y - h * 0.45, p.x + ox + 4, p.y);
        ctx.closePath();
        ctx.fill();
      };
      flame(0, 20 + Math.sin(t * 7) * 3, "#e8823a", 0.9);
      flame(-2, 14 + Math.sin(t * 11) * 2, "#ffc06a", 0.85);
      flame(2, 9, "#ffe7b0", 0.8);
      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }
    case "nameTree": {
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + 4, p.r * 1.1, p.r * 0.4, 0.45);
      ctx.fillStyle = "#2a201c";
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y + 6);
      ctx.lineTo(p.x - 7, p.y - p.r * 1.7);
      ctx.lineTo(p.x + 5, p.y - p.r * 1.7);
      ctx.lineTo(p.x + 10, p.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#2a201c";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const [ang, len] of [[-2.5, 46], [-0.9, 52], [-1.7, 58], [2.6, 40]]) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.r * 1.3);
        ctx.quadraticCurveTo(p.x + Math.cos(ang) * len * 0.55, p.y - p.r * 1.6 + Math.sin(ang) * len * 0.4, p.x + Math.cos(ang) * len, p.y - p.r * 1.8 + Math.sin(ang) * len);
        ctx.stroke();
      }
      const pulse = 0.55 + Math.sin(t * 1.4) * 0.2;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#9db8d8";
      ctx.font = "11px Georgia, serif";
      ctx.textAlign = "center";
      const runes = ["ᚨ", "ᚱ", "ᚦ", "ᛁ", "ᛊ"];
      for (let i = 0; i < runes.length; i++) {
        ctx.fillText(runes[i], p.x - 14 + i * 7, p.y - 28 - (i % 2) * 8);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(157,184,216,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.7, 0, TAU);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "shrine": {
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + 6, p.r * 1.3, p.r * 0.5, 0.45);
      ctx.fillStyle = "#3f4148";
      ctx.fillRect(p.x - p.r, p.y - p.r * 0.2, p.r * 2, p.r * 1.1);
      ctx.fillStyle = "#4b4e56";
      ctx.fillRect(p.x - p.r * 0.8, p.y - p.r * 0.45, p.r * 1.6, p.r * 0.35);
      ctx.fillStyle = "#2b2d33";
      ctx.fillRect(p.x - p.r * 1.15, p.y + p.r * 0.75, p.r * 2.3, p.r * 0.4);
      ctx.fillStyle = scene?.flags?.shrineBlessed ? "rgba(157,184,216,0.7)" : "rgba(120,140,150,0.3)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - p.r * 0.5, p.r * 0.45, p.r * 0.12, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(232,165,75,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 2, p.r * 1.55, 0, TAU);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "column": {
      ctx.save();
      this.drawShadow(ctx, p.x, p.y + 3, p.r * 0.9, p.r * 0.3, 0.4);
      ctx.fillStyle = "#41434a";
      ctx.fillRect(p.x - p.r * 0.55, p.y - p.r * 1.7, p.r * 1.1, p.r * 1.8);
      ctx.fillStyle = "#4d4f57";
      ctx.fillRect(p.x - p.r * 0.8, p.y + p.r * 0.1, p.r * 1.6, p.r * 0.35);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(p.x - p.r * 0.55, p.y - p.r * 1.7, p.r * 0.25, p.r * 1.8);
      ctx.fillStyle = "#35373d";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.8 + i * p.r * 0.8, p.y - p.r * 1.7, p.r * 0.32, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "door": {
      ctx.save();
      const open = scene?.flags?.chapelOpen;
      ctx.fillStyle = "#2a2420";
      ctx.fillRect(p.x - p.w / 2, p.y - 20, p.w, 34);
      ctx.strokeStyle = "#6b5a3e";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(p.x - p.w / 2 + 3, p.y - 17, p.w - 6, 28);
      if (open) {
        ctx.fillStyle = "rgba(8,10,14,0.9)";
        ctx.fillRect(p.x - p.w * 0.18, p.y - 17, p.w * 0.36, 28);
        ctx.fillStyle = "rgba(232,165,75,0.35)";
        ctx.fillRect(p.x - p.w * 0.13, p.y - 12, p.w * 0.26, 2);
      } else {
        ctx.fillStyle = "#3a3128";
        ctx.fillRect(p.x - p.w * 0.22, p.y - 17, p.w * 0.44, 28);
        for (const [ox, oy] of [[-6, -9], [6, -9], [0, 1]]) {
          ctx.fillStyle = "rgba(232,165,75,0.55)";
          ctx.beginPath();
          ctx.arc(p.x + ox, p.y + oy, 2.4, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      break;
    }
    case "note":
    case "grave":
    case "rune": {
      ctx.save();
      if (p.type === "grave") {
        ctx.fillStyle = "#3d3b38";
        ctx.beginPath();
        ctx.moveTo(p.x - 7, p.y + 6);
        ctx.lineTo(p.x - 7, p.y - 8);
        ctx.quadraticCurveTo(p.x, p.y - 16, p.x + 7, p.y - 8);
        ctx.lineTo(p.x + 7, p.y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(180,190,200,0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 10);
        ctx.lineTo(p.x, p.y - 2);
        ctx.moveTo(p.x - 3, p.y - 6);
        ctx.lineTo(p.x + 3, p.y - 6);
        ctx.stroke();
      } else if (p.type === "rune") {
        ctx.fillStyle = "rgba(232,165,75,0.24)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#d8c7a1";
        ctx.font = "12px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText("ᛉ", p.x, p.y + 4);
      } else {
        ctx.fillStyle = "#d8c7a1";
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-0.18);
        ctx.fillRect(-6, -4, 12, 8);
        ctx.strokeStyle = "rgba(32,28,36,0.6)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-3, -2);
        ctx.lineTo(3, -2);
        ctx.moveTo(-3, 0);
        ctx.lineTo(2, 0);
        ctx.moveTo(-3, 2);
        ctx.lineTo(3, 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    default: {
      ctx.save();
      ctx.fillStyle = "rgba(70,75,85,0.8)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r || 8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
};

/* RENDER_PART_2 */
Renderer.prototype.drawNpc = function (ctx, npc, scene, myId) {
  const t = this.time;
  ctx.save();
  this.drawShadow(ctx, npc.x, npc.y + 6, 11, 4, 0.4);
  const bob = Math.sin(t * 1.6 + npc.x * 0.1) * 1.2;
  const cloak = npc.cloak || "#3d3a3a";
  const skin = npc.color || "#c9b9a0";
  ctx.fillStyle = cloak;
  ctx.beginPath();
  ctx.moveTo(npc.x - 11, npc.y + 7);
  ctx.quadraticCurveTo(npc.x - 9, npc.y - 16, npc.x, npc.y - 18 + bob);
  ctx.quadraticCurveTo(npc.x + 9, npc.y - 16, npc.x + 11, npc.y + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(npc.x, npc.y - 19 + bob, 5.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(20,16,16,0.65)";
  ctx.beginPath();
  ctx.arc(npc.x, npc.y - 21 + bob, 5.7, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fill();
  if (npc.id === "irma") {
    ctx.fillStyle = `rgba(232,165,75,${0.5 + Math.sin(t * 2) * 0.15})`;
    ctx.beginPath();
    ctx.arc(npc.x + 8, npc.y - 8, 2, 0, TAU);
    ctx.fill();
  }
  const me = scene?.players?.find((p) => p.id === myId);
  const near = me && Math.hypot(me.x - npc.x, me.y - npc.y) < 90;
  if (near) {
    ctx.font = "11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(232,165,75,0.9)";
    ctx.fillText(npc.name, npc.x, npc.y - 34);
  }
  ctx.restore();
};

Renderer.prototype.drawPlayer = function (ctx, p, myId, scene) {
  const def = CLASSES[p.cls] || CLASSES.lantern;
  const t = this.time;
  ctx.save();
  if (p.downed) {
    this.drawShadow(ctx, p.x, p.y + 4, 14, 6, 0.4);
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.5);
    ctx.fillStyle = def.cloak;
    ctx.beginPath();
    ctx.ellipse(0, -4, 16, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(13, -5, 4.5, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }
  const moving = p.input ? Math.hypot(p.input.mx || 0, p.input.my || 0) > 0.1 : false;
  const bob = moving ? Math.sin(t * 10) * 1.2 : Math.sin(t * 2 + p.x) * 0.6;
  const alpha = p.hitFlash > 0 ? 0.62 : 1;
  ctx.globalAlpha = alpha;
  this.drawShadow(ctx, p.x, p.y + 6, 11, 4.5, 0.45);

  if (p.invuln && p.id !== myId) {
    ctx.strokeStyle = "rgba(157,184,216,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 8, 18, 0, TAU);
    ctx.stroke();
  }

  const facing = p.facing ?? -Math.PI / 2;
  // legs
  ctx.strokeStyle = "#1c1a20";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  const step = moving ? Math.sin(t * 10) * 3.2 : 0;
  ctx.beginPath();
  ctx.moveTo(p.x - 3, p.y + 2);
  ctx.lineTo(p.x - 4 + step, p.y + 8);
  ctx.moveTo(p.x + 3, p.y + 2);
  ctx.lineTo(p.x + 4 - step, p.y + 8);
  ctx.stroke();

  // cloak body
  ctx.fillStyle = def.cloak;
  ctx.beginPath();
  ctx.moveTo(p.x - 10, p.y + 5);
  ctx.quadraticCurveTo(p.x - 8, p.y - 16 + bob, p.x, p.y - 18 + bob);
  ctx.quadraticCurveTo(p.x + 8, p.y - 16 + bob, p.x + 10, p.y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(p.x - 6, p.y - 4);
  ctx.quadraticCurveTo(p.x, p.y - 12 + bob, p.x + 3, p.y + 2);
  ctx.lineTo(p.x - 2, p.y + 4);
  ctx.closePath();
  ctx.fill();

  // head/hood
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y - 19 + bob, 5.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = def.cloak;
  ctx.beginPath();
  ctx.arc(p.x, p.y - 21.5 + bob, 6.2, Math.PI * 0.9, Math.PI * 2.1);
  ctx.fill();

  // weapon / lantern orientation
  ctx.save();
  ctx.translate(p.x, p.y - 6 + bob);
  ctx.rotate(facing + Math.PI / 2);
  if (p.cls === "lantern") {
    ctx.strokeStyle = "#6b5336";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -24);
    ctx.stroke();
    const glow = 0.55 + Math.sin(t * 3.1) * 0.18;
    ctx.fillStyle = `rgba(232,165,75,${glow * 0.35})`;
    ctx.beginPath();
    ctx.arc(0, -28, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3a2c1c";
    ctx.fillRect(-3.5, -32, 7, 9);
    ctx.fillStyle = "#ffd99a";
    ctx.fillRect(-2.5, -30.5, 5, 6);
  } else if (p.cls === "hunter") {
    ctx.strokeStyle = "#7b6142";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -22, 12, -1.15, 1.15);
    ctx.stroke();
    ctx.strokeStyle = "rgba(220,220,210,0.45)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(4.5, -33.2);
    ctx.lineTo(4.5, -10.8);
    ctx.stroke();
    if (p.attackAnim > 0) {
      ctx.strokeStyle = `rgba(220,235,210,${p.attackAnim * 3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(5, -12);
      ctx.lineTo(5, -40);
      ctx.stroke();
    }
  } else {
    // executioner axe
    ctx.strokeStyle = "#5d4a35";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -34);
    ctx.stroke();
    ctx.fillStyle = "#9aa0a8";
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.quadraticCurveTo(11, -37, 12, -27);
    ctx.quadraticCurveTo(6, -28, 0, -28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(200,210,220,0.4)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(2, -33);
    ctx.quadraticCurveTo(9, -34, 10, -28);
    ctx.stroke();
  }
  ctx.restore();

  if (p.attackAnim > 0) {
    const progress = 1 - clamp(p.attackAnim / 0.22, 0, 1);
    const a0 = facing - 0.9 + progress * 1.4;
    ctx.strokeStyle = `rgba(255,220,170,${0.5 * (1 - progress)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6, p.cls === "executioner" ? 34 : 27, a0, a0 + 0.9);
    ctx.stroke();
  }

  if (p.talking) {
    ctx.fillStyle = "rgba(12,15,21,0.85)";
    ctx.strokeStyle = "rgba(232,165,75,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(p.x + 10, p.y - 46, 22, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(232,165,75,0.8)";
    for (let i = 0; i < 3; i++) {
      const a = 0.35 + Math.sin(t * 4 + i) * 0.3;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x + 16 + i * 5, p.y - 39, 1.3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
  }

  if (p.id !== myId) {
    ctx.font = "10px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(230,220,200,0.85)";
    ctx.fillText(p.name || "Странник", p.x, p.y - 36);
    const w = 30;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(p.x - w / 2, p.y - 30, w, 3);
    ctx.fillStyle = "#b95858";
    ctx.fillRect(p.x - w / 2, p.y - 30, w * clamp(p.hp / p.maxHp, 0, 1), 3);
  }
  ctx.restore();
};

/* RENDER_PART_3 */
Renderer.prototype.drawEnemy = function (ctx, e) {
  const def = ENEMY_TYPES[e.type] || ENEMY_TYPES.hollow;
  const t = this.time;
  const bob = Math.sin(t * 2.3 + e.x * 0.05) * 1.4;
  ctx.save();
  this.drawShadow(ctx, e.x, e.y + 5, e.boss ? 24 : 10, e.boss ? 9 : 4, 0.45);
  if (e.windup > 0) {
    const total = e.windupTotal || 0.5;
    const ratio = clamp(1 - e.windup / total, 0, 1);
    ctx.strokeStyle = e.boss ? "rgba(180,210,235,0.8)" : "rgba(220,120,90,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, (e.boss ? 34 : 16) + ratio * 8, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
    ctx.stroke();
  }
  if (e.stunned) {
    ctx.strokeStyle = "rgba(232,210,140,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(e.x, e.y - (e.boss ? 54 : 24), 5, 0, TAU);
    ctx.stroke();
  }

  if (e.type === "hound") {
    const dir = Math.cos(e.facing) < 0 ? -1 : 1;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(dir, 1);
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.ellipse(0, -6 + bob * 0.4, 12, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(10, -10 + bob * 0.5, 6, 4.6, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(13, -14);
    ctx.lineTo(15, -19);
    ctx.lineTo(17, -13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    const run = Math.sin(t * 9 + e.x) * 2;
    ctx.beginPath();
    ctx.moveTo(-7, -3);
    ctx.lineTo(-8 + run, 5);
    ctx.moveTo(-2, -3);
    ctx.lineTo(-1 - run, 5);
    ctx.moveTo(6, -3);
    ctx.lineTo(7 - run, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-11, -8);
    ctx.quadraticCurveTo(-18, -12 + bob, -16, -18);
    ctx.stroke();
    ctx.fillStyle = "#ffca7a";
    ctx.beginPath();
    ctx.arc(13, -11 + bob * 0.5, 1.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  } else if (e.type === "weeper") {
    const robe = ctx.createLinearGradient(0, e.y - 32, 0, e.y + 6);
    robe.addColorStop(0, "#8ba2b5");
    robe.addColorStop(1, "#3d4a58");
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.moveTo(e.x - 13, e.y + 6);
    ctx.quadraticCurveTo(e.x - 10, e.y - 16, e.x - 5, e.y - 25 + bob);
    ctx.quadraticCurveTo(e.x, e.y - 31 + bob, e.x + 5, e.y - 25 + bob);
    ctx.quadraticCurveTo(e.x + 10, e.y - 16, e.x + 13, e.y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(20,26,34,0.55)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 24 + bob, 6.5, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#cfe8f7";
    ctx.beginPath();
    ctx.arc(e.x - 2.5, e.y - 24 + bob, 1.2, 0, TAU);
    ctx.arc(e.x + 2.5, e.y - 24 + bob, 1.2, 0, TAU);
    ctx.fill();
    const tear = (t * 22 + e.x) % 26;
    ctx.fillStyle = "rgba(160,205,235,0.65)";
    ctx.beginPath();
    ctx.ellipse(e.x + 4, e.y - 22 + tear, 1.2, 3.4, 0, 0, TAU);
    ctx.fill();
    if (e.windup > 0) {
      ctx.fillStyle = "rgba(140,190,225,0.25)";
      ctx.beginPath();
      ctx.arc(e.x, e.y - 24 + bob, 14 + Math.sin(t * 12) * 2, 0, TAU);
      ctx.fill();
    }
  } else if (e.type === "guardian") {
    ctx.fillStyle = "#3d3a41";
    ctx.beginPath();
    ctx.moveTo(e.x - 16, e.y + 8);
    ctx.lineTo(e.x - 13, e.y - 24 + bob);
    ctx.quadraticCurveTo(e.x, e.y - 34 + bob, e.x + 13, e.y - 24 + bob);
    ctx.lineTo(e.x + 16, e.y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#514c56";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 20 + bob, 9, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(216,192,138,0.55)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(e.x - 7, e.y - 20);
    ctx.lineTo(e.x, e.y - 26 + bob);
    ctx.lineTo(e.x + 7, e.y - 18);
    ctx.moveTo(e.x - 4, e.y - 8);
    ctx.lineTo(e.x + 5, e.y - 2);
    ctx.stroke();
    ctx.fillStyle = "#d8c08a";
    ctx.beginPath();
    ctx.arc(e.x - 3, e.y - 21 + bob, 1.3, 0, TAU);
    ctx.arc(e.x + 3, e.y - 21 + bob, 1.3, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(e.x - 15, e.y - 12);
    ctx.fillStyle = "#4d4852";
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 11, -0.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(216,192,138,0.4)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  } else if (e.type === "boss") {
    const aura = e.phase === 3 ? "rgba(170,205,235,0.18)" : e.phase === 2 ? "rgba(150,185,220,0.13)" : "rgba(130,165,200,0.1)";
    const pulse = 1 + Math.sin(t * 1.4) * 0.04;
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 30, 54 * pulse, 62 * pulse, 0, 0, TAU);
    ctx.fill();
    // tendrils
    ctx.strokeStyle = "rgba(60,78,94,0.8)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const a = t * 0.5 + (i / 5) * TAU;
      const ox = Math.cos(a) * (28 + Math.sin(t * 1.2 + i) * 6);
      const oy = 26 + Math.sin(a * 2) * 5;
      ctx.beginPath();
      ctx.moveTo(e.x + ox * 0.4, e.y + oy * 0.4);
      ctx.quadraticCurveTo(e.x + ox, e.y + oy * 0.7, e.x + ox * 1.25, e.y + 8 + Math.sin(t * 2 + i) * 5);
      ctx.stroke();
    }
    // robe
    const robe = ctx.createLinearGradient(0, e.y - 70, 0, e.y + 10);
    robe.addColorStop(0, "#7d94a8");
    robe.addColorStop(0.55, "#4b5d70");
    robe.addColorStop(1, "#2a3542");
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.moveTo(e.x - 27, e.y + 8);
    ctx.quadraticCurveTo(e.x - 24, e.y - 40, e.x - 12, e.y - 60 + bob);
    ctx.quadraticCurveTo(e.x, e.y - 72 + bob, e.x + 12, e.y - 60 + bob);
    ctx.quadraticCurveTo(e.x + 24, e.y - 40, e.x + 27, e.y + 8);
    ctx.quadraticCurveTo(e.x, e.y + 16, e.x - 27, e.y + 8);
    ctx.fill();
    // mask
    ctx.fillStyle = "rgba(16,22,28,0.85)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 54 + bob, 12, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = e.phase === 3 ? "#d8ecff" : "#b9d5e8";
    ctx.beginPath();
    ctx.ellipse(e.x - 4.5, e.y - 56 + bob, 2, 3, 0, 0, TAU);
    ctx.ellipse(e.x + 4.5, e.y - 56 + bob, 2, 3, 0, 0, TAU);
    ctx.fill();
    // tears
    for (let i = 0; i < 2; i++) {
      const tear = (t * 26 + i * 17 + e.x) % 34;
      ctx.fillStyle = "rgba(170,215,245,0.6)";
      ctx.beginPath();
      ctx.ellipse(e.x - 4 + i * 8, e.y - 48 + bob + tear, 1.4, 4, 0, 0, TAU);
      ctx.fill();
    }
    // crown
    ctx.strokeStyle = "rgba(200,220,235,0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const x = e.x - 12 + i * 6;
      ctx.moveTo(x, e.y - 66 + bob);
      ctx.lineTo(x + 2, e.y - 72 - (i % 2) * 4 + bob);
    }
    ctx.stroke();
    if (e.windup > 0) {
      ctx.strokeStyle = "rgba(190,225,250,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 42 + clamp(1 - e.windup / (e.windupTotal || 0.8), 0, 1) * 16, 0, TAU);
      ctx.stroke();
    }
  } else {
    // hollow
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(e.x - 10, e.y + 5);
    ctx.quadraticCurveTo(e.x - 11, e.y - 16 + bob, e.x, e.y - 25 + bob);
    ctx.quadraticCurveTo(e.x + 11, e.y - 16 + bob, e.x + 10, e.y + 5);
    ctx.lineTo(e.x + 5, e.y + 1);
    ctx.lineTo(e.x + 2, e.y + 6);
    ctx.lineTo(e.x - 3, e.y + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(20,22,28,0.75)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 17 + bob, 5.4, 6.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#d7d2e2";
    ctx.beginPath();
    ctx.arc(e.x - 2, e.y - 18 + bob, 1.1, 0, TAU);
    ctx.arc(e.x + 2, e.y - 18 + bob, 1.1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(141,138,153,0.6)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(e.x - 9, e.y - 8 + bob);
    ctx.quadraticCurveTo(e.x - 16, e.y - 5 + bob, e.x - 13, e.y + 1);
    ctx.moveTo(e.x + 9, e.y - 8 + bob);
    ctx.quadraticCurveTo(e.x + 16, e.y - 5 + bob, e.x + 13, e.y + 1);
    ctx.stroke();
  }

  if (e.hitFlash > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,245,225,${clamp(e.hitFlash * 4, 0, 0.7)})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y - (e.boss ? 38 : 10), e.boss ? 30 : 12, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // health bar / labels
  if (e.boss) {
    // name and boss bar are in HUD
  } else {
    const showBar = e.hp < e.maxHp || e.elite;
    if (showBar) {
      const w = e.elite ? 44 : 22;
      const y = e.y - (e.elite ? 40 : 30);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(e.x - w / 2, y, w, 3);
      ctx.fillStyle = e.elite ? "#d8c08a" : "#b95858";
      ctx.fillRect(e.x - w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 3);
      if (e.elite) {
        ctx.font = "10px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(216,192,138,0.85)";
        ctx.fillText(e.name, e.x, y - 4);
      }
    }
  }
  ctx.restore();
};

/* RENDER_PART_4 */
Renderer.prototype.drawPickup = function (ctx, p) {
  const t = this.time;
  const bob = Math.sin(t * 3 + p.x * 0.1) * 3;
  ctx.save();
  if (p.type === "ember") {
    ctx.fillStyle = "rgba(232,165,75,0.18)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6 + bob, 18, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e8823a";
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y + bob);
    ctx.quadraticCurveTo(p.x - 3, p.y - 8 + bob, p.x, p.y - 15 + bob);
    ctx.quadraticCurveTo(p.x + 4, p.y - 7 + bob, p.x + 4, p.y + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd18a";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 5 + bob, 2, 4, 0, 0, TAU);
    ctx.fill();
  } else if (p.type === "memory") {
    ctx.fillStyle = "rgba(157,184,216,0.2)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6 + bob, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#cfe0f2";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6 + bob, 3.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(157,184,216,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 6 + bob, 7, t * 2, t * 2 + 2.4);
    ctx.stroke();
  } else if (p.type === "health") {
    ctx.fillStyle = "rgba(180,90,90,0.18)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 4 + bob, 13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#b95858";
    ctx.fillRect(p.x - 3, p.y - 12 + bob, 6, 12);
    ctx.fillStyle = "#e0a0a0";
    ctx.fillRect(p.x - 1.5, p.y - 10 + bob, 3, 8);
  } else if (p.type === "heart") {
    const pulse = 1 + Math.sin(t * 2.2) * 0.08;
    ctx.fillStyle = "rgba(130,170,210,0.18)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 10 + bob, 32 * pulse, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#42566a";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + bob);
    ctx.bezierCurveTo(p.x - 20, p.y - 16 + bob, p.x - 10, p.y - 28 + bob, p.x, p.y - 16 + bob);
    ctx.bezierCurveTo(p.x + 10, p.y - 28 + bob, p.x + 20, p.y - 16 + bob, p.x, p.y + bob);
    ctx.fill();
    ctx.fillStyle = "rgba(170,210,240,0.75)";
    ctx.beginPath();
    ctx.arc(p.x + 4, p.y - 14 + bob, 2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

Renderer.prototype.drawProjectile = function (ctx, p) {
  ctx.save();
  if (p.type === "tear") {
    ctx.fillStyle = "rgba(140,190,225,0.2)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#a9d3ef";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 4.5, 6, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(230,245,255,0.8)";
    ctx.beginPath();
    ctx.arc(p.x - 1, p.y - 1, 1.5, 0, TAU);
    ctx.fill();
  } else if (p.type === "pierce") {
    const a = Math.atan2(p.vy, p.vx);
    ctx.strokeStyle = "rgba(170,220,180,0.35)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(a) * 18, p.y - Math.sin(a) * 18);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.strokeStyle = "#d7e8c8";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(a) * 13, p.y - Math.sin(a) * 13);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else {
    const a = Math.atan2(p.vy, p.vx);
    ctx.strokeStyle = "#c9b28a";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(a) * 11, p.y - Math.sin(a) * 11);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(220,220,210,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(a) * 11 - Math.cos(a + Math.PI / 2) * 2.2, p.y - Math.sin(a) * 11 - Math.sin(a + Math.PI / 2) * 2.2);
    ctx.lineTo(p.x - Math.cos(a) * 8, p.y - Math.sin(a) * 8);
    ctx.lineTo(p.x - Math.cos(a) * 11 + Math.cos(a + Math.PI / 2) * 2.2, p.y - Math.sin(a) * 11 + Math.sin(a + Math.PI / 2) * 2.2);
    ctx.stroke();
    ctx.fillStyle = "#e8e0cc";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

Renderer.prototype.drawEffects = function (ctx) {
  for (const e of this.effects) {
    const k = clamp(1 - e.t / e.ttl, 0, 1);
    ctx.save();
    if (e.kind === "particle") {
      ctx.globalAlpha = k;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (0.5 + k * 0.5), 0, TAU);
      ctx.fill();
    } else if (e.kind === "slash") {
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = e.cls === "executioner" ? "#ffb08f" : e.cls === "hunter" ? "#d7e8c8" : "#ffd99a";
      ctx.lineWidth = 3.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(e.x, e.y - 6, e.range, e.a - 0.8, e.a + 0.8);
      ctx.stroke();
      ctx.globalAlpha = k * 0.25;
      ctx.lineWidth = 9;
      ctx.stroke();
    } else if (e.kind === "nova") {
      const r = e.radius * (1 - k * 0.4);
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = "#ffd99a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = k * 0.18;
      ctx.fillStyle = "#ffd99a";
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, TAU);
      ctx.fill();
    } else if (e.kind === "slam") {
      const r = e.radius * (1 - k * 0.85);
      ctx.globalAlpha = k * 0.8;
      ctx.strokeStyle = "#bcd8ee";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = k * 0.3;
      ctx.strokeStyle = "#7d95a9";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * r * 0.7, e.y + Math.sin(a) * r * 0.7);
        ctx.lineTo(e.x + Math.cos(a) * r * 1.1, e.y + Math.sin(a) * r * 1.1);
        ctx.stroke();
      }
    } else if (e.kind === "cone") {
      ctx.globalAlpha = k * 0.5;
      const grad = ctx.createRadialGradient(e.x, e.y, 10, e.x, e.y, e.radius);
      grad.addColorStop(0, "rgba(255,176,143,0.55)");
      grad.addColorStop(1, "rgba(255,176,143,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.arc(e.x, e.y, e.radius, e.a - e.angle / 2, e.a + e.angle / 2);
      ctx.closePath();
      ctx.fill();
    } else if (e.kind === "ring") {
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = e.color || "#9db8d8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * (1.15 - k * 0.3), 0, TAU);
      ctx.stroke();
    } else if (e.kind === "beam") {
      ctx.globalAlpha = k * 0.7;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
    }
    ctx.restore();
  }
};

/* RENDER_PART_5 */
Renderer.prototype.worldToScreen = function (x, y) {
  return {
    x: (x - this.cam.x) * this.zoom + this.w / 2,
    y: (y - this.cam.y) * this.zoom + this.h / 2,
  };
};

Renderer.prototype.drawWorldFog = function (ctx, vb) {
  if (this.reduced) return;
  const t = this.time;
  ctx.save();
  const blobs = [
    { x: vb.x0 + ((t * 9) % (vb.x1 - vb.x0 + 300)), y: vb.y0 + 120, r: 260, a: 0.05 },
    { x: vb.x1 - ((t * 6) % (vb.x1 - vb.x0 + 300)), y: vb.y1 - 120, r: 300, a: 0.045 },
    { x: (vb.x0 + vb.x1) / 2 + Math.sin(t * 0.05) * 220, y: (vb.y0 + vb.y1) / 2, r: 380, a: 0.035 },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(150,170,190,${b.a})`);
    g.addColorStop(1, "rgba(150,170,190,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.r * 1.3, b.r * 0.55, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

Renderer.prototype.drawLighting = function (ctx, scene) {
  const lc = this.lightCtx;
  const lw = this.lightCanvas.width;
  const lh = this.lightCanvas.height;
  const k = lw / this.w;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, lw, lh);
  lc.fillStyle = "rgba(4,7,12,0.5)";
  lc.fillRect(0, 0, lw, lh);
  lc.globalCompositeOperation = "destination-out";

  const lights = [];
  for (const p of scene.props || []) {
    if (p.type === "campfire") lights.push({ x: p.x, y: p.y - 8, r: 160, i: 0.95 });
    else if (p.type === "nameTree") lights.push({ x: p.x, y: p.y - 40, r: 150, i: 0.8 });
    else if (p.type === "shrine") lights.push({ x: p.x, y: p.y - 14, r: 120, i: 0.7 });
    else if (p.type === "hut") lights.push({ x: p.x, y: p.y, r: 70, i: 0.45 });
  }
  for (const p of scene.players || []) {
    if (!p.downed) {
      const r = p.cls === "lantern" ? 190 : 105;
      lights.push({ x: p.x, y: p.y - 8, r, i: p.cls === "lantern" ? 1 : 0.7, warm: true });
    }
  }
  for (const e of scene.enemies || []) {
    if (e.boss) lights.push({ x: e.x, y: e.y - 30, r: 170, i: 0.7, cool: true });
    else if (e.elite) lights.push({ x: e.x, y: e.y - 10, r: 70, i: 0.45, cool: true });
  }
  for (const p of scene.pickups || []) {
    if (p.type === "heart") lights.push({ x: p.x, y: p.y - 8, r: 110, i: 0.75, cool: true });
    else if (p.type === "ember") lights.push({ x: p.x, y: p.y - 6, r: 55, i: 0.5, warm: true });
  }
  const zoom = this.zoom;
  for (const L of lights) {
    const s = this.worldToScreen(L.x, L.y);
    const cx = s.x * k;
    const cy = s.y * k;
    const rr = Math.max(8, L.r * zoom * k);
    const g = lc.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, `rgba(255,255,255,${L.i})`);
    g.addColorStop(0.45, `rgba(255,255,255,${L.i * 0.55})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    lc.fillStyle = g;
    lc.beginPath();
    lc.arc(cx, cy, rr, 0, TAU);
    lc.fill();
  }
  lc.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(this.lightCanvas, 0, 0, this.canvas.width, this.canvas.height);
  ctx.restore();

  // warm/cool tint over the punched holes
  ctx.save();
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  for (const L of lights) {
    if (!L.warm && !L.cool) continue;
    const s = this.worldToScreen(L.x, L.y);
    const rr = L.r * zoom;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr);
    const col = L.cool ? "130,175,215" : "232,165,75";
    g.addColorStop(0, `rgba(${col},${L.warm ? 0.09 : 0.06})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

/* RENDER_PART_6 */
Renderer.prototype.drawObjective = function (ctx, scene, opts) {
  let target = opts.objective;
  if (target === null) return;
  if (!target) {
    const stage = scene.quest?.main?.stage ?? 0;
    const flags = scene.flags || {};
    const lm = scene.landmarks || {};
    if (stage === 0) target = lm.irma;
    else if (stage === 1) {
      if (flags.embers >= 3) target = lm.irma;
      else {
        const me = scene.players?.find((p) => p.id === scene.myId) || scene.players?.[0];
        const missing = [];
        if (!flags.emberKinds?.loyalty) missing.push(lm.hunter);
        if (!flags.emberKinds?.memory) missing.push(lm.nameTree);
        if (!flags.emberKinds?.peace) missing.push(lm.shrine);
        if (me && missing.length) {
          missing.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
          target = missing[0];
        } else target = lm.irma;
      }
    } else if (stage === 2) target = lm.irma;
    else if (stage === 3 || stage === 4) target = lm.chapel;
    else if (stage === 5) target = lm.irma;
  }
  if (!target) return;
  const { w, h } = this;
  const zoom = this.zoom;
  const margin = 54;
  const s = this.worldToScreen(target.x, target.y);
  const onScreen = s.x > margin && s.x < w - margin && s.y > margin && s.y < h - margin;

  if (onScreen) {
    ctx.save();
    const pulse = 0.55 + Math.sin(this.time * 2.4) * 0.2;
    const gy = target.y - 8;
    const grad = ctx.createLinearGradient(target.x, gy - 90, target.x, gy);
    grad.addColorStop(0, "rgba(232,165,75,0)");
    grad.addColorStop(0.7, `rgba(232,165,75,${0.22 * pulse})`);
    grad.addColorStop(1, "rgba(232,165,75,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(target.x - 5, gy - 90, 10, 90);
    ctx.strokeStyle = `rgba(232,165,75,${0.6 * pulse + 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(target.x, gy, 18 + Math.sin(this.time * 2) * 3, 0, TAU);
    ctx.stroke();
    ctx.translate(target.x, gy - 30 - Math.sin(this.time * 2) * 4);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "rgba(255,209,138,0.9)";
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }

  // edge marker in screen space
  if (!onScreen) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cx = w / 2;
    const cy = h / 2;
    let dx = s.x - cx;
    let dy = s.y - cy;
    if (!dx && !dy) dx = 1;
    const scale = Math.min((w / 2 - margin) / Math.abs(dx || 0.001), (h / 2 - margin) / Math.abs(dy || 0.001));
    const mx = cx + dx * scale;
    const my = cy + dy * scale;
    const a = Math.atan2(dy, dx);
    ctx.translate(mx, my);
    ctx.rotate(a);
    ctx.fillStyle = "rgba(232,165,75,0.85)";
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-a);
    const me = scene.players?.find((p) => p.id === scene.myId) || scene.players?.[0];
    if (me) {
      const dist = Math.round(Math.hypot(target.x - me.x, target.y - me.y) / TILE);
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(230,220,200,0.65)";
      ctx.fillText(`${dist} м`, 0, 17);
    }
    ctx.restore();
  }
};

Renderer.prototype.drawAmbient = function (ctx) {
  if (this.reduced) return;
  ctx.save();
  for (const p of this.ambient) {
    const tw = 0.55 + Math.sin(this.time * 2 + p.tw) * 0.45;
    ctx.globalAlpha = p.a * tw;
    ctx.fillStyle = "#e9d6b8";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

Renderer.prototype.drawFloaters = function (ctx) {
  ctx.save();
  ctx.textAlign = "center";
  for (const f of this.floaters) {
    const k = clamp(1 - f.t / f.ttl, 0, 1);
    ctx.globalAlpha = k;
    ctx.font = `${f.big ? 18 : 13}px Georgia, serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8,10,14,0.85)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
};

Renderer.prototype.drawScreenVignette = function (ctx) {
  ctx.save();
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.38, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(3,5,9,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, this.w, this.h);
  ctx.restore();
};

Renderer.prototype.drawMenuBackdrop = function (ctx) {
  const w = this.w;
  const h = this.h;
  const t = this.time;
  ctx.save();
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#06080d");
  sky.addColorStop(0.45, "#0a0e14");
  sky.addColorStop(0.72, "#11151a");
  sky.addColorStop(1, "#171410");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // stars
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 3) * w;
    const y = hash(i, 7) * h * 0.55;
    const tw = 0.25 + (Math.sin(t * 1.2 + i) + 1) * 0.25;
    ctx.globalAlpha = tw * 0.7;
    ctx.fillStyle = i % 5 === 0 ? "#d8c7a1" : "#9fb0c0";
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;

  // moon
  const mx = w * 0.73;
  const my = h * 0.23;
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 170);
  mg.addColorStop(0, "rgba(210,220,230,0.18)");
  mg.addColorStop(0.4, "rgba(170,190,210,0.06)");
  mg.addColorStop(1, "rgba(170,190,210,0)");
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(mx, my, 170, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(220,226,232,0.75)";
  ctx.beginPath();
  ctx.arc(mx, my, 2 + Math.min(w, h) * 0.028, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(190,200,212,0.55)";
  ctx.beginPath();
  ctx.arc(mx - 6, my - 4, Math.min(w, h) * 0.009, 0, TAU);
  ctx.fill();

  // distant ridge
  ctx.fillStyle = "#0d1217";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.68);
  for (let x = 0; x <= w; x += 18) {
    const y = h * 0.64 + Math.sin(x * 0.006 + 1.2) * 18 + Math.sin(x * 0.013) * 9;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // mid pines silhouette
  const drawPine = (x, base, hh, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - hh * 0.22, base);
    ctx.lineTo(x, base - hh);
    ctx.lineTo(x + hh * 0.22, base);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - hh * 0.16, base - hh * 0.35);
    ctx.lineTo(x, base - hh * 0.95);
    ctx.lineTo(x + hh * 0.16, base - hh * 0.35);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 16; i++) {
    const x = (i / 15) * w + (hash(i, 21) - 0.5) * 40;
    const hh = 40 + hash(i, 33) * 90;
    drawPine(x, h * 0.86, hh, "#0b0f12");
  }

  // fog bands
  for (let i = 0; i < 3; i++) {
    const fy = h * (0.7 + i * 0.08);
    const off = Math.sin(t * 0.08 + i * 2) * 60;
    const g = ctx.createRadialGradient(w * (0.3 + i * 0.2) + off, fy, 0, w * (0.3 + i * 0.2) + off, fy, w * 0.42);
    g.addColorStop(0, `rgba(130,150,170,${0.045 - i * 0.008})`);
    g.addColorStop(1, "rgba(130,150,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w * (0.3 + i * 0.2) + off, fy, w * 0.42, h * 0.09, 0, 0, TAU);
    ctx.fill();
  }

  // warm glow at the bottom center
  const fire = ctx.createRadialGradient(w * 0.5, h * 1.02, 0, w * 0.5, h * 1.02, h * 0.55);
  fire.addColorStop(0, "rgba(232,165,75,0.16)");
  fire.addColorStop(0.6, "rgba(190,120,50,0.05)");
  fire.addColorStop(1, "rgba(190,120,50,0)");
  ctx.fillStyle = fire;
  ctx.fillRect(0, h * 0.45, w, h * 0.55);

  // embers
  for (let i = 0; i < 26; i++) {
    const life = (t * 0.08 + i * 0.137) % 1;
    const x = w * 0.5 + (hash(i, 5) - 0.5) * w * 0.5 + Math.sin(t * 0.5 + i) * 18;
    const y = h * (1.02 - life * 0.85);
    ctx.globalAlpha = (1 - life) * 0.55;
    ctx.fillStyle = i % 3 === 0 ? "#ffd18a" : "#e8a54b";
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + hash(i, 9) * 1.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

