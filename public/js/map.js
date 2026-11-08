/* Пепел и Вереск — карта, коллизии, генерация мира v0.4 */

export const TILE = 32;
export const MAP_W = 200;
export const MAP_H = 144;

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
  CAVE: 11,
  CAVE_WALL: 12,
  WOOD: 13,
  RUG: 14,
  STAIRS: 15,
};

export const SOLID_TILES = new Set([T.WATER, T.WALL, T.TREE, T.ROCK, T.CAVE_WALL]);

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
    const x0 = Math.floor(tx - r);
    const x1 = Math.ceil(tx + r);
    const y0 = Math.floor(ty - r);
    const y1 = Math.ceil(ty + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) reserved[idx(x, y)] = 1;
      }
    }
  };

  /* ---------- земля и дикая кромка ---------- */
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = hash2(x, y);
      set(x, y, n < 0.035 ? T.ASH : n > 0.965 ? T.MOSS : T.HEATHER);
    }
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      if (edge < 2) set(x, y, T.TREE);
      else if (edge < 4 && hash2(x * 3, y * 3) < 0.55) set(x, y, T.TREE);
      else if (edge < 6 && hash2(x * 7, y * 7) < 0.25) set(x, y, T.ROCK);
    }
  }

  const clearRect = (x0, y0, x1, y1, tile, reserveIt = true) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        set(x, y, tile);
        if (reserveIt) reserve(x, y, 1);
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
      const d = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(d * 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, tile, true);
      }
    }
  };
  const rectTile = (x0, y0, x1, y1, tile, reserveIt = true) => clearRect(x0, y0, x1, y1, tile, reserveIt);

  /* ---------- деревня к югу от дома ---------- */
  clearRect(32, 54, 74, 82, T.HEATHER);
  stamp(53, 68, 8, T.DIRT);
  stamp(54, 69, 5, T.STONE);
  rectTile(47, 64, 61, 73, T.STONE);
  for (let i = 0; i < 30; i++) {
    const x = 34 + Math.floor(rng() * 38);
    const y = 56 + Math.floor(rng() * 24);
    if (rng() < 0.4) stamp(x, y, 1, rng() < 0.5 ? T.DIRT : T.ASH);
  }
  path([[35, 66], [29, 69], [23, 71], [19, 73]], 3, T.DIRT);
  path([[19, 74], [17, 82], [18, 90], [22, 98], [26, 105]], 2, T.DIRT);
  path([[72, 66], [80, 67], [84, 68]], 3, T.DIRT);
  path([[86, 72], [100, 77], [116, 81], [132, 86], [144, 90], [150, 94]], 3, T.DIRT);
  path([[54, 80], [58, 88], [62, 96], [68, 103], [78, 110], [90, 116], [102, 121], [114, 126], [124, 130]], 3, T.DIRT);
  path([[62, 58], [70, 54], [82, 51], [96, 49], [110, 47], [124, 45], [138, 46], [150, 51], [158, 56], [162, 59]], 3, T.DIRT);
  path([[150, 94], [158, 99], [170, 102], [180, 106]], 2, T.DIRT);
  path([[26, 105], [30, 109], [34, 110]], 2, T.DIRT);

  /* ---------- лагерь охотника ---------- */
  clearRect(74, 57, 92, 76, T.HEATHER);
  stamp(83, 67, 5, T.DIRT);
  path([[74, 58], [80, 62], [83, 67]], 2, T.DIRT);

  /* ---------- дерево имён ---------- */
  clearRect(9, 63, 31, 84, T.HEATHER);
  stamp(19, 73, 6, T.DIRT);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = 5 + rng() * 8;
    if (rng() < 0.7) stamp(19 + Math.cos(a) * r, 73 + Math.sin(a) * r, 1, T.MOSS);
  }

  /* ---------- мельница ---------- */
  clearRect(10, 91, 41, 121, T.HEATHER);
  stamp(26, 106, 7, T.DIRT);
  stamp(15, 112, 4, T.WATER);
  stamp(10, 105, 3, T.WATER);
  stamp(33, 116, 3, T.WATER);
  for (let i = 0; i < 22; i++) {
    const x = 12 + Math.floor(rng() * 28);
    const y = 93 + Math.floor(rng() * 26);
    if (rng() < 0.55) stamp(x, y, 1, T.MOSS);
  }

  /* ---------- соляная топь ---------- */
  clearRect(142, 77, 191, 117, T.HEATHER);
  stamp(152, 84, 4, T.WATER);
  stamp(166, 82, 5, T.WATER);
  stamp(180, 92, 4, T.WATER);
  stamp(158, 104, 5, T.WATER);
  stamp(174, 111, 4, T.WATER);
  stamp(187, 103, 3, T.WATER);
  for (let i = 0; i < 40; i++) {
    const x = 144 + Math.floor(rng() * 46);
    const y = 79 + Math.floor(rng() * 36);
    if (rng() < 0.55) stamp(x, y, 1, T.MOSS);
  }
  path([[158, 99], [166, 100], [174, 103], [180, 106]], 2, T.BRIDGE);
  path([[180, 106], [186, 109]], 2, T.BRIDGE);

  /* ---------- курганы ---------- */
  clearRect(77, 103, 132, 139, T.HEATHER);
  for (const [bx, by, br] of [[88, 114, 4], [102, 112, 3], [116, 120, 4], [96, 128, 3], [112, 132, 3], [126, 126, 3], [84, 126, 2]]) {
    stamp(bx, by, br, T.ASH, true);
    stamp(bx, by, Math.max(1, br - 2), T.STONE);
  }
  for (let i = 0; i < 26; i++) {
    const x = 79 + Math.floor(rng() * 50);
    const y = 105 + Math.floor(rng() * 32);
    if (rng() < 0.5) stamp(x, y, 1, T.ASH);
  }

  /* ---------- Серые скалы и пещера ---------- */
  clearRect(132, 5, 191, 61, T.ROCK);
  clearRect(136, 7, 188, 58, T.CAVE_WALL);
  const caveRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x > 136 && x < 188 && y > 7 && y < 58) set(x, y, T.CAVE);
      }
    }
  };
  // нижний зал и вход
  caveRect(148, 32, 178, 42);
  caveRect(159, 40, 164, 57);
  // арена Похитителя
  caveRect(142, 16, 166, 33);
  // клетка Лиры
  caveRect(168, 22, 184, 36);
  // петля между клеткой и нижним залом
  caveRect(176, 35, 183, 44);
  caveRect(170, 43, 178, 50);
  // соединительные проходы
  caveRect(153, 30, 160, 35);
  caveRect(164, 27, 171, 33);
  // неровные края зала
  for (const [cx, cy, r] of [[146, 19, 3], [162, 18, 3], [182, 26, 3], [181, 33, 2], [148, 40, 2], [176, 41, 2], [156, 36, 2], [172, 48, 2]]) {
    stamp(cx, cy, r, T.CAVE, false);
  }
  // выход из пещеры
  clearRect(156, 55, 167, 62, T.STONE, true);
  for (let x = 158; x <= 165; x++) {
    for (let y = 55; y <= 60; y++) set(x, y, y === 55 ? T.CAVE : T.STONE);
  }
  // дорога к входу
  path([[162, 60], [163, 62], [163, 66]], 3, T.DIRT);
  // вернуть каменную кромку входа
  for (let x = 156; x <= 167; x++) {
    if (x < 158 || x > 165) set(x, 55, T.CAVE_WALL);
  }

  /* ---------- дороги деревни ---------- */
  path([[53, 55], [53, 60], [53, 64]], 3, T.DIRT);
  path([[47, 68], [52, 67], [57, 68], [62, 68]], 2, T.DIRT);

  /* ---------- дом ---------- */
  clearRect(37, 33, 67, 58, T.HEATHER);
  rectTile(39, 35, 65, 58, T.DIRT);
  // внешние стены
  for (let x = 43; x <= 61; x++) {
    set(x, 38, T.WALL);
    set(x, 54, T.WALL);
  }
  for (let y = 38; y <= 54; y++) {
    set(43, y, T.WALL);
    set(61, y, T.WALL);
  }
  // пол
  for (let y = 39; y <= 53; y++) {
    for (let x = 44; x <= 60; x++) set(x, y, T.WOOD);
  }
  // ковёр в детской и гостиной
  for (let y = 40; y <= 43; y++) {
    for (let x = 47; x <= 57; x++) set(x, y, T.RUG);
  }
  for (let y = 48; y <= 51; y++) {
    for (let x = 49; x <= 57; x++) set(x, y, T.RUG);
  }
  // перегородка и лестница
  for (let x = 44; x <= 60; x++) set(x, 45, T.WALL);
  for (let x = 52; x <= 54; x++) set(x, 45, T.STAIRS);
  // дверной проём на юг
  for (let x = 52; x <= 54; x++) set(x, 54, T.WOOD);
  for (let y = 55; y <= 58; y++) {
    for (let x = 51; x <= 55; x++) set(x, y, T.DIRT);
  }
  // крыльцо
  for (let x = 51; x <= 55; x++) set(x, 55, T.STONE);
  reserve(52, 54, 2);
  reserve(56, 38, 3);

  /* ---------- дом: мебель ---------- */
  const pc = (tx, ty) => tileCenter(tx, ty);
  const prop = (o) => {
    props.push(o);
    if (o.solid) {
      const halfW = o.shape === "rect" ? o.w / 2 : o.r;
      const halfH = o.shape === "rect" ? o.h / 2 : o.r;
      reserve(o.x / TILE, o.y / TILE, Math.max(halfW, halfH) / TILE + 0.5);
    }
    return o;
  };

  const bedPos = pc(50, 41.5);
  prop({
    id: "girl_bed",
    type: "bed",
    x: bedPos.x,
    y: bedPos.y,
    w: 3.2 * TILE,
    h: 2.1 * TILE,
    solid: true,
    shape: "rect",
    interact: { kind: "bed" },
    sort: bedPos.y + TILE * 0.6,
  });
  const rugPos = pc(52, 42);
  prop({
    id: "bedroom_rug",
    type: "rug",
    x: rugPos.x,
    y: rugPos.y,
    w: 10 * TILE,
    h: 4 * TILE,
    solid: false,
    shape: "rect",
    sort: -100,
  });
  prop({
    id: "dresser",
    type: "dresser",
    x: pc(58, 40).x,
    y: pc(58, 40).y,
    w: 2 * TILE,
    h: 1.3 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(58, 40).y,
  });
  prop({
    id: "toy_chest",
    type: "chest",
    x: pc(45, 40.5).x,
    y: pc(45, 40.5).y,
    w: 1.5 * TILE,
    h: 1.2 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(45, 40.5).y,
  });
  prop({
    id: "home_table",
    type: "table",
    x: pc(50, 49.5).x,
    y: pc(50, 49.5).y,
    w: 4 * TILE,
    h: 2 * TILE,
    solid: true,
    shape: "rect",
    interact: { kind: "table" },
    sort: pc(50, 49.5).y + TILE,
  });
  prop({
    id: "chair_left",
    type: "chair",
    x: pc(47.3, 50.4).x,
    y: pc(47.3, 50.4).y,
    r: 9,
    solid: true,
    shape: "circle",
    sort: pc(47.3, 50.4).y,
  });
  prop({
    id: "chair_right",
    type: "chair",
    x: pc(52.9, 50.4).x,
    y: pc(52.9, 50.4).y,
    r: 9,
    solid: true,
    shape: "circle",
    sort: pc(52.9, 50.4).y,
  });
  prop({
    id: "home_hearth",
    type: "hearth",
    x: pc(45.3, 47.3).x,
    y: pc(45.3, 47.3).y,
    r: 15,
    solid: true,
    shape: "circle",
    interact: { kind: "campfire" },
    sort: pc(45.3, 47.3).y,
  });
  prop({
    id: "home_workbench",
    type: "workbench",
    x: pc(58.5, 52).x,
    y: pc(58.5, 52).y,
    r: 13,
    solid: true,
    shape: "circle",
    interact: { kind: "workbench" },
    sort: pc(58.5, 52).y,
  });
  prop({
    id: "cupboard",
    type: "cupboard",
    x: pc(58.5, 46.6).x,
    y: pc(58.5, 46.6).y,
    w: 1.4 * TILE,
    h: 1.8 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(58.5, 46.6).y,
  });
  prop({
    id: "home_door",
    type: "homeDoor",
    x: pc(53, 54).x,
    y: pc(53, 54).y,
    w: 3 * TILE,
    h: 0.45 * TILE,
    solid: false,
    shape: "rect",
    sort: pc(53, 54).y - 2,
  });

  /* ---------- деревня: постройки и люди ---------- */
  const hut = (cx, cy, w = 5, h = 4) => {
    const pos = pc(cx, cy);
    prop({
      id: `hut_${cx}_${cy}`,
      type: "hut",
      x: pos.x,
      y: pos.y,
      w: w * TILE,
      h: h * TILE,
      solid: true,
      shape: "rect",
      sort: pos.y + (h * TILE) / 2,
    });
    reserve(cx, cy, 4);
  };
  hut(37.5, 64.5);
  hut(44, 77);
  hut(67, 61.5);
  hut(68.5, 77);

  const campfire = (id, cx, cy, interact = true) => {
    const pos = pc(cx, cy);
    prop({
      id,
      type: "campfire",
      x: pos.x,
      y: pos.y,
      r: 13,
      solid: true,
      shape: "circle",
      ...(interact ? { interact: { kind: "campfire" } } : {}),
      sort: pos.y,
    });
    reserve(cx, cy, 2);
  };
  campfire("village_fire", 52, 69);

  const workbench = pc(57.5, 71);
  prop({
    id: "workbench",
    type: "workbench",
    x: workbench.x,
    y: workbench.y,
    r: 13,
    solid: true,
    shape: "circle",
    interact: { kind: "workbench" },
    sort: workbench.y,
  });
  reserve(57.5, 71, 2);

  prop({
    id: "village_well",
    type: "well",
    x: pc(48, 73).x,
    y: pc(48, 73).y,
    r: 16,
    solid: true,
    shape: "circle",
    sort: pc(48, 73).y,
  });
  reserve(48, 73, 2);

  // лавка Ворона
  const stall = pc(60, 64);
  prop({
    id: "shop_stall",
    type: "shopStall",
    x: stall.x,
    y: stall.y,
    w: 5 * TILE,
    h: 2.8 * TILE,
    solid: true,
    shape: "rect",
    sort: stall.y + TILE * 1.4,
  });
  reserve(60, 64, 4);
  prop({
    id: "shop_crate",
    type: "crate",
    x: pc(63.2, 66).x,
    y: pc(63.2, 66).y,
    w: 1.2 * TILE,
    h: 1.2 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(63.2, 66).y,
  });
  prop({
    id: "notice_board",
    type: "board",
    x: pc(63.5, 70).x,
    y: pc(63.5, 70).y,
    w: 1.8 * TILE,
    h: 1.3 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(63.5, 70).y,
  });
  prop({
    id: "village_barrel",
    type: "barrel",
    x: pc(56.5, 65.4).x,
    y: pc(56.5, 65.4).y,
    r: 9,
    solid: true,
    shape: "circle",
    sort: pc(56.5, 65.4).y,
  });

  /* ---------- следы истории ---------- */
  prop({
    id: "clue_lantern",
    type: "clueLantern",
    x: pc(48.5, 56.7).x,
    y: pc(48.5, 56.7).y,
    r: 9,
    solid: false,
    shape: "circle",
    interact: { kind: "clue", key: "lantern" },
    sort: pc(48.5, 56.7).y,
  });
  prop({
    id: "clue_ribbon",
    type: "clueRibbon",
    x: pc(62.4, 66.3).x,
    y: pc(62.4, 66.3).y,
    r: 8,
    solid: false,
    shape: "circle",
    interact: { kind: "clue", key: "ribbon" },
    sort: pc(62.4, 66.3).y,
  });
  prop({
    id: "clue_tracks",
    type: "tracks",
    x: pc(96, 49).x,
    y: pc(96, 49).y,
    r: 12,
    solid: false,
    shape: "circle",
    interact: { kind: "clue", key: "tracks" },
    sort: pc(96, 49).y,
  });

  /* ---------- лагерь охотника ---------- */
  prop({
    id: "hunter_tent",
    type: "tent",
    x: pc(85.5, 64).x,
    y: pc(85.5, 64).y,
    w: 3.2 * TILE,
    h: 2.4 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(85.5, 64).y + TILE,
  });
  reserve(85.5, 64, 3);
  campfire("hunter_fire", 81, 68);
  prop({
    id: "hunter_rack",
    type: "rack",
    x: pc(88.5, 68).x,
    y: pc(88.5, 68).y,
    w: 1.6 * TILE,
    h: 1.6 * TILE,
    solid: false,
    shape: "rect",
    sort: pc(88.5, 68).y,
  });

  /* ---------- дерево имён ---------- */
  prop({
    id: "name_tree",
    type: "nameTree",
    x: pc(19, 73).x,
    y: pc(19, 73).y,
    r: 27,
    solid: true,
    shape: "circle",
    interact: { kind: "dialogue", script: "nameTree" },
    sort: pc(19, 73).y,
  });
  reserve(19, 73, 4);

  /* ---------- мельница ---------- */
  prop({
    id: "old_mill",
    type: "mill",
    x: pc(22, 105).x,
    y: pc(22, 105).y,
    w: 5 * TILE,
    h: 5.2 * TILE,
    solid: true,
    shape: "rect",
    sort: pc(22, 105).y + TILE * 2.2,
  });
  reserve(22, 105, 5);
  prop({
    id: "millstone",
    type: "millstone",
    x: pc(29.8, 105).x,
    y: pc(29.8, 105).y,
    r: 13,
    solid: true,
    shape: "circle",
    sort: pc(29.8, 105).y,
  });
  reserve(29.8, 105, 2);
  prop({
    id: "note_mill",
    type: "note",
    x: pc(31.5, 101).x,
    y: pc(31.5, 101).y,
    r: 9,
    solid: false,
    shape: "circle",
    interact: { kind: "dialogue", script: "noteMill" },
    sort: pc(31.5, 101).y,
  });
  prop({
    id: "beacon_mill",
    type: "beacon",
    x: pc(34, 108).x,
    y: pc(34, 108).y,
    r: 10,
    solid: true,
    shape: "circle",
    interact: { kind: "beacon" },
    sort: pc(34, 108).y,
  });
  reserve(34, 108, 2);

  /* ---------- соляная топь ---------- */
  campfire("salt_fire", 164, 101);
  hut(150, 89, 4, 3);
  hut(176, 96, 4, 3);
  prop({
    id: "ferry_boat",
    type: "boat",
    x: pc(187, 109).x,
    y: pc(187, 109).y,
    r: 13,
    solid: false,
    shape: "circle",
    sort: pc(187, 109).y,
  });
  for (const [hx, hy] of [[148, 88], [170, 104], [184, 96]]) {
    prop({
      id: `herb_${hx}_${hy}`,
      type: "herb",
      x: pc(hx, hy).x,
      y: pc(hx, hy).y,
      r: 8,
      solid: false,
      shape: "circle",
      interact: { kind: "herb" },
      sort: pc(hx, hy).y,
    });
    reserve(hx, hy, 2);
  }
  prop({
    id: "note_marsh",
    type: "note",
    x: pc(152, 110).x,
    y: pc(152, 110).y,
    r: 9,
    solid: false,
    shape: "circle",
    interact: { kind: "dialogue", script: "noteMarsh" },
    sort: pc(152, 110).y,
  });

  /* ---------- курганы ---------- */
  prop({
    id: "note_barrow",
    type: "grave",
    x: pc(90, 130).x,
    y: pc(90, 130).y,
    r: 9,
    solid: false,
    shape: "circle",
    interact: { kind: "dialogue", script: "noteBarrow" },
    sort: pc(90, 130).y,
  });
  prop({
    id: "beacon_barrow",
    type: "beacon",
    x: pc(122, 130).x,
    y: pc(122, 130).y,
    r: 10,
    solid: true,
    shape: "circle",
    interact: { kind: "beacon" },
    sort: pc(122, 130).y,
  });
  reserve(122, 130, 2);
  for (const [gx, gy] of [[84, 119], [95, 119], [108, 117], [120, 124], [100, 134], [118, 135]]) {
    prop({
      id: `barrow_stone_${gx}_${gy}`,
      type: "gravestone",
      x: pc(gx, gy).x,
      y: pc(gx, gy).y,
      r: 8,
      solid: false,
      shape: "circle",
      sort: pc(gx, gy).y,
    });
  }

  /* ---------- пещера ---------- */
  prop({
    id: "daughter_cage",
    type: "cage",
    x: pc(177, 29).x,
    y: pc(177, 29).y,
    w: 3 * TILE,
    h: 3 * TILE,
    solid: true,
    shape: "rect",
    interact: { kind: "cage" },
    sort: pc(177, 29).y + TILE,
  });
  reserve(177, 29, 4);
  prop({
    id: "note_cave",
    type: "note",
    x: pc(151, 37).x,
    y: pc(151, 37).y,
    r: 9,
    solid: false,
    shape: "circle",
    interact: { kind: "dialogue", script: "noteCave" },
    sort: pc(151, 37).y,
  });
  prop({
    id: "beacon_ridge",
    type: "beacon",
    x: pc(166, 45).x,
    y: pc(166, 45).y,
    r: 10,
    solid: true,
    shape: "circle",
    interact: { kind: "beacon" },
    sort: pc(166, 45).y,
  });
  reserve(166, 45, 2);
  for (const [tx, ty] of [[146, 18], [158, 18], [146, 28], [162, 28], [172, 24], [174, 34], [160, 40], [176, 44], [170, 49]]) {
    prop({
      id: `torch_${tx}_${ty}`,
      type: "torch",
      x: pc(tx, ty).x,
      y: pc(tx, ty).y,
      r: 7,
      solid: false,
      shape: "circle",
      sort: pc(tx, ty).y,
    });
  }
  prop({
    id: "cave_bones",
    type: "bones",
    x: pc(157, 38).x,
    y: pc(157, 38).y,
    r: 10,
    solid: false,
    shape: "circle",
    sort: pc(157, 38).y,
  });

  /* ---------- случайные деревья и камни ---------- */
  const placeProp = (type, tx, ty, rngValue) => {
    if (tx < 5 || ty < 5 || tx >= MAP_W - 5 || ty >= MAP_H - 5) return false;
    const tile = get(tx, ty);
    if (tile !== T.HEATHER && tile !== T.ASH && tile !== T.MOSS) return false;
    if (reserved[idx(tx, ty)]) return false;
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
  for (let i = 0; i < 1400 && placed < 430; i++) {
    const tx = 5 + Math.floor(rng() * (MAP_W - 10));
    const ty = 5 + Math.floor(rng() * (MAP_H - 10));
    const r = rng();
    const type = r < 0.45 ? "tree" : r < 0.78 ? "rock" : "bush";
    if (placeProp(type, tx, ty, rng())) placed++;
  }

  /* ---------- NPC ---------- */
  const npc = (id, name, dialogue, tx, ty, color, cloak) => {
    const pos = pc(tx, ty);
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
  npc("irma", "Ирма", "irma", 46, 61.5, "#d8c7a1", "#4b3d32");
  npc("merchant", "Ворон", "merchant", 60, 67.2, "#b6a7c7", "#2e2a3c");
  npc("hunter", "Раненый охотник", "hunter", 83, 68.5, "#b9a58c", "#3d4232");
  npc("mila", "Знахарка Мила", "mila", 158, 96, "#bfd2ae", "#38483a");
  npc("garm", "Перевозчик Гарм", "garm", 182, 106, "#b8b0a0", "#343b46");
  npc("ada", "Могильщица Ада", "ada", 102, 124, "#c4b8a8", "#3f3a3a");
  npc("hermit", "Отшельник Каль", "hermit", 170, 56, "#c0c8d8", "#30323e");
  npc("miller", "Мельник Тихон", "miller", 27.5, 108, "#cbb79c", "#443b32");

  /* ---------- места силы ---------- */
  landmarks.home = { x: pc(52, 47).x, y: pc(52, 47).y, label: "Дом" };
  landmarks.bedroom = { x: pc(53, 42).x, y: pc(53, 42).y, label: "Детская" };
  landmarks.irma = { x: pc(46, 61.5).x, y: pc(46, 61.5).y, label: "Ирма" };
  landmarks.shop = { x: pc(60, 65).x, y: pc(60, 65).y, label: "Лавка Ворона" };
  landmarks.campfire = { x: pc(52, 69).x, y: pc(52, 69).y, label: "Последний Очаг" };
  landmarks.workbench = { x: workbench.x, y: workbench.y, label: "Верстак" };
  landmarks.hunter = { x: pc(83, 68).x, y: pc(83, 68).y, label: "Лагерь охотника" };
  landmarks.nameTree = { x: pc(19, 73).x, y: pc(19, 73).y, label: "Дерево Имён" };
  landmarks.mill = { x: pc(22, 105).x, y: pc(22, 105).y, label: "Вересковая мельница" };
  landmarks.saltMarsh = { x: pc(164, 98).x, y: pc(164, 98).y, label: "Соляная топь" };
  landmarks.ferry = { x: pc(182, 106).x, y: pc(182, 106).y, label: "Перевоз" };
  landmarks.barrows = { x: pc(102, 124).x, y: pc(102, 124).y, label: "Курганы" };
  landmarks.cave = { x: pc(162, 57).x, y: pc(162, 57).y, label: "Серые скалы" };
  landmarks.boss = { x: pc(154, 24).x, y: pc(154, 24).y, label: "Серый Похититель" };
  landmarks.cage = { x: pc(177, 29).x, y: pc(177, 29).y, label: "Клетка" };
  landmarks.clueLantern = { x: pc(48.5, 56.7).x, y: pc(48.5, 56.7).y, label: "Фонарь" };
  landmarks.clueRibbon = { x: pc(62.4, 66.3).x, y: pc(62.4, 66.3).y, label: "Лента" };
  landmarks.clueTracks = { x: pc(96, 49).x, y: pc(96, 49).y, label: "Следы" };
  landmarks.stairs = { x: pc(53, 45).x, y: pc(53, 45).y, label: "Лестница" };
  landmarks.homeHearth = { x: pc(45.3, 47.3).x, y: pc(45.3, 47.3).y, label: "Очаг" };
  landmarks.bed = { x: pc(50, 41.5).x, y: pc(50, 41.5).y, label: "Постель" };
  landmarks.table = { x: pc(50, 49.5).x, y: pc(50, 49.5).y, label: "Стол" };

  /* ---------- области ---------- */
  const regions = {
    home: { x0: 42 * TILE, y0: 37 * TILE, x1: 63 * TILE, y1: 56 * TILE, label: "Дом" },
    village: { x0: 32 * TILE, y0: 54 * TILE, x1: 75 * TILE, y1: 83 * TILE, label: "Деревня" },
    camp: { x0: 73 * TILE, y0: 56 * TILE, x1: 93 * TILE, y1: 77 * TILE, label: "Лагерь" },
    nameTree: { x0: 8 * TILE, y0: 62 * TILE, x1: 32 * TILE, y1: 85 * TILE, label: "Дерево Имён" },
    mill: { x0: 9 * TILE, y0: 90 * TILE, x1: 42 * TILE, y1: 122 * TILE, label: "Мельница" },
    marsh: { x0: 141 * TILE, y0: 76 * TILE, x1: 192 * TILE, y1: 118 * TILE, label: "Соляная топь" },
    barrows: { x0: 76 * TILE, y0: 102 * TILE, x1: 133 * TILE, y1: 140 * TILE, label: "Курганы" },
    cave: { x0: 136 * TILE, y0: 6 * TILE, x1: 190 * TILE, y1: 60 * TILE, label: "Серые скалы" },
    bossArena: { x0: 142 * TILE, y0: 16 * TILE, x1: 168 * TILE, y1: 34 * TILE, label: "Арена" },
  };

  /* ---------- зоны врагов ---------- */
  const spawnZone = (tx, ty, type, count, radius = 4) => {
    spawns.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, type, count, radius: radius * TILE });
    reserve(tx, ty, Math.ceil(radius));
  };
  spawnZone(26, 60, "hollow", 3, 4);
  spawnZone(14, 80, "weeper", 2, 3);
  spawnZone(66, 87, "hollow", 3, 3);
  spawnZone(90, 56, "hound", 3, 3);
  spawnZone(20, 96, "wisp", 3, 4);
  spawnZone(32, 116, "hound", 2, 3);
  spawnZone(58, 94, "hollow", 2, 3);
  spawnZone(86, 86, "hound", 2, 3);
  spawnZone(110, 52, "hound", 3, 3);
  spawnZone(132, 42, "grey", 2, 3);
  spawnZone(88, 114, "barrow", 3, 3);
  spawnZone(112, 126, "barrow", 3, 3);
  spawnZone(124, 116, "hollow", 2, 3);
  spawnZone(150, 86, "wisp", 3, 3);
  spawnZone(174, 90, "crawler", 3, 3);
  spawnZone(160, 110, "wisp", 2, 3);
  spawnZone(160, 38, "crawler", 3, 3);
  spawnZone(148, 35, "grey", 2, 3);
  // Похититель ждёт в глубине арены
  spawns.push({ x: pc(154, 24).x, y: pc(154, 24).y, type: "boss", count: 1, radius: TILE * 2, fixed: true, boss: true });
  reserve(154, 24, 4);

  /* ---------- пространственная сетка твёрдых объектов ---------- */
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
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * radius;
      const nx = x + Math.cos(a) * d;
      const ny = y + Math.sin(a) * d;
      if (!isBlocked(nx, ny, 12)) return { x: nx, y: ny };
    }
    return { x, y };
  }

  function inRegion(name, x, y) {
    const r = regions[name];
    if (!r) return false;
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  }

  return {
    width: MAP_W,
    height: MAP_H,
    tiles,
    props,
    npcs,
    spawns,
    landmarks,
    regions,
    tileAt,
    isBlocked,
    moveEntity,
    randomWalkableNear,
    inRegion,
    seed,
  };
}
