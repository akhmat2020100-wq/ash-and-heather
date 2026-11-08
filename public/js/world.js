/* Пепел и Вереск — симуляция мира v0.4 (общая для соло и хоста) */
import { createMap, TILE, tileCenter } from "./map.js";
import {
  CLASSES,
  ENEMY_TYPES,
  DIALOGUES,
  QUEST_MAIN,
  SIDE_QUESTS,
  SHOP_ITEMS,
  WEAPON_UPGRADES,
} from "./data.js";

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
const SPAWN_SAFE_DIST = 640;
// Врагов нельзя ставить ближе этого зазора за краем экрана: иначе они
// возникают ровно на кромке и видно, как они «хлопают» из воздуха.
const SPAWN_VIEW_MARGIN = 140;
const DEFAULT_VIEW = { w: 960, h: 600, zoom: 1 };
const EMPTY_WEAPON = () => ({ damage: 0, speed: 0, aim: 0, resonance: 0 });
const DAUGHTER_POS = {
  bed: tileCenter(50, 41.5),
  cage: tileCenter(177, 29),
  table: tileCenter(51.6, 51.3),
  door: tileCenter(53, 52.3),
};

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
    this.view = { ...DEFAULT_VIEW };
    this.respawnQueue = [];
    this.spawnCheckTimer = 0.4;
    this.bossSyncTimer = 1;
    this.storyCheckTimer = 0.25;
    this.npcs = this.map.npcs.map((n) => ({ ...n, alive: true }));

    // Карта процедурная: точка «на глаз» иногда попадает в скалу. Тогда
    // страж зоны никогда не спавнится, а отшельник недостижим.
    // Прижимаем такие точки к ближайшей проходимой земле.
    const snapToWalkable = (entity, radius = 12, search = 160) => {
      if (!this.map.isBlocked(entity.x, entity.y, radius)) return;
      for (let attempt = 1; attempt <= 8; attempt++) {
        const pos = this.map.randomWalkableNear(entity.x, entity.y, search * attempt);
        if (!this.map.isBlocked(pos.x, pos.y, radius)) {
          entity.x = pos.x;
          entity.y = pos.y;
          return;
        }
      }
    };
    for (const npc of this.npcs) snapToWalkable(npc, 12, 200);
    this.flags = {
      clues: { lantern: false, ribbon: false, tracks: false },
      cluesFound: 0,
      kidnapDone: false,
      bossActive: false,
      bossDead: false,
      daughterTucked: false,
      daughterState: "home",
      rescuer: null,
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
      millStory: false,
      millClue: false,
      herbCollected: {},
      beaconsLit: {},
      salt: false,
      bossIntroSeen: false,
    };
    this.quest = {
      main: { stage: 0 },
      side: { hunter: 1, name: 1, mill: 1, herbs: 1, beacons: 1, barrows: 1, truth: 1 },
    };
    this.daughter = {
      id: "daughter",
      name: "Лира",
      x: DAUGHTER_POS.bed.x,
      y: DAUGHTER_POS.bed.y,
      state: "home",
      facing: Math.PI / 2,
      radius: 7,
      visible: true,
      step: 0,
    };

    this.zones = this.map.spawns
      .filter((zone) => !zone.boss && !zone.fixed)
      .map((zone, i) => {
        const normalized = { ...zone };
        snapToWalkable(normalized, 20, 220);
        return {
          ...normalized,
          id: `zone_${i}`,
          alive: 0,
          pendingCount: zone.count,
          nextAt: 0,
        };
      });
    this.fixedSpawns = this.map.spawns.filter((zone) => zone.fixed && !zone.boss);
    this.bossZone = this.map.spawns.find((zone) => zone.boss) || null;
    this.boss = null;
    this.spawnBoss();
    for (const zone of this.fixedSpawns) {
      const enemy = this.spawnEnemy(zone.type, zone.x, zone.y, { zone, fixed: true, force: true });
      if (zone.type === "guardian" && enemy) enemy.elite = true;
    }
  }

  emit(type, data = {}) {
    // eid — порядковый номер события. Поле id принадлежит игроку/врагу,
    // и раньше оно затирало счётчик: события с id игрока обрабатывались
    // заново каждый кадр (верстак открывался бесконечно).
    const e = { eid: this.eventId++, type, time: this.time, ...data };
    this.events.push(e);
    if (this.events.length > 240) this.events.splice(0, this.events.length - 240);
    return e;
  }

  /* ---------- враги: появление только вне поля зрения ---------- */

  spawnBoss() {
    if (!this.bossZone) return null;
    const boss = this.spawnEnemy("boss", this.bossZone.x, this.bossZone.y, {
      fixed: true,
      boss: true,
      force: true,
      zone: this.bossZone,
    });
    if (boss) {
      boss.dormant = true;
      boss.active = false;
      boss.maxHp = ENEMY_TYPES.boss.hp;
      boss.hp = boss.maxHp;
      boss.damage = ENEMY_TYPES.boss.damage;
      this.boss = boss;
    }
    return boss;
  }

  // main.js кормит ворлд реальным размером канваса и зумом камеры, чтобы
  // зона «вне экрана» совпадала с тем, что игрок(и) действительно видят.
  setViewport(w, h, zoom) {
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    this.view.w = Math.max(240, w);
    this.view.h = Math.max(180, h);
    this.view.zoom = clamp(Number.isFinite(zoom) ? zoom : 1, 0.5, 3);
  }

  // Полуразмеры видимой области в мировых пикселях.
  viewHalf() {
    const zoom = this.view.zoom || 1;
    return {
      x: this.view.w / 2 / zoom + SPAWN_VIEW_MARGIN,
      y: this.view.h / 2 / zoom + SPAWN_VIEW_MARGIN,
    };
  }

  // Точка вне экрана у каждого игрока — иначе кто-то из кооп-братьев
  // увидит, как враг материализуется на кромке его кадра.
  outsideAllViews(x, y) {
    const half = this.viewHalf();
    for (const p of this.players.values()) {
      if (Math.abs(x - p.x) <= half.x && Math.abs(y - p.y) <= half.y) return false;
    }
    return true;
  }

  canSpawnAt(x, y, pad = 12) {
    if (this.map.isBlocked(x, y, pad)) return false;
    for (const p of this.players.values()) {
      if (dist(x, y, p.x, p.y) < SPAWN_SAFE_DIST) return false;
    }
    return this.outsideAllViews(x, y);
  }

  pickZonePoint(zone) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * zone.radius;
      const x = zone.x + Math.cos(a) * r;
      const y = zone.y + Math.sin(a) * r;
      if (this.canSpawnAt(x, y, 14)) return { x, y };
    }
    const fallback = this.map.randomWalkableNear(zone.x, zone.y, zone.radius);
    if (this.canSpawnAt(fallback.x, fallback.y, 14)) return fallback;
    return null;
  }

  updateSpawning(dt) {
    this.spawnCheckTimer -= dt;
    if (this.spawnCheckTimer > 0) return;
    this.spawnCheckTimer = 0.4;
    for (const zone of this.zones) {
      if (zone.pendingCount <= 0) continue;
      if (this.time < zone.nextAt) continue;
      const point = this.pickZonePoint(zone);
      // Если безопасного места нет — зона ждёт. Враги не появляются на глазах.
      if (!point) continue;
      const enemy = this.spawnEnemy(zone.type, point.x, point.y, { zone, force: true });
      if (!enemy) continue;
      zone.pendingCount--;
      zone.alive++;
    }
    this.updateRespawns();
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

  updateRespawns() {
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (this.time < r.at) continue;
      if (!this.canSpawnAt(r.x, r.y, 14)) continue;
      this.respawnQueue.splice(i, 1);
      const zone = this.zones.find((z) => z.id === r.zoneId) || r.zone || null;
      const enemy = this.spawnEnemy(r.type, r.x, r.y, { zone, force: true });
      if (enemy && zone) zone.alive++;
    }
  }

  /* ---------- игроки ---------- */

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
      baseMaxHp: def.hp,
      memory: 100,
      maxMemory: 100,
      speed: def.speed,
      facing: -Math.PI / 2,
      cooldown: 0,
      dodgeCd: 0,
      abilityCd: 0,
      interactCd: 0,
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
      coins: 0,
      weapon: EMPTY_WEAPON(),
      equipment: { weapon: null, armor: null },
      damageReduce: 0,
      shopOpen: false,
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
      player.dialogueView = null;
      player.talking = false;
      player.downed = false;
      player.reviveTargetId = null;
      player.channeling = false;
      player.shopOpen = false;
      player.input = { mx: 0, my: 0 };
      player.weapon = EMPTY_WEAPON();
      Object.assign(player.weapon, opts.restore.weapon || {});
      player.equipment = { weapon: null, armor: null, ...(opts.restore.equipment || {}) };
      player.coins = Math.max(0, opts.restore.coins || 0);
      player.maxHp = Math.max(1, opts.restore.maxHp || player.maxHp);
      player.hp = clamp(opts.restore.hp ?? player.maxHp, 1, player.maxHp);
      player.maxMemory = Math.max(1, opts.restore.maxMemory || player.maxMemory);
      player.memory = clamp(opts.restore.memory ?? player.maxMemory, 0, player.maxMemory);
      const armor = SHOP_ITEMS[player.equipment.armor];
      player.damageReduce = armor?.reduce || 0;
    }
    this.players.set(id, player);
    this.syncBossScaling();
    this.emit("playerJoin", { id, name: player.name, cls: player.cls, x: player.x, y: player.y });
    return player;
  }

  findSpawn(x, y) {
    if (x != null && y != null && !this.map.isBlocked(x, y, 12)) return { x, y };
    const home = [
      [50, 51.2],
      [49, 51.6],
      [51, 51.6],
      [47, 52.2],
      [55, 52.2],
    ];
    for (const [tx, ty] of home) {
      const pos = tileCenter(tx, ty);
      if (!this.map.isBlocked(pos.x, pos.y, 12)) return pos;
    }
    return this.map.randomWalkableNear(50 * TILE, 51 * TILE, 90);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.flags.rescuer === id) this.flags.rescuer = null;
    this.emit("playerLeave", { id, name: p.name });
    for (const other of this.players.values()) {
      if (other.reviveTargetId === id) {
        other.reviveTargetId = null;
        other.reviveTimer = 0;
        other.channeling = false;
      }
    }
    this.syncBossScaling();
  }

  setMove(id, mx, my) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.downed || p.talking || p.shopOpen) {
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

  syncBossScaling() {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return;
    const count = Math.max(1, this.players.size);
    const hpMul = 1 + 0.65 * (count - 1);
    const dmgMul = 1 + 0.2 * (count - 1);
    const targetMax = Math.round(ENEMY_TYPES.boss.hp * hpMul);
    const targetDamage = Math.round(ENEMY_TYPES.boss.damage * dmgMul);
    if (boss.maxHp !== targetMax) {
      const ratio = boss.hp / boss.maxHp;
      boss.maxHp = targetMax;
      boss.hp = boss.dormant ? targetMax : Math.max(1, Math.round(targetMax * ratio));
    }
    boss.damage = targetDamage;
  }

  /* ---------- действия и игровой цикл ---------- */

  advanceStage(stage, toast = "") {
    const current = this.quest.main.stage;
    if (stage <= current) return false;
    this.quest.main.stage = stage;
    this.emit("quest", { stage });
    this.emit("checkpoint", { stage, title: QUEST_MAIN.stages[stage] || "" });
    if (toast) this.emit("toast", { text: toast });
    return true;
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
    if (action === "closeShop") {
      p.shopOpen = false;
      this.emit("shopClose", { id: p.id });
      return;
    }
    if (p.downed) return;
    if (action === "buy") {
      this.buyItem(p, data.id);
      return;
    }
    if (p.talking || p.shopOpen) return;
    // Заслон от повторных action-сообщений (дребезг тача, дубли по сети).
    const actionGap = { attack: 0.04, dodge: 0.05, ability: 0.06, interact: 0.12 }[action];
    if (actionGap) {
      if (!p.actionAt) p.actionAt = {};
      const last = p.actionAt[action];
      if (last != null && this.time - last < actionGap && this.time >= last) return;
      p.actionAt[action] = this.time;
    }
    if (action === "upgrade") {
      this.upgradeWeapon(p, data.key);
      return;
    }
    if (action === "interact") {
      if (p.channeling) {
        this.cancelRevive(p);
        return;
      }
      if ((p.interactCd || 0) > 0) return;
      p.interactCd = 0.55;
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
      p.interactCd = Math.max(0, (p.interactCd || 0) - dt);
      p.invuln = Math.max(0, p.invuln - dt);
      p.attackAnim = Math.max(0, p.attackAnim - dt);
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.whisperTimer -= dt;
      if (p.hp > 0 && p.memory / p.maxMemory < 0.28 && p.whisperTimer <= 0) {
        p.whisperTimer = 8 + Math.random() * 4;
        this.emit("whisper", { id: p.id, text: whisperText(p) });
      }

      if (p.talking || p.shopOpen) {
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
        this.map.moveEntity(p, p.dodgeDir.x * p.speed * 3.1 * dt, p.dodgeDir.y * p.speed * 3.1 * dt);
        continue;
      }
      const mv = norm(p.input.mx, p.input.my);
      if (mv.x || mv.y) {
        this.map.moveEntity(p, mv.x * p.speed * dt, mv.y * p.speed * dt);
        p.lastMove = this.time;
        p.facing = Math.atan2(mv.y, mv.x);
      }
    }

    this.updateProjectiles(dt);
    for (const e of [...this.enemies]) this.updateEnemy(e, dt);
    this.updatePickups(dt);
    this.updateSpawning(dt);
    this.updateDaughter(dt);

    this.storyCheckTimer -= dt;
    if (this.storyCheckTimer <= 0) {
      this.storyCheckTimer = 0.25;
      this.updateStory();
    }
    this.bossSyncTimer -= dt;
    if (this.bossSyncTimer <= 0) {
      this.bossSyncTimer = 1;
      this.syncBossScaling();
    }

    if (this.events.length > 0) {
      const cutoff = this.time - 4;
      while (this.events.length && this.events[0].time < cutoff) this.events.shift();
    }
  }

  updateStory() {
    if (this.quest.main.stage === 5 && this.daughter.state === "following") {
      const daughterHome = this.map.inRegion("home", this.daughter.x, this.daughter.y);
      let playerHome = false;
      for (const p of this.players.values()) {
        if (!p.downed && this.map.inRegion("home", p.x, p.y)) playerHome = true;
      }
      if (daughterHome && playerHome) {
        this.daughter.state = "table";
        this.daughter.visible = true;
        this.flags.daughterState = "table";
        const pos = DAUGHTER_POS.table;
        this.daughter.x = pos.x;
        this.daughter.y = pos.y;
        this.advanceStage(6, "Дом принял её. Теперь накормите Лиру за столом.");
      }
    }
    if (this.quest.main.stage >= 6 && this.quest.main.stage < 7 && this.daughter.state === "cage") {
      this.daughter.state = "table";
      this.flags.daughterState = "table";
    }
    if (this.quest.main.stage >= 8 && this.flags.ending && !this.daughterTuckedEmit) {
      this.daughterTuckedEmit = true;
    }
  }

  updateDaughter(dt) {
    const d = this.daughter;
    if (!d) return;
    d.step += dt;
    if (this.quest.main.stage === 0) {
      d.state = "home";
      d.x = DAUGHTER_POS.bed.x;
      d.y = DAUGHTER_POS.bed.y;
      d.visible = true;
      this.flags.daughterState = "home";
      return;
    }
    if (d.state === "cage") {
      d.x = DAUGHTER_POS.cage.x;
      d.y = DAUGHTER_POS.cage.y;
      d.visible = this.quest.main.stage >= 4 || this.flags.bossDead;
      this.flags.daughterState = "cage";
      return;
    }
    if (d.state === "table") {
      d.x = DAUGHTER_POS.table.x;
      d.y = DAUGHTER_POS.table.y;
      d.visible = true;
      this.flags.daughterState = "table";
      return;
    }
    if (d.state === "bed") {
      d.x = DAUGHTER_POS.bed.x;
      d.y = DAUGHTER_POS.bed.y;
      d.visible = true;
      this.flags.daughterState = "bed";
      return;
    }
    if (d.state !== "following") return;
    d.visible = true;
    this.flags.daughterState = "following";
    let owner = this.players.get(this.flags.rescuer);
    if (!owner || owner.downed) owner = this.nearestPlayer(d.x, d.y, 1600, false);
    if (!owner) return;
    const distance = dist(d.x, d.y, owner.x, owner.y);
    if (distance < 48) return;
    const a = angleTo(d.x, d.y, owner.x, owner.y);
    d.facing = a;
    const speed = distance > 260 ? 160 : 104;
    const step = Math.min(distance - 40, speed * dt);
    if (step <= 0) return;
    const moved = this.map.moveEntity(d, Math.cos(a) * step, Math.sin(a) * step);
    if (!moved) {
      for (const off of [0.7, -0.7, 1.4, -1.4]) {
        if (this.map.moveEntity(d, Math.cos(a + off) * step, Math.sin(a + off) * step)) break;
      }
    }
    if (dist(d.x, d.y, owner.x, owner.y) > 1000) {
      d.x = owner.x;
      d.y = owner.y;
    }
  }

  /* ---------- Похититель ---------- */

  checkBossAwake(boss) {
    if (boss.active || this.quest.main.stage < 3) return;
    for (const p of this.players.values()) {
      if (p.downed) continue;
      if (this.map.inRegion("bossArena", p.x, p.y) || dist(p.x, p.y, boss.x, boss.y) < 460) {
        boss.active = true;
        boss.dormant = false;
        this.flags.bossActive = true;
        this.flags.bossIntroSeen = true;
        this.emit("bossIntro", { id: boss.id, x: boss.x, y: boss.y });
        return;
      }
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
    if (e.bleed > 0 && this.time % 0.5 < dt) this.damageEnemy(e, e.bleed, null, { silent: true });
    if (e.stunTimer > 0) return;

    if (e.boss) {
      this.updateBoss(e, dt);
      return;
    }

    const target = this.nearestPlayer(e.x, e.y, e.ranged ? 420 : 360, !e.boss);
    if (!target) {
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderTimer = 2 + Math.random() * 3;
        e.wanderDir = Math.random() * Math.PI * 2;
        e.state = "idle";
      }
      if (e.state === "idle" && dist(e.x, e.y, e.spawnX, e.spawnY) < 90) {
        this.enemyMove(e, Math.cos(e.wanderDir) * e.speed * 0.25 * dt, Math.sin(e.wanderDir) * e.speed * 0.25 * dt);
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
      if (e.type === "hound" && d > 18) {
        this.enemyMove(e, Math.cos(e.facing) * e.speed * 1.8 * dt, Math.sin(e.facing) * e.speed * 1.8 * dt);
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
        this.enemyMove(e, Math.cos(e.facing + Math.PI) * speed * dt, Math.sin(e.facing + Math.PI) * speed * dt);
      } else if (d > 245) {
        this.enemyMove(e, Math.cos(e.facing) * speed * dt, Math.sin(e.facing) * speed * dt);
      } else {
        this.enemyMove(e, Math.cos(e.facing + Math.PI / 2) * speed * 0.5 * dt, Math.sin(e.facing + Math.PI / 2) * speed * 0.5 * dt);
      }
    } else if (d > Math.max(10, e.attackRange - 6)) {
      this.enemyMove(e, Math.cos(e.facing) * speed * dt, Math.sin(e.facing) * speed * dt);
    }
    e.state = "chase";
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
        const radius = 130;
        for (const p of this.players.values()) {
          if (!p.downed && !p.talking && dist(boss.x, boss.y, p.x, p.y) < radius + p.radius) {
            this.damagePlayer(p, Math.round(boss.damage * 0.9 + (boss.phase - 1) * 3), boss);
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
          damage: Math.round(boss.damage * 0.45),
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
          this.spawnEnemy("hollow", boss.x + Math.cos(a) * 90, boss.y + Math.sin(a) * 90, { force: true });
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

  enemyMove(e, dx, dy) {
    const moved = this.map.moveEntity(e, dx, dy);
    if (!moved) {
      const base = Math.atan2(dy, dx);
      for (const off of [0.8, -0.8, 1.6, -1.6]) {
        const a = base + off;
        if (this.map.moveEntity(e, Math.cos(a) * Math.hypot(dx, dy), Math.sin(a) * Math.hypot(dx, dy))) return;
      }
    }
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

  /* ---------- бой и способности ---------- */

  weaponDamage(p) {
    const item = SHOP_ITEMS[p.equipment?.weapon];
    return item?.damage || 0;
  }

  tryAttack(p) {
    if (p.cooldown > 0 || p.downed || p.talking || p.channeling || p.shopOpen) return;
    const def = CLASSES[p.cls];
    const w = p.weapon || {};
    const aimMul = 1 + 0.1 * (w.aim || 0);
    const target = this.nearestEnemy(p.x, p.y, (def.ranged ? 380 : 210) * aimMul);
    if (target) p.facing = angleTo(p.x, p.y, target.x, target.y);
    p.cooldown = def.cooldown * Math.max(0.6, 1 - 0.08 * (w.speed || 0));
    p.attackAnim = 0.22;
    const dmg = Math.round(def.damage * (1 + 0.12 * (w.damage || 0))) + (p.level - 1) * 2 + p.bonusDamage + this.weaponDamage(p);

    if (def.ranged) {
      const a = p.facing;
      const origin = this.projectileOrigin(p, a, 16);
      this.spawnProjectile({
        x: origin.x,
        y: origin.y,
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
    const meleeRange = def.range * aimMul;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.dormant) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > meleeRange + e.radius) continue;
      const a = angleTo(p.x, p.y, e.x, e.y);
      if (Math.abs(angleDiff(a, p.facing)) > 0.95) continue;
      this.damageEnemy(e, dmg, p);
      hit++;
    }
    this.emit("slash", { owner: p.id, x: p.x, y: p.y, a: p.facing, range: meleeRange, cls: p.cls, hits: hit });
  }

  tryAbility(p) {
    const def = CLASSES[p.cls];
    const ab = def.ability;
    if (p.downed || p.talking || p.channeling || p.shopOpen) return;
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
    const gear = Math.round(this.weaponDamage(p) * 0.6);

    if (ab.id === "nova") {
      let hit = 0;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.dormant) continue;
        if (dist(p.x, p.y, e.x, e.y) <= ab.radius + e.radius) {
          this.damageEnemy(e, Math.round(ab.damage * abilityMul) + (p.level - 1) * 2 + gear, p);
          e.stunTimer = Math.max(e.stunTimer, ab.stun);
          hit++;
        }
      }
      this.emit("nova", { x: p.x, y: p.y, radius: ab.radius, hits: hit });
    } else if (ab.id === "pierce") {
      const origin = this.projectileOrigin(p, p.facing, 16);
      this.spawnProjectile({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(p.facing) * ab.speed,
        vy: Math.sin(p.facing) * ab.speed,
        damage: Math.round(ab.damage * abilityMul) + (p.level - 1) * 2 + gear,
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
        if (e.hp <= 0 || e.dormant) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > ab.radius + e.radius) continue;
        const a = angleTo(p.x, p.y, e.x, e.y);
        if (Math.abs(angleDiff(a, p.facing)) > ab.angle / 2) continue;
        this.damageEnemy(e, Math.round(ab.damage * abilityMul) + (p.level - 1) * 2 + gear, p);
        e.bleed = Math.max(e.bleed, ab.bleed);
        hit++;
      }
      this.emit("cone", { x: p.x, y: p.y, a: p.facing, radius: ab.radius, angle: ab.angle, hits: hit });
    }
    if (p.memory <= 0) this.emit("memoryEmpty", { id: p.id });
  }

  tryDodge(p) {
    if (p.dodgeCd > 0 || p.downed || p.talking || p.channeling || p.shopOpen) return;
    const def = CLASSES[p.cls];
    let dir = norm(p.input.mx, p.input.my);
    if (!dir.x && !dir.y) dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    p.dodgeDir = dir;
    p.dodgeTimer = 0.17;
    p.dodgeCd = def.dodgeCd;
    p.invuln = Math.max(p.invuln, 0.36);
    this.emit("dodge", { x: p.x, y: p.y, a: Math.atan2(dir.y, dir.x) });
  }

  /* ---------- взаимодействие ---------- */

  tryInteract(p) {
    if (p.downed || p.talking || p.channeling || p.shopOpen) return;
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
    let bestDist = 66;
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
      const reach = 60 + Math.min(34, (prop.r || Math.max(prop.w || 0, prop.h || 0) * 0.5) * 0.5);
      const d = dist(p.x, p.y, prop.x, prop.y);
      if (d < reach && d < bestDist + 8) {
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
        if (this.flags.herbs >= 3 && this.quest.side.herbs < 3) {
          this.quest.side.herbs = Math.max(this.quest.side.herbs, 2);
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
        if (this.flags.beacons >= 3 && this.quest.side.beacons < 3) {
          this.quest.side.beacons = Math.max(this.quest.side.beacons, 2);
          this.emit("quest", {});
          this.emit("toast", { text: "Три дыма поднялись над Морном. Гарм ждёт у перевоза." });
        }
      } else {
        this.emit("toast", { text: "Этот огонь уже горит." });
      }
    } else if (inter.kind === "clue") {
      this.collectClue(p, inter.key);
    } else if (inter.kind === "dialogue") {
      let node = "intro";
      if (inter.script === "nameTree" && this.flags.nameChoice) node = "done";
      this.startDialogue(p, inter.script, node);
    } else if (inter.kind === "bed") {
      const stage = this.quest.main.stage;
      if (stage === 0) this.startDialogue(p, "daughter", "intro");
      else if (stage >= 8) this.startDialogue(p, "daughter", "after");
      else if (stage >= 7) this.startDialogue(p, "tuck", "intro");
      else this.emit("toast", { text: "Постель пуста. Одеяло ещё хранит тепло." });
    } else if (inter.kind === "table") {
      if (this.quest.main.stage === 6) this.startDialogue(p, "feed", "intro");
      else if (this.quest.main.stage >= 7) this.emit("toast", { text: "Суп остыл. Лира уже наверху." });
      else this.emit("toast", { text: "На столе — пустая чашка и хлебные крошки." });
    } else if (inter.kind === "cage") {
      if (this.flags.bossDead && this.quest.main.stage === 4) this.startDialogue(p, "cage", "intro");
      else if (this.flags.bossDead) this.emit("toast", { text: "Клетка пуста. Замок сломан." });
      else this.startDialogue(p, "cage", "locked");
    }
  }

  collectClue(p, key) {
    if (!key || !(key in this.flags.clues)) return;
    if (this.quest.main.stage !== 1) {
      this.emit("toast", { text: this.quest.main.stage < 1 ? "Сначала что-то должно случиться." : "След уже прочитан." });
      return;
    }
    if (this.flags.clues[key]) {
      this.emit("toast", { text: "След уже прочитан." });
      return;
    }
    this.flags.clues[key] = true;
    this.flags.cluesFound = Object.values(this.flags.clues).filter(Boolean).length;
    const labels = { lantern: "Фонарь у крыльца", ribbon: "Серая лента у лавки", tracks: "Колея на северной дороге" };
    this.emit("clue", { id: p.id, key, count: this.flags.cluesFound, x: 0, y: 0 });
    this.emit("toast", { text: `${labels[key] || "След"}. Найдено ${this.flags.cluesFound}/3.` });
    if (this.flags.cluesFound >= 3) {
      this.advanceStage(2, "Три следа сходятся к Вересковой мельнице на западе.");
    }
  }

  getNpcNode(npc, p) {
    const stage = this.quest.main.stage;
    if (npc.dialogue === "irma") {
      if (this.flags.ending) return "done";
      if (stage === 0) return "intro";
      if (stage === 1) return "clues";
      if (stage === 2) return "mill";
      if (stage === 3) return "cave";
      if (stage === 4) return "rescued";
      if (stage < 8) return "home";
      return "done";
    }
    if (npc.dialogue === "hunter") return this.quest.side.hunter >= 2 ? "done" : "intro";
    if (npc.dialogue === "nameTree") return this.flags.nameChoice ? "done" : "intro";
    if (npc.dialogue === "merchant") return "intro";
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
    if (npc.dialogue === "hermit") return this.flags.truthKnown ? "done" : "intro";
    if (npc.dialogue === "miller") {
      if (stage === 2) return "daughter";
      if (stage >= 3) return "done";
      if (this.flags.millStory) return "done";
      return "intro";
    }
    return "intro";
  }

  /* ---------- диалоги ---------- */

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
      speaker: node.speaker || script.speaker,
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
    const next = typeof override === "string" ? override : choice.next || node.next || null;
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

  /* ---------- сюжетные действия ---------- */

  applyDialogueAction(p, action, choice) {
    switch (action) {
      case "kidnap": {
        if (this.quest.main.stage === 0) {
          this.flags.kidnapDone = true;
          this.daughter.state = "cage";
          this.daughter.visible = false;
          this.flags.daughterState = "cage";
          this.advanceStage(1, "Лира пропала. Начните с трёх следов: у дома, у лавки и на северной дороге.");
          this.emit("kidnap", { x: DAUGHTER_POS.bed.x, y: DAUGHTER_POS.bed.y });
        }
        return null;
      }
      case "rescueDaughter": {
        if (this.quest.main.stage === 4 && this.flags.bossDead) {
          this.flags.rescuer = p.id;
          this.daughter.state = "following";
          this.daughter.visible = true;
          this.flags.daughterState = "following";
          const pos = DAUGHTER_POS.cage;
          this.daughter.x = pos.x + TILE * 1.4;
          this.daughter.y = pos.y;
          this.advanceStage(5, "Лира идёт за тобой. Отведи её домой.");
          this.emit("daughterRescued", { id: p.id, x: this.daughter.x, y: this.daughter.y });
        }
        return null;
      }
      case "feedDaughter": {
        if (this.quest.main.stage === 6) {
          this.daughter.state = "bed";
          this.flags.daughterState = "bed";
          const pos = DAUGHTER_POS.bed;
          this.daughter.x = pos.x;
          this.daughter.y = pos.y;
          this.advanceStage(7, "Лира сыта. Отнесите её наверх и укройте одеялом.");
          this.emit("daughterFed", { id: p.id });
        }
        return null;
      }
      case "tuckIn": {
        if (this.quest.main.stage === 7) {
          this.flags.daughterTucked = true;
          this.daughter.state = "bed";
          this.daughter.visible = true;
          this.advanceStage(8, "Лира спит. Осталось погасить свечу.");
          this.emit("daughterAsleep", { x: this.daughter.x, y: this.daughter.y });
        }
        return null;
      }
      case "finishStory": {
        if (this.quest.main.stage >= 8 && !this.flags.ending) {
          const ending = this.players.size > 1 ? "brothers" : "home";
          this.flags.ending = ending;
          this.flags.pendingEnding = ending;
          this.emit("ending", { ending });
        }
        return null;
      }
      case "openShop": {
        p.shopOpen = true;
        this.emit("shop", { id: p.id, ...this.shopPayload(p) });
        return null;
      }
      case "hunterReward": {
        if (this.quest.side.hunter < 2) {
          this.quest.side.hunter = 3;
          this.grantCoins(p, 45, "Лук охотника");
          this.grantWeapon(p, "hunter_bow");
          this.emit("quest", {});
          this.emit("toast", { text: "Охотник отдал вересковый лук и 45 монет." });
        }
        return null;
      }
      case "nameTake": {
        if (!this.flags.nameChoice) {
          this.flags.nameChoice = "take";
          this.quest.side.name = 3;
          p.memory = Math.min(p.maxMemory, p.memory + 25);
          this.grantCoins(p, 55, "Чужое имя");
          this.emit("quest", {});
          this.emit("toast", { text: "Чужое имя согревает. Память +25, монеты +55." });
        }
        return null;
      }
      case "nameReturn": {
        if (!this.flags.nameChoice) {
          this.flags.nameChoice = "return";
          this.quest.side.name = 3;
          p.maxHp += 10;
          p.hp = Math.min(p.maxHp, p.hp + 10);
          p.memory = Math.max(0, p.memory - 15);
          this.grantCoins(p, 70, "Возвращённое имя");
          this.emit("quest", {});
          this.emit("toast", { text: "Имя вернулось в мир. Здоровье +10, монеты +70." });
        }
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
          p.maxHp += 12;
          p.hp = Math.min(p.maxHp, p.hp + 12);
          p.memory = Math.min(p.maxMemory, p.memory + 20);
          this.flags.salt = true;
          this.grantCoins(p, 60, "Соль Милы");
          this.emit("quest", {});
          this.emit("toast", { text: "Соль Милы. Здоровье +12, Память +20, монеты +60." });
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
          p.maxMemory += 8;
          p.memory = Math.min(p.maxMemory, p.memory + 16);
          this.grantCoins(p, 90, "Плата Гарма");
          this.emit("quest", {});
          this.emit("toast", { text: "Плата Гарма. Память +8, монеты +90." });
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
          p.maxHp += 10;
          p.hp = Math.min(p.maxHp, p.hp + 10);
          this.grantCoins(p, 75, "Монеты с курганов");
          this.emit("quest", {});
          this.emit("toast", { text: "Дар Ады. Здоровье +10, монеты +75." });
        }
        return null;
      }
      case "learnTruth": {
        if (!this.flags.truthKnown) {
          this.flags.truthKnown = true;
          this.flags.salt = true;
          this.quest.side.truth = 2;
          p.maxMemory += 10;
          p.memory = Math.min(p.maxMemory, p.memory + 20);
          this.emit("quest", {});
          this.emit("toast", { text: "Соль Каля с тобой. Память +10." });
        }
        return null;
      }
      case "millStory": {
        if (!this.flags.millStory) {
          this.flags.millStory = true;
          this.quest.side.mill = 2;
          p.memory = Math.min(p.maxMemory, p.memory + 8);
          this.emit("quest", {});
          this.emit("toast", { text: "Жернова помнят имена. Память +8." });
        }
        return null;
      }
      case "millClue": {
        if (!this.flags.millClue) {
          this.flags.millClue = true;
          if (this.quest.main.stage === 2) {
            this.advanceStage(3, "Мельник указал на Серые скалы. Похититель ждёт внутри.");
          } else {
            this.emit("toast", { text: "Серые скалы. Вход чёрный, как зрачок." });
          }
        }
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

  /* ---------- лавка и снаряжение ---------- */

  shopPayload(p) {
    const currentWeapon = SHOP_ITEMS[p.equipment?.weapon];
    const currentArmor = SHOP_ITEMS[p.equipment?.armor];
    return {
      coins: p.coins || 0,
      equipment: { ...(p.equipment || {}) },
      items: Object.values(SHOP_ITEMS).map((item) => {
        const current = item.kind === "weapon" ? currentWeapon : currentArmor;
        const equipped = p.equipment?.[item.kind] === item.id;
        const better = item.kind === "weapon"
          ? !current || item.damage > current.damage
          : !current || item.maxHp > current.maxHp;
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          desc: item.desc,
          price: item.price,
          glyph: item.glyph,
          damage: item.damage || 0,
          maxHp: item.maxHp || 0,
          reduce: item.reduce || 0,
          equipped,
          better,
          affordable: (p.coins || 0) >= item.price,
        };
      }),
    };
  }

  buyItem(p, itemId) {
    const item = SHOP_ITEMS[itemId];
    if (!item) return;
    if (!p.shopOpen) {
      this.emit("toast", { text: "Сначала поговори с Вороном." });
      return;
    }
    if (p.downed) return;
    if (p.equipment?.[item.kind] === item.id) {
      this.emit("toast", { text: "Эта вещь уже на тебе." });
      return;
    }
    const current = SHOP_ITEMS[p.equipment?.[item.kind]];
    if (current && (item.kind === "weapon" ? current.damage >= item.damage : current.maxHp >= item.maxHp)) {
      this.emit("toast", { text: "Это не лучше того, что уже есть. Ворон не любит менять хорошее на худое." });
      return;
    }
    if ((p.coins || 0) < item.price) {
      this.emit("toast", { text: `Нужно монет: ${item.price}. Сейчас ${p.coins || 0}.` });
      return;
    }
    p.coins -= item.price;
    if (item.kind === "weapon") {
      p.equipment = p.equipment || { weapon: null, armor: null };
      p.equipment.weapon = item.id;
    } else {
      p.equipment = p.equipment || { weapon: null, armor: null };
      p.equipment.armor = item.id;
      const delta = item.maxHp - (current?.maxHp || 0);
      p.maxHp += delta;
      p.hp = Math.min(p.maxHp, p.hp + Math.max(0, delta));
      p.damageReduce = item.reduce || 0;
    }
    this.emit("buy", { id: p.id, itemId: item.id, kind: item.kind, price: item.price, coins: p.coins });
    this.emit("shop", { id: p.id, ...this.shopPayload(p) });
    this.emit("toast", { text: `${item.name} куплено. Монет −${item.price}.` });
  }

  grantWeapon(p, itemId) {
    const item = SHOP_ITEMS[itemId];
    if (!item) return false;
    p.equipment = p.equipment || { weapon: null, armor: null };
    const current = SHOP_ITEMS[p.equipment.weapon];
    if (current && current.damage >= item.damage) return false;
    p.equipment.weapon = itemId;
    return true;
  }

  grantCoins(p, amount, reason = "") {
    const value = Math.max(0, Math.round(amount));
    if (!value) return;
    p.coins = (p.coins || 0) + value;
    this.emit("coins", { id: p.id, x: p.x, y: p.y - 18, amount: value, reason });
  }

  /* ---------- отдых, смерть, добыча ---------- */

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
    const reduced = Math.max(1, Math.round(amount * (1 - (p.damageReduce || 0))));
    p.hp -= reduced;
    p.invuln = 0.65;
    p.hitFlash = 0.18;
    if (p.channeling) this.cancelRevive(p);
    this.emit("playerHurt", { id: p.id, x: p.x, y: p.y, amount: reduced });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downTimer = this.players.size > 1 ? 12 : 3;
      p.talking = false;
      p.dialogue = null;
      p.shopOpen = false;
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
    p.shopOpen = false;
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
    const def = ENEMY_TYPES[e.type];
    this.emit("enemyDied", { id: e.id, x: e.x, y: e.y, type: e.type, name: e.name, boss: e.boss, elite: e.elite });
    if (player) {
      player.kills++;
      this.addXp(player, def?.xp || 5);
      const shardAmount = e.boss ? 24 : e.elite ? 5 : 1 + (Math.random() < 0.35 ? 1 : 0);
      this.spawnPickup("shard", e.x + (Math.random() - 0.5) * 12, e.y + (Math.random() - 0.5) * 10, { value: shardAmount });
      if (e.boss || Math.random() < (def?.coinDrop || 0)) {
        const value = def?.coinValue || (e.elite ? 10 : 1);
        this.spawnPickup("coin", e.x, e.y + 4, { value });
      }
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
    if (e.boss) {
      this.flags.bossDead = true;
      this.flags.bossActive = false;
      this.boss = null;
      this.emit("bossDead", { x: e.x, y: e.y });
      this.advanceStage(4, "Похититель повержен. Клетка Лиры открыта.");
      this.emit("toast", { text: "Замок клетки лопнул. Лира внутри." });
    }
    if (!e.fixed && !e.boss && e.zone && this.zones.includes(e.zone)) {
      const zone = e.zone;
      zone.alive = Math.max(0, (zone.alive || 0) - 1);
      zone.pendingCount = Math.min(zone.count, (zone.pendingCount || 0) + 1);
      zone.nextAt = this.time + 18;
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

  /* ---------- снаряды, добыча, сохранения ---------- */

  projectileOrigin(p, angle, distance) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let d = distance; d >= 3; d -= 2) {
      const x = p.x + cos * d;
      const y = p.y + sin * d;
      if (!this.map.isBlocked(x, y, 3)) return { x, y };
    }
    return { x: p.x, y: p.y };
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
          if (e.hp <= 0 || e.dormant) continue;
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
      ttl: opts.ttl ?? (type === "coin" ? 45 : 18),
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
          const i = this.pickups.indexOf(pick);
          if (i >= 0) this.pickups.splice(i, 1);
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
    } else if (pick.type === "coin") {
      const amount = pick.value || 1;
      p.coins = (p.coins || 0) + amount;
      this.emit("coins", { id: p.id, x: pick.x, y: pick.y - 10, amount });
    }
    const i = this.pickups.indexOf(pick);
    if (i >= 0) this.pickups.splice(i, 1);
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
    return this.map.props.some((prop) => prop.type === "workbench" && dist(p.x, p.y, prop.x, prop.y) < 100);
  }

  upgradeWeapon(p, key) {
    const def = WEAPON_UPGRADES[key];
    if (!def) return;
    if (!this.nearWorkbench(p)) {
      this.emit("toast", { text: "Для прокачки нужен верстак — дома или у последнего очага." });
      return;
    }
    if (!p.weapon) p.weapon = EMPTY_WEAPON();
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
    for (const key of ["hunter", "name", "mill", "herbs", "beacons", "barrows", "truth"]) {
      const quest = SIDE_QUESTS[key];
      const progress = this.quest.side[key] || 1;
      const text = quest?.stages?.[progress];
      if (text) side.push(text);
    }
    return { main, side };
  }

  daughterSnapshot() {
    const d = this.daughter;
    return {
      id: d.id,
      name: d.name,
      x: Math.round(d.x * 10) / 10,
      y: Math.round(d.y * 10) / 10,
      state: d.state,
      visible: !!d.visible,
      facing: Math.round(d.facing * 100) / 100,
      step: Math.round(d.step * 10) / 10,
      following: d.state === "following" ? this.flags.rescuer : null,
    };
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
        shopOpen: !!p.shopOpen,
        dialogue: forId == null || p.id === forId ? p.dialogueView || null : null,
        level: p.level,
        xp: p.xp,
        kills: p.kills,
        shards: p.shards || 0,
        coins: p.coins || 0,
        equipment: { ...(p.equipment || { weapon: null, armor: null }) },
        weapon: { ...(p.weapon || EMPTY_WEAPON()) },
        damageReduce: p.damageReduce || 0,
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
    const boss = this.enemies.find((e) => e.boss && e.active && e.hp > 0);
    const snap = {
      t: Math.round(this.time * 1000) / 1000,
      players,
      enemies: this.enemies
        .filter((e) => !e.dormant && e.hp > 0)
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
      daughter: this.daughterSnapshot(),
      flags: {
        ...this.flags,
        clues: { ...this.flags.clues },
        herbCollected: { ...this.flags.herbCollected },
        beaconsLit: { ...this.flags.beaconsLit },
      },
      quest: { main: { ...this.quest.main }, side: { ...this.quest.side } },
      questText: this.questText(),
      events: this.events.map((e) => ({ ...e })),
      boss: boss
        ? { id: boss.id, x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, phase: boss.phase }
        : null,
    };
    if (forId) {
      const me = this.players.get(forId);
      if (me?.shopOpen) snap.shop = this.shopPayload(me);
    }
    return snap;
  }

  serialize(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    return {
      version: 2,
      seed: this.seed,
      time: this.time,
      flags: {
        ...this.flags,
        clues: { ...this.flags.clues },
        herbCollected: { ...this.flags.herbCollected },
        beaconsLit: { ...this.flags.beaconsLit },
      },
      quest: { main: { ...this.quest.main }, side: { ...this.quest.side } },
      daughter: { ...this.daughter },
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
        coins: p.coins || 0,
        weapon: { ...(p.weapon || EMPTY_WEAPON()) },
        equipment: { ...(p.equipment || { weapon: null, armor: null }) },
        damageReduce: p.damageReduce || 0,
      },
      savedAt: Date.now(),
    };
  }

  restoreSave(data, playerId = "local") {
    if (!data || data.version !== 2) return false;
    this.flags = {
      ...this.flags,
      ...(data.flags || {}),
      clues: { ...this.flags.clues, ...(data.flags?.clues || {}) },
      herbCollected: { ...this.flags.herbCollected, ...(data.flags?.herbCollected || {}) },
      beaconsLit: { ...this.flags.beaconsLit, ...(data.flags?.beaconsLit || {}) },
    };
    this.quest = {
      main: { ...this.quest.main, ...(data.quest?.main || {}) },
      side: { ...this.quest.side, ...(data.quest?.side || {}) },
    };
    const stage = this.quest.main.stage;
    if (data.daughter && typeof data.daughter.state === "string") {
      this.daughter = { ...this.daughter, ...data.daughter };
    } else if (stage <= 0) {
      this.daughter.state = "home";
    } else if (stage >= 7) {
      this.daughter.state = "bed";
    } else if (stage >= 6) {
      this.daughter.state = "table";
    } else if (stage >= 5) {
      this.daughter.state = "following";
      this.flags.rescuer = playerId;
    } else {
      this.daughter.state = "cage";
    }
    this.flags.daughterState = this.daughter.state;
    if (stage >= 8) this.flags.daughterTucked = true;
    if (this.flags.bossDead) {
      if (this.boss) {
        const i = this.enemies.indexOf(this.boss);
        if (i >= 0) this.enemies.splice(i, 1);
      }
      this.boss = null;
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
      p.coins = s.coins || 0;
      p.weapon = { ...EMPTY_WEAPON(), ...(s.weapon || {}) };
      p.equipment = { weapon: null, armor: null, ...(s.equipment || {}) };
      p.maxHp = Math.max(1, s.maxHp || p.maxHp);
      p.maxMemory = Math.max(1, s.maxMemory || p.maxMemory);
      const armor = SHOP_ITEMS[p.equipment.armor];
      p.damageReduce = armor?.reduce || 0;
      if (this.map.isBlocked(p.x, p.y, 12)) {
        const spawn = this.findSpawn();
        p.x = spawn.x;
        p.y = spawn.y;
      }
    }
    this.syncBossScaling();
    return true;
  }
}

function whisperText(p) {
  const lines = [
    `${p.name}... ты ещё помнишь, как её звали?`,
    "Не оглядывайся. За тобой идёт то, что ты забыл.",
    "Серые забирают тех, кого перестают искать.",
    "Имя — это свеча. Не дай ей погаснуть.",
    "Лира считает шаги. Не заставляй её считать слишком долго.",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
