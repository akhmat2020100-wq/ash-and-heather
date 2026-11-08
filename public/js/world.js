/* Пепел и Вереск — симуляция мира (общая для соло и хоста) */
import { createMap, TILE } from "./map.js";
import { CLASSES, ENEMY_TYPES, DIALOGUES, NPCS, QUEST_MAIN, SIDE_QUESTS, WEAPON_UPGRADES } from "./data.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const norm = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 0.0001 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const angleDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

let idCounter = 1;
const uid = (p) => `${p}${idCounter++}`;

export class World {
  constructor({ seed = 20261107, solo = false } = {}) {
    this.seed = seed;
    this.solo = solo;
    this.map = createMap(seed);
    this.time = 0;
    this.players = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.events = [];
    this.eventId = 1;
    this.nextEnemyId = 1;
    this.respawnQueue = [];
    this.npcs = this.map.npcs.map((n) => ({ ...n, alive: true }));
    this.flags = {
      embers: 0,
      emberKinds: { loyalty: false, memory: false, peace: false },
      chapelOpen: false,
      bossActive: false,
      bossDead: false,
      hasHeart: false,
      guardianDead: false,
      nameChoice: null,
      merchantTrade: false,
      shrineBlessed: false,
      pendingEnding: null,
      ending: null,
      lastRest: 0,
      herbs: 0,
      beacons: 0,
      barrows: 0,
      truthKnown: false,
      merchantRefused: false,
      millStory: false,
      herbCollected: {},
      beaconsLit: {},
    };
    this.quest = {
      main: { stage: 0 },
      side: { hunter: 1, name: 1, merchant: 1, herbs: 1, beacons: 1, barrows: 1, truth: 1 },
    };
    this.spawnMapEnemies();
  }

  emit(type, data = {}) {
    const e = { id: this.eventId++, type, time: this.time, ...data };
    this.events.push(e);
    if (this.events.length > 240) this.events.splice(0, this.events.length - 240);
    return e;
  }

  spawnMapEnemies() {
    for (const zone of this.map.spawns) {
      if (zone.type === "boss") {
        this.spawnEnemy("boss", zone.x, zone.y, { fixed: true, boss: true, zone });
        continue;
      }
      if (zone.fixed) {
        const e = this.spawnEnemy(zone.type, zone.x, zone.y, { fixed: true, zone });
        if (zone.type === "guardian") e.elite = true;
        continue;
      }
      for (let i = 0; i < zone.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * zone.radius;
        const x = zone.x + Math.cos(a) * r;
        const y = zone.y + Math.sin(a) * r;
        this.spawnEnemy(zone.type, x, y, { zone });
      }
    }
  }

  spawnEnemy(type, x, y, opts = {}) {
    const def = ENEMY_TYPES[type];
    if (!def) return null;
    let pos = { x, y };
    if (this.map.isBlocked(x, y, def.radius || 10)) pos = this.map.randomWalkableNear(x, y, 90);
    const enemy = {
      id: uid("e"),
      type,
      name: def.name,
      x: pos.x,
      y: pos.y,
      spawnX: x,
      spawnY: y,
      radius: def.radius || 10,
      hp: def.hp,
      maxHp: def.hp,
      damage: def.damage,
      speed: def.speed,
      attackRange: def.attackRange,
      attackCd: def.attackCd,
      windupTime: def.windup || 0.4,
      windup: 0,
      cooldown: 0.5 + Math.random() * 0.5,
      facing: Math.PI / 2,
      targetId: null,
      state: "idle",
      phase: 1,
      specialTimer: opts.boss ? 3.2 : 0,
      dormant: !!opts.boss,
      active: !opts.boss,
      fixed: !!opts.fixed,
      boss: !!opts.boss,
      elite: !!opts.elite || type === "guardian",
      zone: opts.zone || null,
      slowTimer: 0,
      stunTimer: 0,
      bleed: 0,
      hitFlash: 0,
      wanderTimer: 0,
      wanderDir: Math.random() * Math.PI * 2,
      lastHitBy: null,
    };
    if (def.ranged) enemy.ranged = true;
    if (enemy.boss) enemy.elite = true;
    this.enemies.push(enemy);
    return enemy;
  }

  addPlayer(id, name, cls, opts = {}) {
    if (this.players.has(id)) return this.players.get(id);
    const def = CLASSES[cls] || CLASSES.lantern;
    const spawn = this.findSpawn(opts.x, opts.y);
    const player = {
      id,
      name: (name || "Странник").slice(0, 24),
      cls: def.id,
      x: spawn.x,
      y: spawn.y,
      radius: 10,
      hp: def.hp,
      maxHp: def.hp,
      memory: 100,
      maxMemory: 100,
      speed: def.speed,
      facing: -Math.PI / 2,
      cooldown: 0,
      dodgeCd: 0,
      abilityCd: 0,
      dodgeTimer: 0,
      dodgeDir: { x: 0, y: 1 },
      invuln: 1.2,
      downed: false,
      downTimer: 0,
      talking: false,
      dialogue: null,
      input: { mx: 0, my: 0 },
      attackAnim: 0,
      hitFlash: 0,
      level: 1,
      xp: 0,
      kills: 0,
      bonusDamage: 0,
      shards: 0,
      weapon: { damage: 0, speed: 0, aim: 0, resonance: 0 },
      reviveTargetId: null,
      reviveTimer: 0,
      reviveDuration: 1.5,
      channeling: false,
      lastMove: 0,
      whisperTimer: 0,
    };
    if (opts.restore) {
      Object.assign(player, opts.restore);
      player.cls = def.id;
      player.dialogue = null;
      player.talking = false;
      player.downed = false;
      player.reviveTargetId = null;
      player.channeling = false;
      player.input = { mx: 0, my: 0 };
    }
    this.players.set(id, player);
    this.emit("playerJoin", { id, name: player.name, cls: player.cls, x: player.x, y: player.y });
    return player;
  }

  findSpawn(x, y) {
    if (x != null && y != null && !this.map.isBlocked(x, y, 12)) return { x, y };
    const candidates = [
      [46, 35.5],
      [42, 36.5],
      [46, 30.5],
      [40, 34.5],
      [43, 37.5],
    ];
    for (const [tx, ty] of candidates) {
      const px = tx * TILE;
      const py = ty * TILE;
      if (!this.map.isBlocked(px, py, 12)) return { x: px, y: py };
    }
    return this.map.randomWalkableNear(44 * TILE, 34 * TILE, 140);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.emit("playerLeave", { id, name: p.name });
    // cancel any revive channels targeting this player
    for (const other of this.players.values()) {
      if (other.reviveTargetId === id) {
        other.reviveTargetId = null;
        other.reviveTimer = 0;
        other.channeling = false;
      }
    }
  }

  setMove(id, mx, my) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.downed || p.talking) {
      p.input.mx = 0;
      p.input.my = 0;
      return;
    }
    const n = norm(Number(mx) || 0, Number(my) || 0);
    if (p.channeling) {
      if (n.x || n.y) this.cancelRevive(p);
      else return;
    }
    p.input.mx = n.x;
    p.input.my = n.y;
    if (n.x || n.y) p.facing = Math.atan2(n.y, n.x);
  }

  action(id, action, data = {}) {
    const p = this.players.get(id);
    if (!p) return;
    if (action === "choice") {
      this.chooseDialogue(p, data.index);
      return;
    }
    if (action === "closeDialogue") {
      this.endDialogue(p);
      return;
    }
    if (p.downed) return;
    if (p.talking) return;
    if (action === "upgrade") {
      this.upgradeWeapon(p, data.key);
      return;
    }
    if (action === "interact") {
      if (p.channeling) {
        this.cancelRevive(p);
        return;
      }
      this.tryInteract(p);
      return;
    }
    if (action === "attack") this.tryAttack(p);
    else if (action === "dodge") this.tryDodge(p);
    else if (action === "ability") this.tryAbility(p);
  }

  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    if (!(dt > 0)) return;
    this.time += dt;

    for (const p of this.players.values()) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.dodgeCd = Math.max(0, p.dodgeCd - dt);
      p.abilityCd = Math.max(0, p.abilityCd - dt);
      p.invuln = Math.max(0, p.invuln - dt);
      p.attackAnim = Math.max(0, p.attackAnim - dt);
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.whisperTimer -= dt;
      if (p.hp > 0 && p.memory / p.maxMemory < 0.28 && p.whisperTimer <= 0) {
        p.whisperTimer = 8 + Math.random() * 4;
        this.emit("whisper", { id: p.id, text: whisperText(p) });
      }

      if (p.talking) {
        p.input.mx = 0;
        p.input.my = 0;
        continue;
      }
      if (p.downed) {
        p.downTimer -= dt;
        if (p.downTimer <= 0) this.respawn(p);
        continue;
      }

      if (p.channeling) {
        const target = this.players.get(p.reviveTargetId);
        if (!target || !target.downed || dist(p.x, p.y, target.x, target.y) > 70) {
          this.cancelRevive(p);
        } else {
          p.reviveTimer += dt;
          if (p.reviveTimer >= p.reviveDuration) {
            this.revivePlayer(p, target);
            this.cancelRevive(p);
          }
        }
        continue;
      }

      if (p.dodgeTimer > 0) {
        p.dodgeTimer -= dt;
        const mult = 3.1;
        this.map.moveEntity(p, p.dodgeDir.x * p.speed * mult * dt, p.dodgeDir.y * p.speed * mult * dt);
        continue;
      }

      const mv = norm(p.input.mx, p.input.my);
      if (mv.x || mv.y) {
        this.map.moveEntity(p, mv.x * p.speed * dt, mv.y * p.speed * dt);
        p.lastMove = this.time;
        p.facing = Math.atan2(mv.y, mv.x);
      }
    }

    // projectiles
    this.updateProjectiles(dt);
    // enemies
    for (const e of [...this.enemies]) this.updateEnemy(e, dt);
    // pickups
    this.updatePickups(dt);
    // respawn queue
    this.updateRespawns();
    // cleanup old events
    if (this.events.length > 0) {
      const cutoff = this.time - 4;
      while (this.events.length && this.events[0].time < cutoff) this.events.shift();
    }
  }

  updateEnemy(e, dt) {
    if (e.hp <= 0) return;
    if (e.boss && !e.active) {
      this.checkBossAwake(e);
      if (!e.active) return;
    }
    e.cooldown = Math.max(0, e.cooldown - dt);
    const wasWindingUp = e.windup > 0;
    e.windup = Math.max(0, e.windup - dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.stunTimer = Math.max(0, e.stunTimer - dt);
    e.slowTimer = Math.max(0, e.slowTimer - dt);
    if (e.bleed > 0 && this.time % 0.5 < dt) {
      this.damageEnemy(e, e.bleed, null, { silent: true });
    }
    if (e.stunTimer > 0) return;

    if (e.boss) {
      this.updateBoss(e, dt);
      return;
    }

    const target = this.nearestPlayer(e.x, e.y, e.ranged ? 420 : 360, !e.boss);
    const def = ENEMY_TYPES[e.type];
    if (!target) {
      // idle wander near spawn
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderTimer = 2 + Math.random() * 3;
        e.wanderDir = Math.random() * Math.PI * 2;
        e.state = "idle";
      }
      if (e.state === "idle" && dist(e.x, e.y, e.spawnX, e.spawnY) < 90) {
        const sp = 0.25;
        this.enemyMove(e, Math.cos(e.wanderDir) * e.speed * sp * dt, Math.sin(e.wanderDir) * e.speed * sp * dt);
      } else if (dist(e.x, e.y, e.spawnX, e.spawnY) > 90) {
        const d = angleTo(e.x, e.y, e.spawnX, e.spawnY);
        this.enemyMove(e, Math.cos(d) * e.speed * dt, Math.sin(d) * e.speed * dt);
      }
      e.state = "idle";
      return;
    }

    e.targetId = target.id;
    e.facing = angleTo(e.x, e.y, target.x, target.y);
    const d = dist(e.x, e.y, target.x, target.y);

    if (wasWindingUp) {
      e.state = "windup";
      if (e.windup <= 0) {
        this.enemyAttack(e, target);
        return;
      }
      // small lunge for hounds
      if (e.type === "hound" && d > 18) {
        const a = e.facing;
        this.enemyMove(e, Math.cos(a) * e.speed * 1.8 * dt, Math.sin(a) * e.speed * 1.8 * dt);
      }
      return;
    }

    if (e.cooldown <= 0 && d <= e.attackRange && this.hasLineOfSight(e.x, e.y, target.x, target.y)) {
      e.cooldown = e.attackCd + e.windupTime;
      e.windup = e.windupTime;
      e.state = "windup";
      this.emit("enemyWindup", { id: e.id, x: e.x, y: e.y, time: e.windupTime, type: e.type });
      return;
    }

    const speed = e.speed * (e.slowTimer > 0 ? 0.45 : 1);
    if (e.ranged) {
      if (d < 145) {
        const a = e.facing + Math.PI;
        this.enemyMove(e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
      } else if (d > 245) {
        const a = e.facing;
        this.enemyMove(e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
      } else {
        // strafe
        const a = e.facing + Math.PI / 2;
        e.wanderDir = a;
        this.enemyMove(e, Math.cos(a) * speed * 0.5 * dt, Math.sin(a) * speed * 0.5 * dt);
      }
    } else {
      if (d > Math.max(10, e.attackRange - 6)) {
        const a = e.facing;
        this.enemyMove(e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
      }
    }
    e.state = "chase";
  }

  enemyMove(e, dx, dy) {
    const moved = this.map.moveEntity(e, dx, dy);
    if (!moved) {
      const base = Math.atan2(dy, dx);
      for (const off of [0.8, -0.8, 1.6, -1.6]) {
        const a = base + off;
        if (this.map.moveEntity(e, Math.cos(a) * Math.hypot(dx, dy), Math.sin(a) * Math.hypot(dx, dy))) return;
      }
    }
    // soft separation
    for (const other of this.enemies) {
      if (other === e || other.hp <= 0) continue;
      const dd = dist(e.x, e.y, other.x, other.y);
      const min = e.radius + other.radius + 2;
      if (dd > 0 && dd < min) {
        const push = (min - dd) / dd * 0.5;
        e.x += (e.x - other.x) * push;
        e.y += (e.y - other.y) * push;
      }
    }
    e.x = clamp(e.x, TILE * 2, (this.map.width - 2) * TILE);
    e.y = clamp(e.y, TILE * 2, (this.map.height - 2) * TILE);
  }

  enemyAttack(e, target) {
    e.windup = 0;
    if (!target || target.downed || target.talking) return;
    const d = dist(e.x, e.y, target.x, target.y);
    if (e.ranged) {
      if (d > e.attackRange + 60) return;
      const a = angleTo(e.x, e.y, target.x, target.y);
      this.spawnProjectile({
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * 175,
        vy: Math.sin(a) * 175,
        damage: e.damage,
        team: "enemy",
        owner: e.id,
        type: "tear",
        radius: 6,
        ttl: 3.2,
      });
      this.emit("enemyShoot", { x: e.x, y: e.y, a });
    } else {
      if (d <= e.attackRange + 16) this.damagePlayer(target, e.damage, e);
      this.emit("enemyHit", { x: e.x, y: e.y, a: e.facing });
    }
  }

  checkBossAwake(boss) {
    for (const p of this.players.values()) {
      if (p.downed) continue;
      if (p.x > 35 * TILE && p.x < 53 * TILE && p.y > 5 * TILE && p.y < 17.5 * TILE) {
        boss.active = true;
        boss.dormant = false;
        this.flags.bossActive = true;
        this.emit("bossIntro", { id: boss.id });
        return;
      }
    }
  }

  updateBoss(boss, dt) {
    boss.cooldown = Math.max(0, boss.cooldown - dt);
    boss.specialTimer -= dt;
    boss.hitFlash = Math.max(0, boss.hitFlash - dt);
    const wasWindingUp = boss.windup > 0;
    boss.windup = Math.max(0, boss.windup - dt);
    const target = this.nearestPlayer(boss.x, boss.y, 900, false);
    if (!target) return;
    boss.facing = angleTo(boss.x, boss.y, target.x, target.y);
    const d = dist(boss.x, boss.y, target.x, target.y);

    if (boss.hp <= boss.maxHp * 0.6 && boss.phase === 1) {
      boss.phase = 2;
      this.emit("bossPhase", { phase: 2 });
    }
    if (boss.hp <= boss.maxHp * 0.3 && boss.phase === 2) {
      boss.phase = 3;
      this.emit("bossPhase", { phase: 3 });
    }

    if (wasWindingUp) {
      boss.state = "windup";
      if (boss.windup <= 0) {
        // slam around boss
        const radius = 130;
        for (const p of this.players.values()) {
          if (!p.downed && !p.talking && dist(boss.x, boss.y, p.x, p.y) < radius + p.radius) {
            this.damagePlayer(p, 18 + (boss.phase - 1) * 4, boss);
          }
        }
        this.emit("bossSlam", { x: boss.x, y: boss.y, radius });
      }
      return;
    }

    if (boss.specialTimer <= 0) {
      boss.specialTimer = boss.phase === 3 ? 3.3 : boss.phase === 2 ? 4.2 : 5;
      const count = boss.phase === 3 ? 16 : boss.phase === 2 ? 12 : 8;
      const offset = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * Math.PI * 2;
        this.spawnProjectile({
          x: boss.x,
          y: boss.y,
          vx: Math.cos(a) * 130,
          vy: Math.sin(a) * 130,
          damage: 9,
          team: "enemy",
          owner: boss.id,
          type: "tear",
          radius: 6,
          ttl: 3.8,
        });
      }
      this.emit("bossTears", { x: boss.x, y: boss.y, count });
      if (boss.phase >= 2) {
        const adds = boss.phase === 3 ? 3 : 2;
        for (let i = 0; i < adds; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawnEnemy("hollow", boss.x + Math.cos(a) * 90, boss.y + Math.sin(a) * 90, {});
        }
        this.emit("bossSummon", { count: adds });
      }
    }

    if (boss.cooldown <= 0 && d < 150) {
      boss.cooldown = 2.8;
      boss.windup = 0.8;
      boss.state = "windup";
      this.emit("enemyWindup", { id: boss.id, x: boss.x, y: boss.y, time: 0.8, type: "boss" });
      return;
    }

    if (d > 86) {
      const speed = boss.speed * (boss.phase === 3 ? 1.35 : 1);
      this.enemyMove(boss, Math.cos(boss.facing) * speed * dt, Math.sin(boss.facing) * speed * dt);
      boss.state = "chase";
    } else {
      boss.state = "idle";
    }
  }

  nearestPlayer(x, y, maxDist = 500, ignoreTalking = true) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const p of this.players.values()) {
      if (p.downed) continue;
      if (ignoreTalking && p.talking) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  tryAttack(p) {
    if (p.cooldown > 0 || p.downed || p.talking || p.channeling) return;
    const def = CLASSES[p.cls];
    const w = p.weapon || {};
    const aimMul = 1 + 0.1 * (w.aim || 0);
    const target = this.nearestEnemy(p.x, p.y, (def.ranged ? 380 : 210) * aimMul);
    if (target) p.facing = angleTo(p.x, p.y, target.x, target.y);
    p.cooldown = def.cooldown * Math.max(0.6, 1 - 0.08 * (w.speed || 0));
    p.attackAnim = 0.22;
    const dmg = Math.round(def.damage * (1 + 0.12 * (w.damage || 0))) + (p.level - 1) * 2 + p.bonusDamage;

    if (def.ranged) {
      const a = p.facing;
      this.spawnProjectile({
        x: p.x + Math.cos(a) * 16,
        y: p.y + Math.sin(a) * 16,
        vx: Math.cos(a) * def.projectileSpeed * aimMul,
        vy: Math.sin(a) * def.projectileSpeed * aimMul,
        damage: dmg,
        team: "player",
        owner: p.id,
        type: "arrow",
        radius: 5,
        ttl: 1.6,
      });
      this.emit("shoot", { x: p.x, y: p.y, a, cls: p.cls });
      return;
    }

    let hit = 0;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > def.range + e.radius) continue;
      const a = angleTo(p.x, p.y, e.x, e.y);
      if (Math.abs(angleDiff(a, p.facing)) > 0.95) continue;
      this.damageEnemy(e, dmg, p);
      hit++;
    }
    this.emit("slash", { x: p.x, y: p.y, a: p.facing, range: def.range, cls: p.cls, hits: hit });
  }

  tryAbility(p) {
    const def = CLASSES[p.cls];
    const ab = def.ability;
    if (p.downed || p.talking || p.channeling) return;
    if (p.abilityCd > 0) return;
    if (p.memory < ab.cost) {
      this.emit("memoryFail", { id: p.id, text: "Слишком мало Памяти." });
      return;
    }
    const w = p.weapon || {};
    const abilityMul = 1 + 0.08 * (w.resonance || 0);
    p.memory = Math.max(0, p.memory - ab.cost);
    p.abilityCd = ab.cd * Math.max(0.64, 1 - 0.06 * (w.resonance || 0));
    const target = this.nearestEnemy(p.x, p.y, ab.radius + 180);
    if (target) p.facing = angleTo(p.x, p.y, target.x, target.y);

    if (ab.id === "nova") {
      let hit = 0;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (dist(p.x, p.y, e.x, e.y) <= ab.radius + e.radius) {
          this.damageEnemy(e, Math.round(ab.damage * abilityMul) + (p.level - 1) * 2, p);
          e.stunTimer = Math.max(e.stunTimer, ab.stun);
          hit++;
        }
      }
      this.emit("nova", { x: p.x, y: p.y, radius: ab.radius, hits: hit });
    } else if (ab.id === "pierce") {
      this.spawnProjectile({
        x: p.x + Math.cos(p.facing) * 16,
        y: p.y + Math.sin(p.facing) * 16,
        vx: Math.cos(p.facing) * ab.speed,
        vy: Math.sin(p.facing) * ab.speed,
        damage: Math.round(ab.damage * abilityMul) + (p.level - 1) * 2,
        team: "player",
        owner: p.id,
        type: "pierce",
        radius: 6,
        ttl: 1.8,
        pierce: true,
        slow: ab.slow,
        hitIds: new Set(),
      });
      this.emit("pierce", { x: p.x, y: p.y, a: p.facing });
    } else if (ab.id === "cone") {
      let hit = 0;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > ab.radius + e.radius) continue;
        const a = angleTo(p.x, p.y, e.x, e.y);
        if (Math.abs(angleDiff(a, p.facing)) > ab.angle / 2) continue;
        this.damageEnemy(e, Math.round(ab.damage * abilityMul) + (p.level - 1) * 2, p);
        e.bleed = Math.max(e.bleed, ab.bleed);
        hit++;
      }
      this.emit("cone", { x: p.x, y: p.y, a: p.facing, radius: ab.radius, angle: ab.angle, hits: hit });
    }
    if (p.memory <= 0) this.emit("memoryEmpty", { id: p.id });
  }

  tryDodge(p) {
    if (p.dodgeCd > 0 || p.downed || p.talking || p.channeling) return;
    const def = CLASSES[p.cls];
    let dir = norm(p.input.mx, p.input.my);
    if (!dir.x && !dir.y) dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    p.dodgeDir = dir;
    p.dodgeTimer = 0.17;
    p.dodgeCd = def.dodgeCd;
    p.invuln = Math.max(p.invuln, 0.36);
    this.emit("dodge", { x: p.x, y: p.y, a: Math.atan2(dir.y, dir.x) });
  }

  tryInteract(p) {
    if (p.downed || p.talking || p.channeling) return;
    // revive fallen ally
    let downed = null;
    let bestD = 60 * 60;
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.downed) continue;
      const d = dist2(p.x, p.y, other.x, other.y);
      if (d < bestD) {
        bestD = d;
        downed = other;
      }
    }
    if (downed) {
      p.reviveTargetId = downed.id;
      p.reviveTimer = 0;
      p.channeling = true;
      p.input.mx = 0;
      p.input.my = 0;
      this.emit("reviveStart", { id: p.id, targetId: downed.id });
      return;
    }

    let best = null;
    let bestDist = 58;
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const d = dist(p.x, p.y, npc.x, npc.y);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "npc", npc };
      }
    }
    for (const prop of this.map.props) {
      if (!prop.interact) continue;
      if (prop.interact.kind === "herb" && this.flags.herbCollected[prop.id]) continue;
      const d = dist(p.x, p.y, prop.x, prop.y);
      if (d < bestDist + (prop.r || 8) * 0.35) {
        bestDist = d;
        best = { kind: "prop", prop };
      }
    }
    if (!best) {
      this.emit("nothing", { id: p.id });
      return;
    }
    if (best.kind === "npc") {
      const node = this.getNpcNode(best.npc, p);
      this.startDialogue(p, best.npc.dialogue, node);
      return;
    }
    const prop = best.prop;
    const inter = prop.interact;
    if (inter.kind === "campfire") {
      this.rest(p);
    } else if (inter.kind === "workbench") {
      this.emit("workbench", { id: p.id });
    } else if (inter.kind === "herb") {
      if (!this.flags.herbCollected[prop.id]) {
        this.flags.herbCollected[prop.id] = true;
        this.flags.herbs = Math.min(3, (this.flags.herbs || 0) + 1);
        this.emit("herb", { id: p.id, x: prop.x, y: prop.y, count: this.flags.herbs });
        this.emit("toast", { text: `Трава собрана. ${this.flags.herbs}/3.` });
        if (this.flags.herbs >= 3) {
          if (this.quest.side.herbs < 3) this.quest.side.herbs = Math.max(this.quest.side.herbs, 2);
          this.emit("quest", {});
          this.emit("toast", { text: "Все три травы у тебя. Мила ждёт в Соляной топи." });
        }
      }
    } else if (inter.kind === "beacon") {
      const key = prop.id.replace(/^beacon_/, "");
      if (!this.flags.beaconsLit[key]) {
        this.flags.beaconsLit[key] = true;
        this.flags.beacons = Math.min(3, (this.flags.beacons || 0) + 1);
        this.emit("beacon", { id: p.id, x: prop.x, y: prop.y, count: this.flags.beacons, key });
        this.emit("toast", { text: `Сигнальный огонь горит. ${this.flags.beacons}/3.` });
        if (this.flags.beacons >= 3) {
          if (this.quest.side.beacons < 3) this.quest.side.beacons = Math.max(this.quest.side.beacons, 2);
          this.emit("quest", {});
          this.emit("toast", { text: "Три дыма поднялись над Морном. Гарм ждёт у перевоза." });
        }
      } else {
        this.emit("toast", { text: "Этот огонь уже горит." });
      }
    } else if (inter.kind === "dialogue") {
      let node = "intro";
      if (inter.script === "nameTree" && this.flags.nameChoice) node = "done";
      this.startDialogue(p, inter.script, node);
    } else if (inter.kind === "door") {
      this.startDialogue(p, "chapelDoor", this.flags.chapelOpen ? "open" : "locked");
    } else if (inter.kind === "shrine") {
      if (!this.flags.shrineBlessed) {
        this.flags.shrineBlessed = true;
        p.memory = Math.min(p.maxMemory, p.memory + 12);
        this.emit("toast", { text: "Южный алтарь помнит тех, кто ушёл. Память +12." });
      } else {
        this.emit("toast", { text: "Алтарь молчит. Только вода и камень." });
      }
    }
  }

  getNpcNode(npc, p) {
    if (npc.dialogue === "irma") {
      if (this.flags.ending) return "done";
      if (this.quest.side.hunter === 2) return "hunterMessage";
      const stage = this.quest.main.stage;
      if (stage === 0) return "intro";
      if (stage === 1) return this.flags.embers >= 3 ? "return" : "wait";
      if (stage === 2) return "return";
      if (stage === 3) return "chapelOpen";
      if (stage === 4) return "heartWait";
      if (stage === 5) return "afterBoss";
      return "done";
    }
    if (npc.dialogue === "hunter") {
      if (this.quest.side.hunter >= 2) return "done";
      return "intro";
    }
    if (npc.dialogue === "nameTree") {
      return this.flags.nameChoice ? "done" : "intro";
    }
    if (npc.dialogue === "merchant") {
      return this.flags.merchantTrade ? "done" : "intro";
    }
    if (npc.dialogue === "mila") {
      if (this.quest.side.herbs >= 3) return "done";
      if (this.flags.herbs >= 3) return "reward";
      return this.quest.side.herbs >= 2 ? "wait" : "intro";
    }
    if (npc.dialogue === "garm") {
      if (this.quest.side.beacons >= 3) return "done";
      if (this.flags.beacons >= 3) return "reward";
      return this.quest.side.beacons >= 2 ? "wait" : "intro";
    }
    if (npc.dialogue === "ada") {
      if (this.quest.side.barrows >= 3) return "done";
      if (this.flags.barrows >= 3) return "reward";
      return this.quest.side.barrows >= 2 ? "wait" : "intro";
    }
    if (npc.dialogue === "hermit") {
      return this.flags.truthKnown ? "done" : "intro";
    }
    return "intro";
  }

  startDialogue(p, scriptId, nodeId) {
    const script = DIALOGUES[scriptId];
    if (!script || !script.nodes[nodeId]) return;
    p.dialogue = { scriptId, nodeId };
    p.talking = true;
    p.input.mx = 0;
    p.input.my = 0;
    this.updateDialogueView(p);
    this.emit("dialogue", { id: p.id, scriptId, nodeId });
  }

  updateDialogueView(p) {
    const d = p.dialogue;
    if (!d) return;
    const script = DIALOGUES[d.scriptId];
    const node = script?.nodes[d.nodeId];
    if (!node) {
      this.endDialogue(p);
      return;
    }
    p.dialogueView = {
      scriptId: d.scriptId,
      nodeId: d.nodeId,
      speaker: script.speaker,
      text: node.text,
      choices: (node.choices || []).map((c) => ({ label: c.label })),
      canClose: !node.choices || node.choices.length === 0,
    };
  }

  chooseDialogue(p, index) {
    if (!p.talking || !p.dialogue) return;
    const script = DIALOGUES[p.dialogue.scriptId];
    const node = script?.nodes[p.dialogue.nodeId];
    if (!node) return this.endDialogue(p);
    const choice = node.choices?.[index];
    if (!choice) return;
    const override = choice.action ? this.applyDialogueAction(p, choice.action, choice) : null;
    let next = typeof override === "string" ? override : choice.next || node.next || null;
    if (choice.end || !next) {
      this.endDialogue(p);
      return;
    }
    if (!script.nodes[next]) {
      this.endDialogue(p);
      return;
    }
    p.dialogue.nodeId = next;
    this.updateDialogueView(p);
    this.emit("dialogueAdvance", { id: p.id, nodeId: next });
  }

  endDialogue(p) {
    if (!p.dialogue) return;
    p.dialogue = null;
    p.dialogueView = null;
    p.talking = false;
    p.invuln = Math.max(p.invuln, 0.6);
    this.emit("dialogueEnd", { id: p.id });
  }

  applyDialogueAction(p, action, choice) {
    switch (action) {
      case "startMain": {
        if (this.quest.main.stage === 0) {
          this.quest.main.stage = this.flags.embers >= 3 ? 2 : 1;
          this.emit("quest", {});
        }
        return null;
      }
      case "giveEmberHunter": {
        this.addEmber("loyalty", p);
        this.quest.side.hunter = 2;
        this.emit("toast", { text: "Уголёк Верности согревает ладонь." });
        return null;
      }
      case "deliverHunterMessage": {
        this.quest.side.hunter = 3;
        p.memory = Math.min(p.maxMemory, p.memory + 10);
        this.emit("toast", { text: "Ирма запомнит его имя. Память +10." });
        return null;
      }
      case "nameTake": {
        if (!this.flags.nameChoice) {
          this.flags.nameChoice = "take";
          this.quest.side.name = 3;
          this.addEmber("memory", p);
          p.memory = Math.min(p.maxMemory, p.memory + 25);
          this.emit("toast", { text: "Чужое имя согревает. Память +25." });
        }
        return null;
      }
      case "nameReturn": {
        if (!this.flags.nameChoice) {
          this.flags.nameChoice = "return";
          this.quest.side.name = 3;
          this.addEmber("memory", p);
          p.memory = Math.max(0, p.memory - 15);
          p.maxHp += 10;
          p.hp += 10;
          this.emit("toast", { text: "Имя вернулось в мир. Максимум здоровья +10." });
        }
        return null;
      }
      case "tradeMemory": {
        if (p.memory < 20) return "poor";
        p.memory -= 20;
        p.maxHp += 15;
        p.hp = Math.min(p.maxHp, p.hp + 15);
        this.flags.merchantTrade = true;
        this.quest.side.merchant = 2;
        this.emit("toast", { text: "Соляной оберег согревает грудь. Максимум здоровья +15." });
        return null;
      }
      case "acceptHerbs": {
        if (this.quest.side.herbs === 1) {
          this.quest.side.herbs = 2;
          this.emit("quest", {});
          this.emit("toast", { text: "Мила просит три травы. Они растут у чёрной воды." });
        }
        return null;
      }
      case "herbReward": {
        if (this.flags.herbs >= 3 && this.quest.side.herbs < 3) {
          this.quest.side.herbs = 3;
          p.shards += 8;
          p.maxHp += 12;
          p.hp = Math.min(p.maxHp, p.hp + 12);
          p.memory = Math.min(p.maxMemory, p.memory + 20);
          this.emit("shards", { id: p.id, x: p.x, y: p.y - 20, amount: 8 });
          this.emit("quest", {});
          this.emit("toast", { text: "Соль Милы. Максимум здоровья +12, осколки +8." });
        }
        return null;
      }
      case "acceptBeacons": {
        if (this.quest.side.beacons === 1) {
          this.quest.side.beacons = 2;
          this.emit("quest", {});
          this.emit("toast", { text: "Гарм просит зажечь три сигнальных огня." });
        }
        return null;
      }
      case "beaconReward": {
        if (this.flags.beacons >= 3 && this.quest.side.beacons < 3) {
          this.quest.side.beacons = 3;
          p.shards += 12;
          p.maxMemory += 8;
          p.memory = Math.min(p.maxMemory, p.memory + 16);
          this.emit("shards", { id: p.id, x: p.x, y: p.y - 20, amount: 12 });
          this.emit("quest", {});
          this.emit("toast", { text: "Плата Гарма. Максимум памяти +8, осколки +12." });
        }
        return null;
      }
      case "acceptBarrows": {
        if (this.quest.side.barrows === 1) {
          this.quest.side.barrows = 2;
          this.emit("quest", {});
          this.emit("toast", { text: "Ада просит уложить трёх курганных." });
        }
        return null;
      }
      case "barrowReward": {
        if (this.flags.barrows >= 3 && this.quest.side.barrows < 3) {
          this.quest.side.barrows = 3;
          p.shards += 10;
          p.maxHp += 10;
          p.hp = Math.min(p.maxHp, p.hp + 10);
          this.emit("shards", { id: p.id, x: p.x, y: p.y - 20, amount: 10 });
          this.emit("quest", {});
          this.emit("toast", { text: "Дар Ады. Максимум здоровья +10, осколки +10." });
        }
        return null;
      }
      case "learnTruth": {
        if (!this.flags.truthKnown) {
          this.flags.truthKnown = true;
          this.quest.side.truth = 2;
          p.maxMemory += 10;
          p.memory = Math.min(p.maxMemory, p.memory + 20);
          this.emit("quest", {});
          this.emit("toast", { text: "Ты узнал, из чего слеплен огонь. Третий путь открыт." });
        }
        return null;
      }
      case "millStory": {
        if (!this.flags.millStory) {
          this.flags.millStory = true;
          p.memory = Math.min(p.maxMemory, p.memory + 8);
          this.emit("toast", { text: "Жернова помнят имена. Память +8." });
        }
        return null;
      }
      case "endingTruth": {
        if (!this.flags.truthKnown) return "noTruth";
        this.flags.pendingEnding = "truth";
        return null;
      }
      case "openChapel": {
        if (this.flags.embers >= 3 && !this.flags.chapelOpen) {
          this.flags.chapelOpen = true;
          this.map.setChapelOpen(true);
          this.quest.main.stage = 3;
          this.emit("quest", {});
          this.emit("toast", { text: "Дверь часовни открыта. Плакальщик ждёт." });
        }
        return null;
      }
      case "endingHope": {
        this.flags.pendingEnding = "hope";
        return null;
      }
      case "endingPower": {
        this.flags.pendingEnding = "power";
        return null;
      }
      case "finishMain": {
        this.flags.ending = this.flags.pendingEnding || "hope";
        this.quest.main.stage = 6;
        this.emit("ending", { ending: this.flags.ending });
        return null;
      }
      case "rest": {
        this.rest(p);
        return null;
      }
      default:
        return null;
    }
  }

  addEmber(kind, p) {
    if (!kind || this.flags.emberKinds[kind]) return false;
    this.flags.emberKinds[kind] = true;
    this.flags.embers = Math.min(3, this.flags.embers + 1);
    this.emit("ember", { kind, count: this.flags.embers, id: p?.id });
    if (this.flags.embers >= 3 && this.quest.main.stage === 1) {
      this.quest.main.stage = 2;
      this.emit("quest", {});
      this.emit("toast", { text: "Все три уголька собраны. Вернись к Ирме." });
    }
    return true;
  }

  rest(p) {
    for (const other of this.players.values()) {
      if (dist(p.x, p.y, other.x, other.y) < 130) {
        other.hp = other.maxHp;
        other.memory = other.maxMemory;
        other.downed = false;
        other.downTimer = 0;
      }
    }
    this.flags.lastRest = this.time;
    this.emit("rest", { id: p.id });
    this.emit("toast", { text: "Огонь помнит тебя. Здоровье и Память восстановлены." });
  }

  cancelRevive(p) {
    if (!p.channeling) return;
    p.channeling = false;
    p.reviveTargetId = null;
    p.reviveTimer = 0;
    this.emit("reviveCancel", { id: p.id });
  }

  revivePlayer(reviver, target) {
    target.downed = false;
    target.downTimer = 0;
    target.hp = Math.ceil(target.maxHp * 0.45);
    target.invuln = 2;
    reviver.memory = Math.max(0, reviver.memory - 8);
    this.emit("revive", { id: target.id, by: reviver.id });
    this.emit("toast", { text: `${target.name} снова дышит. Память −8.` });
  }

  damagePlayer(p, amount, source) {
    if (!p || p.downed || p.talking || p.invuln > 0) return;
    p.hp -= amount;
    p.invuln = 0.65;
    p.hitFlash = 0.18;
    if (p.channeling) this.cancelRevive(p);
    this.emit("playerHurt", { id: p.id, x: p.x, y: p.y, amount });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downTimer = this.players.size > 1 ? 12 : 3;
      p.talking = false;
      p.dialogue = null;
      p.channeling = false;
      p.reviveTargetId = null;
      this.emit("down", { id: p.id, x: p.x, y: p.y });
    }
  }

  respawn(p) {
    const spawn = this.findSpawn();
    p.x = spawn.x;
    p.y = spawn.y;
    p.hp = Math.ceil(p.maxHp * 0.55);
    p.memory = Math.ceil(p.maxMemory * 0.6);
    p.downed = false;
    p.downTimer = 0;
    p.invuln = 2.5;
    p.channeling = false;
    p.reviveTargetId = null;
    p.dialogue = null;
    p.talking = false;
    this.emit("respawn", { id: p.id, x: p.x, y: p.y });
  }

  damageEnemy(e, amount, player, opts = {}) {
    if (!e || e.hp <= 0) return;
    e.hp -= amount;
    e.hitFlash = 0.14;
    if (player) e.lastHitBy = player.id;
    if (!opts.silent) {
      this.emit("hit", { x: e.x, y: e.y - 12, amount: Math.round(amount), boss: e.boss, elite: e.elite });
    }
    if (e.hp <= 0) this.killEnemy(e, player);
  }

  killEnemy(e, player) {
    e.hp = 0;
    this.emit("enemyDied", { id: e.id, x: e.x, y: e.y, type: e.type, name: e.name, boss: e.boss, elite: e.elite });
    if (player) {
      player.kills++;
      const def = ENEMY_TYPES[e.type];
      this.addXp(player, def?.xp || 5);
      const shardAmount = e.boss ? 24 : e.elite ? 5 : 1 + (Math.random() < 0.35 ? 1 : 0);
      this.spawnPickup("shard", e.x + (Math.random() - 0.5) * 12, e.y + (Math.random() - 0.5) * 10, { value: shardAmount });
      if (Math.random() < (def?.memoryDrop || 0.08)) {
        this.spawnPickup("memory", e.x, e.y);
      } else if (Math.random() < 0.12) {
        this.spawnPickup("health", e.x, e.y);
      }
    }
    if (e.type === "barrow" && player) {
      this.flags.barrows = Math.min(3, (this.flags.barrows || 0) + 1);
      if (this.flags.barrows >= 3 && this.quest.side.barrows < 3) {
        this.quest.side.barrows = 2;
        this.emit("quest", {});
        this.emit("toast", { text: "Три курганных вернулись в землю. Ада ждёт." });
      }
    }
    if (e.type === "guardian") {
      this.flags.guardianDead = true;
      this.spawnPickup("ember", e.x, e.y, { kind: "peace", ttl: 0 });
    }
    if (e.boss) {
      this.flags.bossDead = true;
      this.quest.main.stage = Math.max(this.quest.main.stage, 4);
      this.spawnPickup("heart", e.x, e.y, { ttl: 0 });
      this.emit("bossDead", { x: e.x, y: e.y });
      this.emit("quest", {});
    }
    if (!e.fixed && !e.boss && e.zone) {
      this.respawnQueue.push({
        type: e.type,
        x: e.spawnX,
        y: e.spawnY,
        zone: e.zone,
        at: this.time + 18,
      });
    }
    const idx = this.enemies.indexOf(e);
    if (idx >= 0) this.enemies.splice(idx, 1);
  }

  addXp(p, xp) {
    p.xp += xp;
    let need = 40 + (p.level - 1) * 55;
    while (p.xp >= need) {
      p.xp -= need;
      p.level++;
      p.maxHp += 12;
      p.hp = Math.min(p.maxHp, p.hp + 24);
      p.maxMemory += 4;
      p.memory = Math.min(p.maxMemory, p.memory + 10);
      p.bonusDamage += 1;
      need = 40 + (p.level - 1) * 55;
      this.emit("levelUp", { id: p.id, level: p.level });
      this.emit("toast", { text: `${p.name}: уровень ${p.level}. Сила растёт, память тает.` });
    }
  }

  spawnProjectile(opts) {
    const p = {
      id: uid("p"),
      x: opts.x,
      y: opts.y,
      vx: opts.vx,
      vy: opts.vy,
      damage: opts.damage,
      team: opts.team,
      owner: opts.owner,
      type: opts.type || "arrow",
      radius: opts.radius || 5,
      ttl: opts.ttl || 2,
      pierce: !!opts.pierce,
      slow: opts.slow || 0,
      hitIds: opts.hitIds || new Set(),
      trail: [],
    };
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    for (const proj of [...this.projectiles]) {
      proj.ttl -= dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (proj.ttl <= 0) {
        this.removeProjectile(proj);
        continue;
      }
      if (this.map.isBlocked(proj.x, proj.y, 2)) {
        this.emit("projectileHit", { x: proj.x, y: proj.y, type: proj.type });
        this.removeProjectile(proj);
        continue;
      }
      if (proj.team === "player") {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (proj.hitIds && proj.hitIds.has(e.id)) continue;
          if (dist(proj.x, proj.y, e.x, e.y) < e.radius + proj.radius) {
            this.damageEnemy(e, proj.damage, this.players.get(proj.owner));
            if (proj.slow) e.slowTimer = Math.max(e.slowTimer, proj.slow);
            if (proj.pierce) proj.hitIds.add(e.id);
            else {
              this.removeProjectile(proj);
              break;
            }
          }
        }
      } else {
        for (const p of this.players.values()) {
          if (p.downed || p.talking) continue;
          if (dist(proj.x, proj.y, p.x, p.y) < p.radius + proj.radius) {
            this.damagePlayer(p, proj.damage, { id: proj.owner });
            this.removeProjectile(proj);
            break;
          }
        }
      }
    }
  }

  removeProjectile(p) {
    const i = this.projectiles.indexOf(p);
    if (i >= 0) this.projectiles.splice(i, 1);
  }

  spawnPickup(type, x, y, opts = {}) {
    const pickup = {
      id: uid("pick"),
      type,
      x,
      y,
      ttl: opts.ttl ?? (type === "heart" || type === "ember" ? 0 : 18),
      kind: opts.kind || null,
      value: opts.value || 0,
      born: this.time,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  updatePickups(dt) {
    for (const pick of [...this.pickups]) {
      if (pick.ttl > 0) {
        pick.ttl -= dt;
        if (pick.ttl <= 0) {
          this.pickups.splice(this.pickups.indexOf(pick), 1);
          continue;
        }
      }
      for (const p of this.players.values()) {
        if (p.downed) continue;
        if (dist(p.x, p.y, pick.x, pick.y) < 28) {
          this.collectPickup(p, pick);
          break;
        }
      }
    }
  }

  collectPickup(p, pick) {
    if (pick.type === "health") {
      p.hp = Math.min(p.maxHp, p.hp + 24);
      this.emit("toast", { text: "Тёплая кровь. Здоровье +24." });
    } else if (pick.type === "memory") {
      p.memory = Math.min(p.maxMemory, p.memory + 18);
      this.emit("toast", { text: "Обрывок памяти. Память +18." });
    } else if (pick.type === "shard") {
      const amount = pick.value || 1;
      p.shards = (p.shards || 0) + amount;
      this.emit("shards", { id: p.id, x: pick.x, y: pick.y - 10, amount });
    } else if (pick.type === "ember") {
      this.addEmber(pick.kind || "peace", p);
      this.emit("toast", { text: "Уголёк Покоя найден." });
    } else if (pick.type === "heart") {
      this.flags.hasHeart = true;
      this.quest.main.stage = Math.max(this.quest.main.stage, 5);
      this.emit("heart", { x: pick.x, y: pick.y });
      this.emit("quest", {});
      this.emit("toast", { text: "Сердце Мглы бьётся в твоей руке. Вернись к Ирме." });
    }
    const i = this.pickups.indexOf(pick);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  updateRespawns() {
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (this.time < r.at) continue;
      let near = false;
      for (const p of this.players.values()) {
        if (dist(p.x, p.y, r.x, r.y) < 180) near = true;
      }
      if (near) continue;
      this.respawnQueue.splice(i, 1);
      this.spawnEnemy(r.type, r.x, r.y, { zone: r.zone });
    }
  }

  hasLineOfSight(x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2);
    if (d < 1) return true;
    const steps = Math.ceil(d / 24);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.map.isBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2)) return false;
    }
    return true;
  }

  nearestEnemy(x, y, maxDist = 300) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.dormant) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  nearWorkbench(p) {
    const bench = this.map.props.find((prop) => prop.id === "workbench");
    return !!bench && dist(p.x, p.y, bench.x, bench.y) < 96;
  }

  upgradeWeapon(p, key) {
    const def = WEAPON_UPGRADES[key];
    if (!def) return;
    if (!this.nearWorkbench(p)) {
      this.emit("toast", { text: "Для прокачки нужен верстак у последнего очага." });
      return;
    }
    if (!p.weapon) p.weapon = { damage: 0, speed: 0, aim: 0, resonance: 0 };
    const level = p.weapon[key] || 0;
    if (level >= def.max) {
      this.emit("toast", { text: `${def.name}: уже предел.` });
      return;
    }
    const cost = def.costs[level];
    if ((p.shards || 0) < cost) {
      this.emit("toast", { text: `Нужно осколков: ${cost}. Сейчас ${p.shards || 0}.` });
      return;
    }
    p.shards -= cost;
    p.weapon[key] = level + 1;
    this.emit("upgrade", { id: p.id, key, level: level + 1, cost, name: def.name });
    this.emit("toast", { text: `${def.name} · уровень ${level + 1}. Осколков −${cost}.` });
  }

  questText() {
    const stage = this.quest.main.stage;
    const main = QUEST_MAIN.stages[stage] || "";
    const side = [];
    if (this.quest.side.hunter < 3) side.push(SIDE_QUESTS.hunter.stages[this.quest.side.hunter]);
    if (this.quest.side.name < 3) side.push(SIDE_QUESTS.name.stages[this.quest.side.name]);
    if (this.quest.side.merchant < 2) side.push(SIDE_QUESTS.merchant.stages[this.quest.side.merchant]);
    if ((this.quest.side.herbs || 1) < 3) side.push(SIDE_QUESTS.herbs.stages[this.quest.side.herbs || 1]);
    if ((this.quest.side.beacons || 1) < 3) side.push(SIDE_QUESTS.beacons.stages[this.quest.side.beacons || 1]);
    if ((this.quest.side.barrows || 1) < 3) side.push(SIDE_QUESTS.barrows.stages[this.quest.side.barrows || 1]);
    if ((this.quest.side.truth || 1) < 2) side.push(SIDE_QUESTS.truth.stages[this.quest.side.truth || 1]);
    return { main, side };
  }

  snapshot(forId = null) {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        cls: p.cls,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        memory: Math.round(p.memory),
        maxMemory: p.maxMemory,
        facing: Math.round(p.facing * 100) / 100,
        downed: p.downed,
        downTimer: Math.round(p.downTimer * 10) / 10,
        talking: p.talking,
        dialogue: forId == null || p.id === forId ? p.dialogueView || null : null,
        level: p.level,
        xp: p.xp,
        kills: p.kills,
        shards: p.shards || 0,
        weapon: { ...(p.weapon || { damage: 0, speed: 0, aim: 0, resonance: 0 }) },
        reviveTargetId: p.reviveTargetId,
        reviveProgress: p.channeling ? Math.round((p.reviveTimer / p.reviveDuration) * 100) / 100 : 0,
        channeling: p.channeling,
        attackAnim: p.attackAnim,
        hitFlash: p.hitFlash,
        dodge: p.dodgeTimer > 0,
        invuln: p.invuln > 0,
        abilityCd: Math.round(p.abilityCd * 10) / 10,
        dodgeCd: Math.round(p.dodgeCd * 10) / 10,
      });
    }
    return {
      t: Math.round(this.time * 1000) / 1000,
      players,
      enemies: this.enemies
        .filter((e) => !e.dormant)
        .map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
          x: Math.round(e.x * 10) / 10,
          y: Math.round(e.y * 10) / 10,
          hp: Math.round(e.hp),
          maxHp: e.maxHp,
          facing: Math.round(e.facing * 100) / 100,
          phase: e.phase,
          windup: Math.round(e.windup * 100) / 100,
          windupTotal: e.windupTime,
          boss: e.boss,
          elite: e.elite,
          active: e.active,
          hitFlash: e.hitFlash,
          stunned: e.stunTimer > 0,
        })),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        team: p.team,
        type: p.type,
        radius: p.radius,
      })),
      pickups: this.pickups.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, value: p.value || 0, kind: p.kind || null })),
      npcs: this.npcs.map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, color: n.color, cloak: n.cloak, alive: n.alive })),
      flags: {
        ...this.flags,
        emberKinds: { ...this.flags.emberKinds },
        herbCollected: { ...this.flags.herbCollected },
        beaconsLit: { ...this.flags.beaconsLit },
      },
      quest: { main: { ...this.quest.main }, side: { ...this.quest.side } },
      events: this.events.map((e) => ({ ...e })),
      boss: this.enemies.find((e) => e.boss && e.active)
        ? (() => {
            const b = this.enemies.find((e) => e.boss);
            return { x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, phase: b.phase };
          })()
        : null,
    };
  }

  serialize(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    return {
      version: 1,
      seed: this.seed,
      time: this.time,
      flags: {
        ...this.flags,
        emberKinds: { ...this.flags.emberKinds },
        herbCollected: { ...this.flags.herbCollected },
        beaconsLit: { ...this.flags.beaconsLit },
      },
      quest: { main: { ...this.quest.main }, side: { ...this.quest.side } },
      player: {
        id: p.id,
        name: p.name,
        cls: p.cls,
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        memory: p.memory,
        maxMemory: p.maxMemory,
        level: p.level,
        xp: p.xp,
        kills: p.kills,
        bonusDamage: p.bonusDamage,
        shards: p.shards || 0,
        weapon: { ...(p.weapon || { damage: 0, speed: 0, aim: 0, resonance: 0 }) },
      },
      savedAt: Date.now(),
    };
  }

  restoreSave(data, playerId = "host") {
    if (!data || data.version !== 1) return false;
    this.flags = {
      ...this.flags,
      ...data.flags,
      emberKinds: { ...this.flags.emberKinds, ...(data.flags?.emberKinds || {}) },
      herbCollected: { ...this.flags.herbCollected, ...(data.flags?.herbCollected || {}) },
      beaconsLit: { ...this.flags.beaconsLit, ...(data.flags?.beaconsLit || {}) },
    };
    this.quest = { main: { ...this.quest.main, ...(data.quest?.main || {}) }, side: { ...this.quest.side, ...(data.quest?.side || {}) } };
    this.map.setChapelOpen(!!this.flags.chapelOpen);
    if (this.flags.bossDead) {
      const boss = this.enemies.find((e) => e.boss);
      if (boss) this.enemies.splice(this.enemies.indexOf(boss), 1);
      if (!this.flags.hasHeart && !this.flags.ending) {
        this.spawnPickup("heart", 44 * TILE, 9 * TILE, { ttl: 0 });
      }
    }
    if (this.flags.guardianDead) {
      const g = this.enemies.find((e) => e.type === "guardian");
      if (g) this.enemies.splice(this.enemies.indexOf(g), 1);
      if (!this.flags.emberKinds.peace) {
        this.spawnPickup("ember", 44 * TILE, 49 * TILE, { kind: "peace", ttl: 0 });
      }
    }
    if (data.player) {
      const s = data.player;
      const p = this.addPlayer(playerId, s.name, s.cls, { x: s.x, y: s.y, restore: s });
      p.hp = clamp(s.hp ?? p.maxHp, 1, p.maxHp);
      p.memory = clamp(s.memory ?? p.maxMemory, 0, p.maxMemory);
      p.level = s.level || 1;
      p.xp = s.xp || 0;
      p.kills = s.kills || 0;
      p.bonusDamage = s.bonusDamage || 0;
      p.shards = s.shards || 0;
      p.weapon = { damage: 0, speed: 0, aim: 0, resonance: 0, ...(s.weapon || {}) };
      p.maxHp = s.maxHp || p.maxHp;
      p.maxMemory = s.maxMemory || p.maxMemory;
    }
    return true;
  }
}

function whisperText(p) {
  const lines = [
    `${p.name}... ты ещё помнишь, как тебя звали?`,
    "Не оглядывайся. За тобой идёт то, что ты забыл.",
    "Огонь голоден. Он всегда был голоден.",
    "Имя — это свеча. Не дай ей погаснуть.",
    "Мы все когда-то были кем-то.",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
