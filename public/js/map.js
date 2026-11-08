/* Пепел и Вереск — карта, коллизии, генерация мира */

export const TILE = 32;
export const MAP_W = 144;
export const MAP_H = 104;

export const T = {
  HEATHER: 0,
  DIRT: 1,
  STONE: 2,
  WATER: 3,
  WALL: 4,
  TREE: 5,
  ROCK: 6,
  FLOOR: 7,
  ASH: 8,
  BRIDGE: 9,
  MOSS: 10,
};

export const SOLID_TILES = new Set([T.WATER, T.WALL, T.TREE, T.ROCK]);

export function idx(tx, ty) {
  return ty * MAP_W + tx;
}

export function tileCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

export function worldToTile(x, y) {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createMap(seed = 20261107) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const reserved = new Uint8Array(MAP_W * MAP_H);
  const props = [];
  const npcs = [];
  const spawns = [];
  const landmarks = {};

  const set = (tx, ty, t) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;
    tiles[idx(tx, ty)] = t;
  };
  const get = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.TREE;
    return tiles[idx(tx, ty)];
  };
  const reserve = (tx, ty, r = 1) => {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) reserved[idx(x, y)] = 1;
      }
    }
  };

  // base heather with soft variation
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = hash2(x, y);
      set(x, y, n < 0.035 ? T.ASH : n > 0.965 ? T.MOSS : T.HEATHER);
    }
  }

  // wild border: dense old forest
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      if (edge < 2) set(x, y, T.TREE);
      else if (edge < 4 && hash2(x * 3, y * 3) < 0.55) set(x, y, T.TREE);
      else if (edge < 6 && hash2(x * 7, y * 7) < 0.25) set(x, y, T.ROCK);
    }
  }

  const clearRect = (x0, y0, x1, y1, tile) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        set(x, y, tile);
        reserve(x, y, 1);
      }
    }
  };
  const stamp = (cx, cy, r, tile, reserveIt = true) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) {
          set(x, y, tile);
          if (reserveIt) reserve(x, y, 1);
        }
      }
    }
  };
  const path = (points, width = 3, tile = T.DIRT) => {
    const r = Math.max(1, width / 2);
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(dist * 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        stamp(x, y, r, tile, true);
      }
    }
  };

  // --- settlements and landmarks ---
  const VX = 44;
  const VY = 32;

  // village clearing
  clearRect(31, 23, 57, 43, T.DIRT);
  // village stone heart
  stamp(VX, 33, 6, T.STONE);
  // soft ash patches
  for (let i = 0; i < 24; i++) {
    const x = 32 + Math.floor(rng() * 24);
    const y = 24 + Math.floor(rng() * 18);
    if (rng() < 0.5) stamp(x, y, 1, T.ASH);
  }

  // chapel clearing and ruin
  clearRect(32, 3, 56, 19, T.HEATHER);
  clearRect(35, 5, 53, 17, T.STONE);
  // chapel floor
  clearRect(37, 7, 51, 15, T.FLOOR);
  // chapel walls
  for (let x = 35; x <= 53; x++) {
    set(x, 5, T.WALL);
    set(x, 17, T.WALL);
  }
  for (let y = 5; y <= 17; y++) {
    set(35, y, T.WALL);
    set(53, y, T.WALL);
  }
  // broken door gap: only these tiles lead into the chapel, and the door seals them
  set(43, 17, T.FLOOR);
  set(44, 17, T.FLOOR);
  for (const [x, y] of [[43, 17], [44, 17], [44, 16], [44, 15]]) reserve(x, y, 1);
  reserve(44, 18, 2);

  // paths
  path([[VX, 24], [VX, 17]], 4, T.DIRT);
  path([[31, 32], [25, 32], [18, 32], [12, 33]], 3, T.DIRT);
  path([[57, 32], [63, 32], [69, 34], [74, 36]], 3, T.DIRT);
  path([[44, 43], [44, 48], [44, 52]], 3, T.DIRT);
  // small trail to the pond
  path([[44, 52], [48, 55]], 2, T.DIRT);

  // the approach path must not widen the chapel doorway
  for (let x = 35; x <= 53; x++) set(x, 17, T.WALL);
  set(43, 17, T.FLOOR);
  set(44, 17, T.FLOOR);

  // south pond
  stamp(49, 57, 5, T.WATER, true);
  stamp(45, 58, 3, T.WATER, true);

  // west name-tree clearing
  clearRect(6, 27, 19, 40, T.HEATHER);
  stamp(12, 33, 4, T.DIRT);
  // east hunter camp
  clearRect(68, 31, 81, 42, T.HEATHER);
  stamp(74, 36, 4, T.DIRT);
  // south shrine
  clearRect(38, 48, 51, 56, T.STONE);
  stamp(44, 52, 5, T.STONE);

  // --- east: Соляная топь ---
  clearRect(90, 34, 124, 64, T.HEATHER);
  path([[81, 36], [88, 37], [95, 41], [101, 45]], 3, T.DIRT);
  path([[108, 48], [114, 54]], 2, T.DIRT);
  clearRect(96, 40, 109, 51, T.DIRT);
  stamp(103, 56, 5, T.WATER, true);
  stamp(117, 47, 3, T.WATER, true);
  stamp(119, 60, 4, T.WATER, true);
  stamp(112, 62, 3, T.WATER, true);
  for (let i = 0; i < 26; i++) {
    const x = 92 + Math.floor(rng() * 30);
    const y = 36 + Math.floor(rng() * 26);
    if (rng() < 0.55) stamp(x, y, 1, T.MOSS);
  }
  clearRect(110, 51, 119, 59, T.MOSS);
  path([[100, 64], [105, 61], [110, 58]], 2, T.DIRT);

  // --- north-east: кратер Тихой Звезды ---
  clearRect(88, 4, 116, 24, T.HEATHER);
  path([[57, 24], [64, 20], [72, 16], [81, 14], [89, 14]], 3, T.DIRT);
  stamp(100, 14, 9, T.STONE);
  stamp(100, 14, 5, T.ASH);
  stamp(101, 14, 2, T.FLOOR);
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const r = 6 + rng() * 8;
    stamp(100 + Math.cos(a) * r, 14 + Math.sin(a) * r, 1, rng() < 0.5 ? T.ASH : T.MOSS);
  }

  // --- south: Курганы ---
  clearRect(58, 64, 102, 96, T.HEATHER);
  path([[44, 56], [49, 62], [56, 68], [64, 73], [72, 78], [82, 82]], 3, T.DIRT);
  for (const [bx, by, br] of [[63, 74, 3], [76, 88, 4], [90, 73, 3], [95, 88, 3], [70, 92, 2], [86, 92, 2]]) {
    stamp(bx, by, br, T.ASH, true);
    stamp(bx, by, Math.max(1, br - 2), T.STONE);
  }
  for (let i = 0; i < 22; i++) {
    const x = 60 + Math.floor(rng() * 40);
    const y = 66 + Math.floor(rng() * 28);
    if (rng() < 0.45) stamp(x, y, 1, T.ASH);
  }

  // --- west: Вересковая мельница и топь ---
  clearRect(8, 56, 33, 92, T.HEATHER);
  path([[12, 40], [12, 50], [15, 58], [19, 66], [22, 72]], 2, T.DIRT);
  stamp(16, 80, 5, T.WATER, true);
  stamp(11, 73, 3, T.WATER, true);
  stamp(27, 84, 4, T.WATER, true);
  stamp(22, 71, 4, T.DIRT);
  for (let i = 0; i < 18; i++) {
    const x = 9 + Math.floor(rng() * 23);
    const y = 58 + Math.floor(rng() * 32);
    if (rng() < 0.6) stamp(x, y, 1, T.MOSS);
  }

  // --- settlements props ---
  const hut = (cx, cy, w = 5, h = 4) => {
    props.push({
      id: `hut_${cx}_${cy}`,
      type: "hut",
      x: cx * TILE,
      y: cy * TILE,
      w: w * TILE,
      h: h * TILE,
      solid: true,
      shape: "rect",
      sort: cy * TILE + h * TILE,
    });
    reserve(cx, cy, 4);
  };
  hut(35.5, 27.5);
  hut(52.5, 27.5);
  hut(35.5, 38.5);
  hut(52.5, 38.5);

  const campfire = (cx, cy) => {
    props.push({
      id: "campfire",
      type: "campfire",
      x: cx * TILE,
      y: cy * TILE,
      r: 13,
      solid: true,
      shape: "circle",
      interact: { kind: "campfire" },
      sort: cy * TILE,
    });
    reserve(cx, cy, 2);
  };
  campfire(44, 33);

  const tent = (cx, cy) => {
    props.push({
      id: "hunter_tent",
      type: "tent",
      x: cx * TILE,
      y: cy * TILE,
      w: 3 * TILE,
      h: 2.4 * TILE,
      solid: true,
      shape: "rect",
      sort: cy * TILE + 2.4 * TILE,
    });
    reserve(cx, cy, 3);
  };
  tent(75, 35);
  props.push({
    id: "hunter_fire",
    type: "campfire",
    x: 74 * TILE,
    y: 38 * TILE,
    r: 9,
    solid: true,
    shape: "circle",
    sort: 38 * TILE,
  });

  const nameTree = {
    id: "name_tree",
    type: "nameTree",
    x: 12 * TILE,
    y: 33 * TILE,
    r: 27,
    solid: true,
    shape: "circle",
    interact: { kind: "dialogue", script: "nameTree" },
    sort: 33 * TILE,
  };
  props.push(nameTree);
  reserve(12, 33, 4);

  const shrine = {
    id: "south_shrine",
    type: "shrine",
    x: 44 * TILE,
    y: 52 * TILE,
    r: 14,
    solid: true,
    shape: "circle",
    interact: { kind: "shrine" },
    sort: 52 * TILE,
  };
  props.push(shrine);
  reserve(44, 52, 3);

  // chapel columns
  for (const [cx, cy] of [[38.5, 8.5], [49.5, 8.5], [38.5, 13.5], [49.5, 13.5]]) {
    props.push({
      id: `column_${cx}_${cy}`,
      type: "column",
      x: cx * TILE,
      y: cy * TILE,
      r: 11,
      solid: true,
      shape: "circle",
      sort: cy * TILE,
    });
  }

  // chapel door
  props.push({
    id: "chapel_door",
    type: "door",
    x: 44 * TILE,
    y: 17 * TILE,
    w: 2.6 * TILE,
    h: 0.9 * TILE,
    solid: true,
    shape: "rect",
    interact: { kind: "door" },
    sort: 17 * TILE,
  });

  // notes and graves
  const note = (cx, cy, script, type = "note") => {
    props.push({
      id: `${type}_${cx}_${cy}`,
      type,
      x: cx * TILE,
      y: cy * TILE,
      r: 9,
      solid: false,
      shape: "circle",
      interact: { kind: "dialogue", script },
      sort: cy * TILE,
    });
    reserve(cx, cy, 1);
  };
  note(37, 30, "noteDiary");
  note(48, 39.5, "noteGrave", "grave");
  note(38, 12, "noteChapel", "rune");

  // --- верстак у последнего очага ---
  props.push({
    id: "workbench",
    type: "workbench",
    x: 47.5 * TILE,
    y: 36.5 * TILE,
    r: 13,
    solid: true,
    shape: "circle",
    interact: { kind: "workbench" },
    sort: 36.5 * TILE,
  });
  reserve(47, 36, 2);

  // --- Соляная топь: огонь, хижины, лодка ---
  const saltFire = {
    id: "salt_fire",
    type: "campfire",
    x: 102 * TILE,
    y: 47 * TILE,
    r: 12,
    solid: true,
    shape: "circle",
    interact: { kind: "campfire" },
    sort: 47 * TILE,
  };
  props.push(saltFire);
  reserve(102, 47, 2);
  hut(96.5, 43.5, 4, 3);
  hut(108, 43, 4, 3);
  props.push({
    id: "ferry_boat",
    type: "boat",
    x: 114.5 * TILE,
    y: 55.5 * TILE,
    r: 13,
    solid: false,
    shape: "circle",
    sort: 55.5 * TILE,
  });
  reserve(114, 55, 2);

  // три травы знахарки
  for (const [hx, hy] of [[94, 48], [113, 42], [121, 54]]) {
    props.push({
      id: `herb_${hx}_${hy}`,
      type: "herb",
      x: hx * TILE,
      y: hy * TILE,
      r: 8,
      solid: false,
      shape: "circle",
      interact: { kind: "herb" },
      sort: hy * TILE,
    });
    reserve(hx, hy, 2);
  }

  // --- Вересковая мельница ---
  props.push({
    id: "old_mill",
    type: "mill",
    x: 21 * TILE,
    y: 72 * TILE,
    w: 4.6 * TILE,
    h: 5.2 * TILE,
    solid: true,
    shape: "rect",
    sort: 74.5 * TILE,
  });
  reserve(21, 72, 3);
  note(25.5, 69.5, "noteMill");

  // --- северный кратер: руна и примета ---
  note(95, 11, "noteStar", "rune");

  // --- курганы: надпись ---
  note(68, 82, "noteBarrow", "grave");

  // --- сигнальные огни ---
  const beacon = (id, tx, ty) => {
    props.push({
      id: `beacon_${id}`,
      type: "beacon",
      x: tx * TILE,
      y: ty * TILE,
      r: 10,
      solid: true,
      shape: "circle",
      interact: { kind: "beacon" },
      sort: ty * TILE,
    });
    reserve(tx, ty, 2);
  };
  beacon("mill", 27, 77);
  beacon("ridge", 104, 18);
  beacon("barrow", 87, 88);

  // --- NPCs ---
  const npc = (id, name, dialogue, tx, ty, color, cloak) => {
    const pos = tileCenter(tx, ty);
    npcs.push({
      id,
      name,
      dialogue,
      x: pos.x,
      y: pos.y,
      color,
      cloak,
      radius: 9,
      sort: pos.y,
    });
    reserve(tx, ty, 1);
  };
  npc("irma", "Ирма", "irma", 43.5, 35.5, "#d8c7a1", "#4b3d32");
  npc("child", "Девочка", "child", 42, 31.5, "#e0c7b2", "#5a3d3a");
  npc("merchant", "Ворон", "merchant", 38.5, 31.5, "#b6a7c7", "#2e2a3c");
  npc("hunter", "Раненый охотник", "hunter", 72.5, 38.5, "#b9a58c", "#3d4232");
  npc("mila", "Знахарка Мила", "mila", 104.5, 45.5, "#bfd2ae", "#38483a");
  npc("garm", "Перевозчик Гарм", "garm", 113.5, 53.5, "#b8b0a0", "#343b46");
  npc("ada", "Могильщица Ада", "ada", 72, 80, "#c4b8a8", "#3f3a3a");
  npc("hermit", "Отшельник Каль", "hermit", 100.5, 16.5, "#c0c8d8", "#30323e");
  npc("miller", "Мельник Тихон", "miller", 23.5, 70.5, "#cbb79c", "#443b32");

  // --- random wilderness props ---
  const placeProp = (type, tx, ty, rngValue) => {
    if (tx < 5 || ty < 5 || tx >= MAP_W - 5 || ty >= MAP_H - 5) return false;
    const tile = get(tx, ty);
    if (tile !== T.HEATHER && tile !== T.ASH && tile !== T.MOSS) return false;
    if (reserved[idx(tx, ty)]) return false;
    // keep paths and landmarks clear
    for (let y = ty - 2; y <= ty + 2; y++) {
      for (let x = tx - 2; x <= tx + 2; x++) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && reserved[idx(x, y)]) return false;
      }
    }
    const pos = tileCenter(tx, ty);
    if (type === "tree") {
      props.push({
        id: `tree_${tx}_${ty}`,
        type: rngValue < 0.7 ? "deadTree" : "tree",
        x: pos.x,
        y: pos.y,
        r: 13 + rngValue * 9,
        solid: true,
        shape: "circle",
        sort: pos.y,
      });
    } else if (type === "rock") {
      props.push({
        id: `rock_${tx}_${ty}`,
        type: "rock",
        x: pos.x,
        y: pos.y,
        r: 9 + rngValue * 7,
        solid: true,
        shape: "circle",
        sort: pos.y,
      });
    } else {
      props.push({
        id: `bush_${tx}_${ty}`,
        type: "bush",
        x: pos.x,
        y: pos.y,
        r: 8 + rngValue * 5,
        solid: false,
        shape: "circle",
        sort: pos.y,
      });
    }
    reserve(tx, ty, 1);
    return true;
  };

  let placed = 0;
  for (let i = 0; i < 820 && placed < 280; i++) {
    const tx = 5 + Math.floor(rng() * (MAP_W - 10));
    const ty = 5 + Math.floor(rng() * (MAP_H - 10));
    const r = rng();
    const type = r < 0.45 ? "tree" : r < 0.78 ? "rock" : "bush";
    if (placeProp(type, tx, ty, rng())) placed++;
  }

  // --- enemy spawn zones ---
  const spawnZone = (tx, ty, type, count, radius = 4) => {
    spawns.push({ x: tx * TILE, y: ty * TILE, type, count, radius: radius * TILE });
    reserve(tx, ty, Math.ceil(radius));
  };
  spawnZone(25, 28, "hollow", 3, 4);
  spawnZone(63, 28, "hound", 3, 4);
  spawnZone(28, 46, "weeper", 2, 4);
  spawnZone(58, 46, "hollow", 3, 4);
  spawnZone(23, 15, "hound", 3, 4);
  spawnZone(64, 15, "weeper", 2, 4);
  spawnZone(21, 38, "hollow", 2, 3);
  spawnZone(67, 44, "hound", 2, 3);
  spawnZone(13, 45, "weeper", 2, 3);
  // Соляная топь
  spawnZone(94, 50, "hound", 3, 4);
  spawnZone(117, 44, "wisp", 2, 3);
  spawnZone(114, 62, "wisp", 2, 3);
  spawnZone(109, 70, "barrow", 2, 3);
  // северный кратер
  spawnZone(96, 20, "hollow", 3, 4);
  spawnZone(108, 20, "hound", 2, 3);
  // курганы
  spawnZone(63, 78, "barrow", 3, 4);
  spawnZone(88, 78, "barrow", 3, 4);
  spawnZone(96, 90, "hollow", 2, 3);
  // западная топь
  spawnZone(15, 66, "wisp", 3, 4);
  spawnZone(25, 84, "hound", 2, 3);
  // guardian of the southern shrine
  spawns.push({ x: 44 * TILE, y: 49 * TILE, type: "guardian", count: 1, radius: TILE * 2, fixed: true });
  reserve(44, 49, 3);
  // boss
  spawns.push({ x: 44 * TILE, y: 9 * TILE, type: "boss", count: 1, radius: TILE * 2, fixed: true, boss: true });

  landmarks.irma = { x: 43.5 * TILE, y: 35.5 * TILE, label: "Ирма" };
  landmarks.chapel = { x: 44 * TILE, y: 10 * TILE, label: "Часовня" };
  landmarks.nameTree = { x: 12 * TILE, y: 33 * TILE, label: "Дерево Имён" };
  landmarks.hunter = { x: 72.5 * TILE, y: 38.5 * TILE, label: "Лагерь охотника" };
  landmarks.shrine = { x: 44 * TILE, y: 52 * TILE, label: "Южный алтарь" };
  landmarks.campfire = { x: 44 * TILE, y: 33 * TILE, label: "Последний Очаг" };
  landmarks.workbench = { x: 47.5 * TILE, y: 36.5 * TILE, label: "Верстак" };
  landmarks.saltMarsh = { x: 102 * TILE, y: 47 * TILE, label: "Соляная топь" };
  landmarks.ferry = { x: 114 * TILE, y: 54 * TILE, label: "Перевоз" };
  landmarks.starCrater = { x: 100 * TILE, y: 14 * TILE, label: "Тихая Звезда" };
  landmarks.barrows = { x: 76 * TILE, y: 82 * TILE, label: "Курганы" };
  landmarks.mill = { x: 21 * TILE, y: 72 * TILE, label: "Вересковая мельница" };

  // spatial grid for solid props
  const propGrid = new Map();
  const gridKey = (x, y) => `${x},${y}`;
  for (const p of props) {
    if (!p.solid) continue;
    const halfW = p.shape === "rect" ? p.w / 2 : p.r;
    const halfH = p.shape === "rect" ? p.h / 2 : p.r;
    const minX = Math.floor((p.x - halfW) / TILE);
    const maxX = Math.floor((p.x + halfW) / TILE);
    const minY = Math.floor((p.y - halfH) / TILE);
    const maxY = Math.floor((p.y + halfH) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const key = gridKey(tx, ty);
        if (!propGrid.has(key)) propGrid.set(key, []);
        propGrid.get(key).push(p);
      }
    }
  }

  function tileAt(tx, ty) {
    return get(tx, ty);
  }

  function isBlocked(x, y, radius = 10) {
    if (x - radius < 2 * TILE || y - radius < 2 * TILE || x + radius > (MAP_W - 2) * TILE || y + radius > (MAP_H - 2) * TILE) {
      return true;
    }
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (SOLID_TILES.has(get(tx, ty))) {
          // circle vs tile AABB
          const rx = tx * TILE;
          const ry = ty * TILE;
          const cx = Math.max(rx, Math.min(x, rx + TILE));
          const cy = Math.max(ry, Math.min(y, ry + TILE));
          if ((x - cx) ** 2 + (y - cy) ** 2 < radius * radius) return true;
        }
        const list = propGrid.get(gridKey(tx, ty));
        if (list) {
          for (const p of list) {
            if (!p.solid) continue;
            if (p.shape === "rect") {
              const rx = p.x - p.w / 2;
              const ry = p.y - p.h / 2;
              const cx = Math.max(rx, Math.min(x, rx + p.w));
              const cy = Math.max(ry, Math.min(y, ry + p.h));
              if ((x - cx) ** 2 + (y - cy) ** 2 < radius * radius) return true;
            } else {
              if ((x - p.x) ** 2 + (y - p.y) ** 2 < (radius + p.r) ** 2) return true;
            }
          }
        }
      }
    }
    return false;
  }

  function moveEntity(ent, dx, dy) {
    let moved = false;
    if (dx) {
      const nx = ent.x + dx;
      if (!isBlocked(nx, ent.y, ent.radius || 10)) {
        ent.x = nx;
        moved = true;
      }
    }
    if (dy) {
      const ny = ent.y + dy;
      if (!isBlocked(ent.x, ny, ent.radius || 10)) {
        ent.y = ny;
        moved = true;
      }
    }
    return moved;
  }

  function randomWalkableNear(x, y, radius = 100) {
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * radius;
      const nx = x + Math.cos(a) * d;
      const ny = y + Math.sin(a) * d;
      if (!isBlocked(nx, ny, 12)) return { x: nx, y: ny };
    }
    return { x, y };
  }

  // open the chapel door
  function setChapelOpen(open) {
    const door = props.find((p) => p.id === "chapel_door");
    if (door) door.solid = !open;
  }

  return {
    width: MAP_W,
    height: MAP_H,
    tiles,
    props,
    npcs,
    spawns,
    landmarks,
    tileAt,
    isBlocked,
    moveEntity,
    randomWalkableNear,
    setChapelOpen,
    seed,
  };
}
