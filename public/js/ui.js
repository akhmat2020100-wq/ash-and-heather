/* Пепел и Вереск — DOM-интерфейс */
import { CLASSES, QUEST_MAIN, SIDE_QUESTS, ENDINGS, WEAPON_UPGRADES } from "./data.js";
import { T, TILE, MAP_W, MAP_H } from "./map.js";

const SIGILS = { lantern: "ᛟ", hunter: "ᚱ", executioner: "ᚦ" };

const MARKER_TYPES = {
  goal: { label: "Цель", color: "#ffd166" },
  danger: { label: "Опасность", color: "#ff7d6e" },
  loot: { label: "Добыча", color: "#9fe0a8" },
  home: { label: "Дом", color: "#8fc4ff" },
};

const MAP_TILE_COLORS = {
  [T.HEATHER]: "#2f3a33",
  [T.DIRT]: "#463b30",
  [T.STONE]: "#484b50",
  [T.WATER]: "#1f3441",
  [T.WALL]: "#3b342f",
  [T.TREE]: "#243028",
  [T.ROCK]: "#3b3938",
  [T.FLOOR]: "#3d3a42",
  [T.ASH]: "#3b3734",
  [T.BRIDGE]: "#54412d",
  [T.MOSS]: "#35472f",
};
const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ sound = () => {} } = {}) {
    this.sound = sound;
    this.mode = "solo";
    this.selectedClass = "lantern";
    this.dialogueSig = null;
    this.dialogueView = null;
    this.dialogueHandlers = { choose: () => {}, close: () => {} };
    this.typingTimer = null;
    this.typing = false;
    this.typingFull = "";
    this.settingsFrom = "menu";
    this.saveAvailable = false;
    this.partySig = "";
    this.abilitySig = "";
    this.lastClass = "lantern";
    this.mapOpen = false;
    this.workbenchOpen = false;
    this.mapScene = null;
    this.mapTiles = null;
    this.mapMarkers = [];
    this.markerType = "goal";
    this.mapDrawAt = 0;
    this.workbenchSig = "";
    this.onMap = () => {};
    this.onMarkerAdd = () => {};
    this.onMarkerRemove = () => {};
    this.onMarkersClear = () => {};
    this.onUpgrade = () => {};

    this.el = {
      menu: $("menu"), char: $("char"), hud: $("hud"), pause: $("pause"),
      settings: $("settings"), help: $("help"), end: $("end"), dialogue: $("dialogue"),
      boot: $("boot"), fade: $("fade"), rotate: $("rotate"), toasts: $("toasts"),
      classCards: $("class-cards"), charName: $("char-name"), joinField: $("join-field"),
      joinUrl: $("join-url"), btnStart: $("btn-start"), btnContinue: $("btn-continue"),
      charEyebrow: $("char-eyebrow"), charTitle: $("char-title"), charSubtitle: $("char-subtitle"),
      charNote: $("char-mode-note"), roomChip: $("room-chip"),
      playerName: $("hud-name"), level: $("hud-level"), sigil: $("hud-sigil"),
      hp: $("hud-hp"), hpText: $("hud-hp-text"), memory: $("hud-memory"), memoryText: $("hud-memory-text"),
      questMain: $("quest-main"), questSide: $("quest-side"),
      bossBar: $("boss-bar"), bossName: $("boss-name"), bossHp: $("boss-hp"),
      party: $("party"), hint: $("hint"), downed: $("downed"), downedText: $("downed-text"),
      downedBar: $("downed-bar"), pauseNote: $("pause-note"),
      dialogueSpeaker: $("dialogue-speaker"), dialogueText: $("dialogue-text"),
      dialogueChoices: $("dialogue-choices"), dialogueHint: $("dialogue-hint"),
      endTitle: $("end-title"), endText: $("end-text"), endStats: $("end-stats"),
      abilityBtn: $("btn-ability"), abilityCost: $("ability-cost"), abilityCd: $("ability-cd"),
      setMusic: $("set-music"), setMusicVal: $("set-music-val"),
      setSfx: $("set-sfx"), setSfxVal: $("set-sfx-val"),
      setReduce: $("set-reduce"), setHints: $("set-hints"),
      controls: $("controls"),
      shards: $("hud-shards"),
      xp: $("hud-xp"),
      minimap: $("minimap"),
      minimapCanvas: $("minimap-canvas"),
      mapScreen: $("map-screen"),
      mapCanvas: $("map-canvas"),
      mapMarkerList: $("map-marker-list"),
      mapMarkerCount: $("map-marker-count"),
      mapPalette: $("map-palette"),
      workbench: $("workbench"),
      workbenchShards: $("workbench-shards"),
      workbenchList: $("workbench-list"),
    };

    this.bindMenu();
    this.bindSettings();
    this.bindDialogueBox();
    this.bindMap();
    this.bindWorkbench();
    this.buildClassCards();
    this.applySettings({ music: 55, sfx: 75, reduce: false, hints: true });
  }

  /* ---------- меню ---------- */
  bindMenu() {
    const click = (id, fn) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("click", () => {
        this.sound("ui");
        fn();
      });
    };
    this.onSolo = () => {};
    this.onHost = () => {};
    this.onJoin = () => {};
    this.onCharStart = () => {};
    this.onCharBack = () => {};
    this.onPause = () => {};
    this.onMenu = () => {};
    this.onResume = () => {};
    this.onEndMenu = () => {};
    this.onOpenSettings = () => {};
    this.onSettingsChange = () => {};
    this.onFullscreen = () => {};

    click("btn-solo", () => this.onSolo());
    click("btn-host", () => this.onHost());
    click("btn-join", () => this.onJoin());
    click("btn-settings", () => this.openSettings("menu"));
    click("btn-continue", () => this.onContinue?.());
    click("btn-char-back", () => this.onCharBack());
    click("btn-start", () => this.onCharStart(this.getCharConfig()));
    click("btn-pause", () => this.onPause());
    click("btn-resume", () => this.onResume());
    click("btn-pause-settings", () => this.openSettings("pause"));
    click("btn-pause-menu", () => this.onMenu());
    click("btn-settings-close", () => this.closeSettings());
    click("btn-fullscreen", () => this.onFullscreen());
    click("btn-help", () => this.openHelp());
    click("btn-help-close", () => this.closeHelp());
    click("btn-end-menu", () => this.onEndMenu());

    this.el.charName?.addEventListener("input", () => {});
    this.el.joinUrl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.onCharStart(this.getCharConfig());
    });
  }

  /* ---------- карта и метки ---------- */
  bindMap() {
    if (this.el.minimapCanvas) {
      this.el.minimapCanvas.width = MAP_W * 2;
      this.el.minimapCanvas.height = MAP_H * 2;
    }
    if (this.el.mapCanvas) {
      this.el.mapCanvas.width = MAP_W * 4;
      this.el.mapCanvas.height = MAP_H * 4;
    }
    $("btn-map")?.addEventListener("click", () => {
      this.sound("ui");
      this.onMap();
    });
    this.el.minimap?.addEventListener("click", () => {
      this.sound("ui");
      this.onMap();
    });
    $("btn-map-close")?.addEventListener("click", () => {
      this.sound("ui");
      this.closeMap();
    });
    $("btn-map-clear")?.addEventListener("click", () => {
      this.sound("ui");
      this.onMarkersClear();
    });
    for (const type of Object.keys(MARKER_TYPES)) {
      $("btn-marker-" + type)?.addEventListener("click", () => {
        this.markerType = type;
        this.sound("choice");
        this.updateMarkerPalette();
      });
    }
    this.el.mapCanvas?.addEventListener("click", (e) => this.placeMarker(e));
    this.el.mapScreen?.addEventListener("click", (e) => {
      if (e.target === this.el.mapScreen) this.closeMap();
    });
    this.el.mapMarkerList?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-marker-index]");
      if (!btn) return;
      const index = Number(btn.getAttribute("data-marker-index"));
      if (Number.isFinite(index)) {
        this.sound("ui");
        this.onMarkerRemove(index);
      }
    });
    this.updateMarkerPalette();
  }

  updateMarkerPalette() {
    for (const type of Object.keys(MARKER_TYPES)) {
      $("btn-marker-" + type)?.classList.toggle("selected", type === this.markerType);
    }
  }

  placeMarker(e) {
    if (!this.mapTiles || !this.el.mapCanvas || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const canvas = this.el.mapCanvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Canvas растянут через object-fit: contain — учитываем поля по краям.
    const aspect = canvas.width / canvas.height;
    let cw = rect.width;
    let ch = rect.height;
    if (rect.width / rect.height > aspect) cw = rect.height * aspect;
    else ch = rect.width / aspect;
    const left = rect.left + (rect.width - cw) / 2;
    const top = rect.top + (rect.height - ch) / 2;
    if (e.clientX < left || e.clientX > left + cw || e.clientY < top || e.clientY > top + ch) return;
    const rx = Math.max(0, Math.min(1, (e.clientX - left) / cw));
    const ry = Math.max(0, Math.min(1, (e.clientY - top) / ch));
    const x = rx * MAP_W * TILE;
    const y = ry * MAP_H * TILE;
    const base = MARKER_TYPES[this.markerType]?.label || "Метка";
    let label = base;
    let best = 460;
    for (const lm of Object.values(this.mapScene?.landmarks || {})) {
      const d = Math.hypot(lm.x - x, lm.y - y);
      if (d < best) {
        best = d;
        label = `${base} · ${lm.label}`;
      }
    }
    this.onMarkerAdd({ x: Math.round(x), y: Math.round(y), type: this.markerType, label });
  }

  setMarkers(markers) {
    this.mapMarkers = Array.isArray(markers) ? markers.slice() : [];
    if (this.el.mapMarkerCount) this.el.mapMarkerCount.textContent = `${this.mapMarkers.length}/24`;
    const list = this.el.mapMarkerList;
    if (!list) return;
    if (!this.mapMarkers.length) {
      list.innerHTML = `<div class="map-empty">Пока ни одной метки. Выбери тип и коснись карты.</div>`;
      return;
    }
    list.innerHTML = this.mapMarkers
      .map((m, i) => {
        const color = MARKER_TYPES[m.type]?.color || MARKER_TYPES.goal.color;
        return `<div class="map-marker-row">
          <span class="mm-dot" style="--mm-color:${color}"></span>
          <span class="mm-label">${escapeHtml(m.label || "Метка")}</span>
          <span class="mm-coord">${Math.round(m.x / TILE)}, ${Math.round(m.y / TILE)}</span>
          <button type="button" class="mm-remove" data-marker-index="${i}" title="Убрать метку">×</button>
        </div>`;
      })
      .join("");
  }

  openMap() {
    this.mapOpen = true;
    this.el.mapScreen?.classList.remove("hidden");
    this.mapDrawAt = 0;
    this.updateMap(this.mapScene, this.mapTiles, this.mapMarkers, this.mapScene?.myId, true);
  }

  closeMap() {
    this.mapOpen = false;
    this.el.mapScreen?.classList.add("hidden");
  }

  isMapOpen() {
    return this.mapOpen;
  }

  updateMap(scene, tiles, markers, myId, force = false) {
    if (scene) this.mapScene = scene;
    if (tiles) this.mapTiles = tiles;
    if (Array.isArray(markers)) this.mapMarkers = markers;
    if (!this.mapTiles || !this.mapScene) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - this.mapDrawAt < 180) return;
    this.mapDrawAt = now;
    if (this.el.minimapCanvas) {
      this.drawMapCanvas(this.el.minimapCanvas, this.mapTiles, this.mapScene, this.mapMarkers, myId, false);
    }
    if (this.mapOpen && this.el.mapCanvas) {
      this.drawMapCanvas(this.el.mapCanvas, this.mapTiles, this.mapScene, this.mapMarkers, myId, true);
    }
  }

  drawMapCanvas(canvas, tiles, scene, markers, myId, big) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    if (!this.mapBackdrop || this.mapBackdropTiles !== tiles || this.mapBackdrop.width !== MAP_W || this.mapBackdrop.height !== MAP_H) {
      const bg = document.createElement("canvas");
      bg.width = MAP_W;
      bg.height = MAP_H;
      const bctx = bg.getContext("2d");
      if (bctx) {
        for (let ty = 0; ty < MAP_H; ty++) {
          for (let tx = 0; tx < MAP_W; tx++) {
            bctx.fillStyle = MAP_TILE_COLORS[tiles[ty * MAP_W + tx]] || MAP_TILE_COLORS[T.HEATHER];
            bctx.fillRect(tx, ty, 1, 1);
          }
        }
      }
      this.mapBackdrop = bg;
      this.mapBackdropTiles = tiles;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapBackdrop, 0, 0, w, h);
    const sx = w / (MAP_W * TILE);
    const sy = h / (MAP_H * TILE);
    const px = (x) => x * sx;
    const py = (y) => y * sy;

    // landmarks and detail dots — only on the big map, чтобы мини-карта не рябила
    if (big) {
      for (const [key, lm] of Object.entries(scene.landmarks || {})) {
        if (!lm || !Number.isFinite(lm.x)) continue;
        const x = px(lm.x);
        const y = py(lm.y);
        ctx.fillStyle = "rgba(232,165,75,0.85)";
        ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
        const label = lm.label || key;
        ctx.font = "11px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(230,220,200,0.62)";
        ctx.fillText(label, x, y - 5);
      }

      // NPC
      for (const npc of scene.npcs || []) {
        if (!npc.alive) continue;
        ctx.fillStyle = "#c9b27a";
        ctx.beginPath();
        ctx.arc(px(npc.x), py(npc.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // enemies
      for (const e of scene.enemies || []) {
        if (e.hp <= 0 || e.dormant) continue;
        const x = px(e.x);
        const y = py(e.y);
        ctx.fillStyle = e.boss ? "#ffb0a0" : "rgba(200,90,80,0.9)";
        ctx.beginPath();
        ctx.arc(x, y, e.boss ? 5 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // только главные ориентиры
      for (const key of ["irma", "workbench", "chapel"]) {
        const lm = scene.landmarks?.[key];
        if (!lm || !Number.isFinite(lm.x)) continue;
        ctx.fillStyle = "rgba(232,165,75,0.7)";
        ctx.beginPath();
        ctx.arc(px(lm.x), py(lm.y), 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // markers
    for (const m of markers || []) {
      const color = MARKER_TYPES[m.type]?.color || MARKER_TYPES.goal.color;
      const x = px(m.x);
      const y = py(m.y);
      const r = big ? 6 : 3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(12,15,20,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // players last
    for (const p of scene.players || []) {
      if (p.downed) continue;
      const def = CLASSES[p.cls] || CLASSES.lantern;
      const x = px(p.x);
      const y = py(p.y);
      ctx.fillStyle = p.id === myId ? "#fff4d8" : def.color;
      ctx.beginPath();
      ctx.arc(x, y, p.id === myId ? (big ? 5 : 2.4) : (big ? 4 : 2), 0, Math.PI * 2);
      ctx.fill();
      if (p.id === myId) {
        ctx.strokeStyle = "rgba(255,209,138,0.55)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, big ? 9 : 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (big) {
      ctx.strokeStyle = "rgba(232,165,75,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    } else {
      const vign = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.62);
      vign.addColorStop(0, "rgba(0,0,0,0)");
      vign.addColorStop(1, "rgba(6,8,12,0.42)");
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, w, h);
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(230,220,200,0.55)";
      ctx.fillText("С", w - 9, 16);
    }
  }

  /* ---------- верстак ---------- */
  bindWorkbench() {
    $("btn-workbench-close")?.addEventListener("click", () => {
      this.sound("ui");
      this.closeWorkbench();
    });
    $("btn-workbench-done")?.addEventListener("click", () => {
      this.sound("ui");
      this.closeWorkbench();
    });
    this.el.workbench?.addEventListener("click", (e) => {
      if (e.target === this.el.workbench) this.closeWorkbench();
    });
    this.el.workbenchList?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-upgrade-key]");
      if (!btn || btn.disabled) return;
      this.sound("choice");
      this.onUpgrade(btn.getAttribute("data-upgrade-key"));
    });
  }

  openWorkbench(player) {
    this.workbenchOpen = true;
    this.workbenchSig = "";
    this.el.workbench?.classList.remove("hidden");
    this.renderWorkbench(player || this.workbenchPlayer);
  }

  closeWorkbench() {
    this.workbenchOpen = false;
    this.el.workbench?.classList.add("hidden");
  }

  isWorkbenchOpen() {
    return this.workbenchOpen;
  }

  updateWorkbench(player) {
    if (!this.workbenchOpen) return;
    this.renderWorkbench(player || this.workbenchPlayer);
  }

  renderWorkbench(player) {
    if (!this.el.workbenchList) return;
    const shards = player?.shards || 0;
    const weapon = player?.weapon || {};
    const sig = `${shards}:${Object.keys(WEAPON_UPGRADES).map((k) => weapon[k] || 0).join(",")}`;
    if (sig === this.workbenchSig) return;
    this.workbenchSig = sig;
    this.workbenchPlayer = player;
    if (this.el.workbenchShards) this.el.workbenchShards.textContent = String(shards);
    this.el.workbenchList.innerHTML = Object.entries(WEAPON_UPGRADES)
      .map(([key, def]) => {
        const level = weapon[key] || 0;
        const maxed = level >= def.max;
        const cost = maxed ? 0 : def.costs[level];
        const afford = shards >= cost;
        const pips = Array.from({ length: def.max }, (_, i) => `<span class="upg-pip ${i < level ? "on" : ""}"></span>`).join("");
        return `<div class="upg-row ${maxed ? "maxed" : ""}">
          <div class="upg-main">
            <div class="upg-title"><span>${escapeHtml(def.name)}</span><span class="upg-level">${level}/${def.max}</span></div>
            <div class="upg-desc">${escapeHtml(def.desc)}</div>
            <div class="upg-pips">${pips}</div>
          </div>
          <button type="button" class="btn upg-buy" data-upgrade-key="${key}" ${maxed || !afford ? "disabled" : ""}>
            ${maxed ? "Предел" : `<span class="shard-glyph">◆</span> ${cost}`}
          </button>
        </div>`;
      })
      .join("");
  }


  openChar(mode) {
    this.mode = mode;
    this.el.menu.classList.add("hidden");
    this.el.char.classList.remove("hidden");
    this.el.joinField.classList.toggle("hidden", mode !== "join");
    this.el.btnStart.textContent = mode === "join" ? "Присоединиться" : mode === "host" ? "Создать и открыть" : "Войти в туман";
    if (mode === "solo") {
      this.el.charEyebrow.textContent = "перед входом в туман";
      this.el.charTitle.textContent = "Кто ты, Искра?";
      this.el.charSubtitle.textContent = "Имя — последнее, что у тебя есть. Выбери, каким ты войдёшь в туман.";
      this.el.charNote.textContent = "Один в тумане. Мир будет ждать только тебя.";
    } else if (mode === "host") {
      this.el.charEyebrow.textContent = "ты зажигаешь огонь";
      this.el.charTitle.textContent = "Кто будет ждать у костра?";
      this.el.charSubtitle.textContent = "Друзья подключатся к твоей игре по WiFi. Ты станешь хостом этого мира.";
      this.el.charNote.textContent = "После входа покажи друзьям адрес из комнаты.";
    } else {
      this.el.charEyebrow.textContent = "ты идёшь на чужой свет";
      this.el.charTitle.textContent = "Кто ты, гость тумана?";
      this.el.charSubtitle.textContent = "Введи адрес хоста. Он должен быть в той же сети WiFi.";
      this.el.charNote.textContent = "Хост уже должен создать игру.";
      if (!this.el.joinUrl.value && !window.AshNative?.isEmbedded?.()) {
        const host = location.hostname && location.protocol.startsWith("http") ? location.host : "";
        this.el.joinUrl.value = host ? `ws://${host}/ws` : "";
      }
    }
    this.showScreen(this.el.char);
  }

  getCharConfig() {
    const name = (this.el.charName?.value || "Странник").trim().slice(0, 24) || "Странник";
    const cls = this.selectedClass;
    const joinUrl = (this.el.joinUrl?.value || "").trim();
    return { name, cls, joinUrl };
  }

  buildClassCards() {
    if (!this.el.classCards) return;
    this.el.classCards.innerHTML = "";
    for (const def of Object.values(CLASSES)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "class-card" + (def.id === this.selectedClass ? " selected" : "");
      card.dataset.cls = def.id;
      card.style.setProperty("--card-color", def.color);
      card.innerHTML = `
        <span class="card-sigil">${SIGILS[def.id] || "ᚨ"}</span>
        <span class="card-name">${def.name}</span>
        <span class="card-epithet">${def.epithet}</span>
        <span class="card-desc">${def.lore}</span>
        <span class="card-stats">
          <span>Здоровье <b>${def.hp}</b></span>
          <span>Урон <b>${def.damage}</b></span>
          <span>Скорость <b>${def.speed}</b></span>
        </span>`;
      card.addEventListener("click", () => {
        this.sound("choice");
        this.selectedClass = def.id;
        for (const c of this.el.classCards.children) c.classList.toggle("selected", c === card);
      });
      this.el.classCards.appendChild(card);
    }
  }

  setContinueAvailable(v) {
    this.saveAvailable = !!v;
    this.el.btnContinue?.classList.toggle("hidden", !v);
  }

  showMenu() {
    this.hideAllScreens();
    this.closeMap();
    this.closeWorkbench();
    this.el.menu.classList.remove("hidden");
    this.showHud(false);
    this.hideDialogue();
    this.el.controls?.classList.add("hidden");
    this.el.boot?.classList.add("done");
    this.updateRotate(false);
  }

  showChar() {
    this.hideAllScreens();
    this.el.char.classList.remove("hidden");
  }

  showGame() {
    this.hideAllScreens();
    this.closeMap();
    this.closeWorkbench();
    this.el.hud.classList.remove("hidden");
    this.el.controls?.classList.remove("hidden");
    this.showHud(true);
  }

  hideAllScreens() {
    for (const key of ["menu", "char", "pause", "settings", "help", "end"]) {
      this.el[key]?.classList.add("hidden");
    }
    this.el.dialogue?.classList.add("hidden");
  }

  showScreen(el) {
    for (const key of ["menu", "char", "pause", "settings", "help", "end"]) {
      if (this.el[key] === el) this.el[key].classList.remove("hidden");
      else this.el[key]?.classList.add("hidden");
    }
  }

  showHud(v) {
    this.el.hud?.classList.toggle("hidden", !v);
    if (!v) {
      this.el.dialogue?.classList.add("hidden");
      this.el.bossBar?.classList.add("hidden");
      this.el.downed?.classList.add("hidden");
    }
  }

  /* ---------- HUD ---------- */
  updateHud(scene, myId) {
    const me = scene.players?.find((p) => p.id === myId) || scene.players?.[0];
    if (!me) return;
    const def = CLASSES[me.cls] || CLASSES.lantern;
    if (this.el.playerName && this.el.playerName.textContent !== me.name) this.el.playerName.textContent = me.name;
    if (this.el.level) this.el.level.textContent = `ур. ${me.level || 1}`;
    if (this.el.xp) {
      const need = 40 + ((me.level || 1) - 1) * 55;
      const text = `${Math.round(me.xp || 0)}/${need}`;
      if (this.el.xp.textContent !== text) this.el.xp.textContent = text;
    }
    if (this.lastClass !== me.cls) {
      this.lastClass = me.cls;
      this.el.sigil.textContent = SIGILS[me.cls] || "ᚨ";
      this.el.sigil.style.setProperty("--sigil-color", def.color);
      this.el.abilityCost.textContent = String(def.ability.cost);
      this.el.abilityBtn?.setAttribute("title", def.ability.name);
    }
    const hpPct = Math.max(0, Math.min(1, me.hp / me.maxHp));
    const memPct = Math.max(0, Math.min(1, me.memory / me.maxMemory));
    if (this.el.hp) this.el.hp.style.width = `${hpPct * 100}%`;
    if (this.el.hpText) this.el.hpText.textContent = `${Math.ceil(me.hp)} / ${me.maxHp}`;
    if (this.el.memory) this.el.memory.style.width = `${memPct * 100}%`;
    if (this.el.memoryText) this.el.memoryText.textContent = `память ${Math.ceil(me.memory)}`;
    if (this.el.shards && this.el.shards.textContent !== String(me.shards || 0)) {
      this.el.shards.textContent = String(me.shards || 0);
    }
    this.updateAbility(me, def);
    this.updateParty(scene, myId);
    this.updateQuest(scene);
    this.updateBoss(scene);
    this.updateDowned(scene, me);
  }

  updateAbility(me, def) {
    const cd = me.abilityCd || 0;
    const sig = `${Math.ceil(cd * 10)}:${me.memory}`;
    if (sig === this.abilitySig) return;
    this.abilitySig = sig;
    if (this.el.abilityBtn) {
      this.el.abilityBtn.classList.toggle("on-cooldown", cd > 0.05);
      this.el.abilityBtn.classList.toggle("ready", cd <= 0.05 && me.memory >= def.ability.cost);
    }
    if (this.el.abilityCd) this.el.abilityCd.textContent = cd > 0.05 ? String(Math.ceil(cd)) : "";
  }

  updateQuest(scene) {
    const quest = scene.quest;
    if (!quest) return;
    let main = QUEST_MAIN.stages[quest.main?.stage] || "";
    if (quest.main?.stage === 2 && scene.flags?.riteStarted) {
      if (scene.flags?.riteReady) {
        main = "Вернуться к двери часовни и назвать три имени.";
      } else {
        const names = scene.flags.riteNames || {};
        const count = Object.values(names).filter(Boolean).length;
        main = `Собрать три имени для часовни: Мила, Гарм, Ада (${count}/3).`;
      }
    }
    if (this.el.questMain && this.el.questMain.textContent !== main) this.el.questMain.textContent = main;
    const side = [];
    const pushStage = (key, done) => {
      const stage = quest.side?.[key] ?? 1;
      if (done(stage) || !SIDE_QUESTS[key]?.stages[stage]) return;
      side.push(SIDE_QUESTS[key].stages[stage]);
    };
    pushStage("hunter", (s) => s >= 3);
    pushStage("name", (s) => s >= 3);
    pushStage("merchant", (s) => s >= 2);
    pushStage("herbs", (s) => s >= 3);
    pushStage("beacons", (s) => s >= 3);
    pushStage("barrows", (s) => s >= 3);
    pushStage("truth", (s) => s >= 2);
    const me = scene.players?.find((p) => p.id === scene.myId) || scene.players?.[0];
    const hasUpgrade = me && Object.values(me.weapon || {}).some((v) => v > 0);
    if (me && (me.shards || 0) > 0 && !hasUpgrade) {
      side.unshift(`◆ ${me.shards}: улучшить оружие на верстаке у последнего очага.`);
    }
    const sig = side.join("|");
    if (this.el.questSide && this.questSideSig !== sig) {
      this.questSideSig = sig;
      this.el.questSide.innerHTML = side.map((s) => `<div>${s}</div>`).join("");
    }
  }

  updateBoss(scene) {
    if (!this.el.bossBar) return;
    const boss = scene.boss;
    if (boss && boss.hp > 0) {
      this.el.bossBar.classList.remove("hidden");
      if (this.el.bossHp) this.el.bossHp.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
      if (this.el.bossName) {
        const suffix = boss.phase >= 3 ? " · ярость" : boss.phase === 2 ? " · слёзы" : "";
        this.el.bossName.textContent = "Плакальщик" + suffix;
      }
    } else {
      this.el.bossBar.classList.add("hidden");
    }
  }

  updateParty(scene, myId) {
    if (!this.el.party) return;
    const others = (scene.players || []).filter((p) => p.id !== myId);
    const sig = others.map((p) => `${p.id}:${p.name}:${Math.ceil(p.hp)}:${p.downed}`).join("|");
    if (sig === this.partySig) return;
    this.partySig = sig;
    this.el.party.innerHTML = others
      .map((p) => {
        const def = CLASSES[p.cls] || CLASSES.lantern;
        return `<div class="party-member ${p.downed ? "downed" : ""}" style="--pm-color:${def.color}">
          <span class="pm-dot"></span>
          <span class="pm-name">${escapeHtml(p.name)}</span>
          <span class="pm-hp">${p.downed ? "пал" : `${Math.ceil(p.hp)}`}</span>
        </div>`;
      })
      .join("");
  }

  updateDowned(scene, me) {
    if (!this.el.downed) return;
    if (me?.downed) {
      this.el.downed.classList.remove("hidden");
      const coOp = (scene.players?.length || 1) > 1;
      const max = coOp ? 12 : 3;
      const left = Math.max(0, me.downTimer || 0);
      if (this.el.downedText) {
        this.el.downedText.textContent = coOp ? `Ждёшь помощи · ${left.toFixed(1)} с` : "Огонь вернёт тебя...";
      }
      if (this.el.downedBar) this.el.downedBar.style.width = `${Math.max(0, Math.min(1, left / max)) * 100}%`;
    } else {
      this.el.downed.classList.add("hidden");
    }
  }

  setHint(text) {
    if (!this.el.hint) return;
    if (!text) {
      this.el.hint.classList.remove("show");
      return;
    }
    if (this.el.hint.textContent !== text) this.el.hint.textContent = text;
    this.el.hint.classList.add("show");
  }

  setRoomChip(text, show = true) {
    if (!this.el.roomChip) return;
    this.el.roomChip.textContent = text || "";
    this.el.roomChip.classList.toggle("show", !!text && show);
  }

  /* ---------- диалог ---------- */
  bindDialogueBox() {
    this.el.dialogue?.addEventListener("click", (e) => {
      if (e.target.closest(".choice")) return;
      if (this.typing) {
        this.finishTyping();
      } else if (!this.dialogueView?.choices?.length) {
        this.dialogueHandlers.close();
      }
    });
  }

  renderDialogue(view, handlers) {
    if (!view) {
      this.hideDialogue();
      return;
    }
    this.dialogueHandlers = handlers || this.dialogueHandlers;
    const sig = `${view.scriptId}:${view.nodeId}`;
    if (sig === this.dialogueSig) return;
    this.dialogueSig = sig;
    this.dialogueView = view;
    this.el.dialogue.classList.remove("hidden");
    this.el.dialogueSpeaker.textContent = view.speaker || "";
    this.el.dialogueChoices.innerHTML = "";
    this.el.dialogueHint.textContent = "";
    this.startTyping(view.text || "");
  }

  startTyping(text) {
    clearInterval(this.typingTimer);
    this.typingFull = text;
    this.typing = true;
    this.el.dialogueText.textContent = "";
    let i = 0;
    this.el.dialogueHint.textContent = "нажми, чтобы пропустить";
    this.typingTimer = setInterval(() => {
      i += 1;
      this.el.dialogueText.textContent = text.slice(0, i);
      if (i >= text.length) this.finishTyping();
    }, 16);
  }

  finishTyping() {
    clearInterval(this.typingTimer);
    this.typingTimer = null;
    this.typing = false;
    this.el.dialogueText.textContent = this.typingFull;
    this.renderChoices();
  }

  renderChoices() {
    const view = this.dialogueView;
    if (!view) return;
    this.el.dialogueChoices.innerHTML = "";
    const choices = view.choices || [];
    if (choices.length) {
      this.el.dialogueHint.textContent = "выбери ответ · клавиши 1–4";
      choices.forEach((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.textContent = c.label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.sound("choice");
          this.dialogueHandlers.choose(i);
        });
        this.el.dialogueChoices.appendChild(b);
      });
    } else {
      this.el.dialogueHint.textContent = "нажми, чтобы продолжить";
    }
  }

  chooseDialogue(index) {
    if (this.typing) {
      this.finishTyping();
      return true;
    }
    if (this.dialogueView?.choices?.[index]) {
      this.sound("choice");
      this.dialogueHandlers.choose(index);
      return true;
    }
    return false;
  }

  hideDialogue() {
    clearInterval(this.typingTimer);
    this.typingTimer = null;
    this.typing = false;
    this.dialogueSig = null;
    this.dialogueView = null;
    this.el.dialogue?.classList.add("hidden");
    this.el.dialogueChoices && (this.el.dialogueChoices.innerHTML = "");
  }

  isDialogueOpen() {
    return !!this.dialogueView;
  }

  /* ---------- тосты ---------- */
  toast(text) {
    if (!this.el.toasts || !text) return;
    while (this.el.toasts.children.length >= 4) this.el.toasts.firstChild.remove();
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = text;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.classList.add("fade"), 3600);
    setTimeout(() => div.remove(), 4200);
  }

  /* ---------- пауза ---------- */
  showPause(note, canResume = true) {
    this.el.pause?.classList.remove("hidden");
    if (this.el.pauseNote && note) this.el.pauseNote.textContent = note;
    const btn = $("btn-resume");
    if (btn) btn.style.display = canResume ? "" : "none";
  }

  hidePause() {
    this.el.pause?.classList.add("hidden");
  }

  /* ---------- настройки ---------- */
  bindSettings() {
    const update = () => {
      const music = Number(this.el.setMusic.value);
      const sfx = Number(this.el.setSfx.value);
      const reduce = !!this.el.setReduce.checked;
      const hints = !!this.el.setHints.checked;
      if (this.el.setMusicVal) this.el.setMusicVal.textContent = String(music);
      if (this.el.setSfxVal) this.el.setSfxVal.textContent = String(sfx);
      document.body.classList.toggle("reduce-fx", reduce);
      this.onSettingsChange({ music, sfx, reduce, hints });
    };
    for (const input of [this.el.setMusic, this.el.setSfx]) {
      input?.addEventListener("input", update);
    }
    this.el.setReduce?.addEventListener("change", update);
    this.el.setHints?.addEventListener("change", update);
    this.el.settings?.addEventListener("click", (e) => {
      if (e.target === this.el.settings) this.closeSettings();
    });
  }

  applySettings({ music = 55, sfx = 75, reduce = false, hints = true } = {}) {
    if (this.el.setMusic) this.el.setMusic.value = String(music);
    if (this.el.setSfx) this.el.setSfx.value = String(sfx);
    if (this.el.setMusicVal) this.el.setMusicVal.textContent = String(music);
    if (this.el.setSfxVal) this.el.setSfxVal.textContent = String(sfx);
    if (this.el.setReduce) this.el.setReduce.checked = !!reduce;
    if (this.el.setHints) this.el.setHints.checked = !!hints;
    document.body.classList.toggle("reduce-fx", !!reduce);
    this.onSettingsChange({ music, sfx, reduce, hints });
  }

  openSettings(from = "menu") {
    this.settingsFrom = from;
    if (from === "pause") this.el.pause?.classList.add("hidden");
    this.el.settings?.classList.remove("hidden");
  }

  closeSettings() {
    this.el.settings?.classList.add("hidden");
    if (this.settingsFrom === "pause") {
      this.el.pause?.classList.remove("hidden");
    } else if (this.settingsFrom === "menu") {
      this.el.menu?.classList.remove("hidden");
    }
  }

  openHelp() {
    this.el.help?.classList.remove("hidden");
  }

  closeHelp() {
    this.el.help?.classList.add("hidden");
  }

  /* ---------- конец ---------- */
  showEnd(endingId, stats = {}) {
    const ending = ENDINGS[endingId] || ENDINGS.hope;
    this.showHud(false);
    this.closeMap();
    this.closeWorkbench();
    this.hideDialogue();
    this.hidePause();
    this.el.end?.classList.remove("hidden");
    if (this.el.endTitle) this.el.endTitle.textContent = ending.title;
    if (this.el.endText) this.el.endText.textContent = ending.text;
    if (this.el.endStats) {
      this.el.endStats.innerHTML = `
        <div><b>${stats.level ?? 1}</b>уровень</div>
        <div><b>${stats.kills ?? 0}</b>повержено</div>
        <div><b>${stats.embers ?? 0}/3</b>уголька</div>
        <div><b>${stats.shards ?? 0}</b>осколков</div>`;
    }
    this.updateRotate(false);
  }

  updateRotate(active) {
    if (!this.el.rotate) return;
    const portrait = window.innerHeight > window.innerWidth;
    const show = active && portrait && Math.min(window.innerWidth, window.innerHeight) < 900;
    this.el.rotate.classList.toggle("hidden", !show);
  }

  setFade(on) {
    this.el.fade?.classList.toggle("on", !!on);
  }

  hideBoot() {
    this.el.boot?.classList.add("done");
    setTimeout(() => this.el.boot?.remove(), 800);
  }

  setJoinAddress(url) {
    if (this.el.joinUrl) this.el.joinUrl.value = url;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
