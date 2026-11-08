/* Пепел и Вереск v0.4 — карта: связность, NPC, объекты, арена босса */
import { World } from "../public/js/world.js";

const TILE = 32;
const STEP = 8;
const PLAYER_RADIUS = 8;

let failed = 0;
function check(ok, label, extra = "") {
  if (ok) {
    console.log("ok", label);
    return;
  }
  failed++;
  console.error("FAIL", label, extra);
}

/* Волновой поиск по проходимым точкам от места появления игрока. */
function buildReach(world) {
  const map = world.map;
  const W = Math.floor((map.width * TILE) / STEP);
  const H = Math.floor((map.height * TILE) / STEP);
  const key = (x, y) => y * W + x;

  const walkable = new Uint8Array(W * H);
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      walkable[key(gx, gy)] = map.isBlocked(gx * STEP, gy * STEP, PLAYER_RADIUS) ? 0 : 1;
    }
  }

  const spawn = world.addPlayer("map", "Проверка", "lantern");
  const seen = new Uint8Array(W * H);
  const start = key(Math.round(spawn.x / STEP), Math.round(spawn.y / STEP));
  const queue = [start];
  seen[start] = 1;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    const x = cell % W;
    const y = (cell / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const next = key(nx, ny);
      if (seen[next] || !walkable[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  function nearest(x, y, maxRange) {
    let best = Infinity;
    const radius = Math.ceil(maxRange / STEP) + 1;
    const cx = Math.round(x / STEP);
    const cy = Math.round(y / STEP);
    for (let gy = cy - radius; gy <= cy + radius; gy++) {
      for (let gx = cx - radius; gx <= cx + radius; gx++) {
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        if (!seen[key(gx, gy)]) continue;
        const d = Math.hypot(gx * STEP - x, gy * STEP - y);
        if (d < best) best = d;
      }
    }
    return best;
  }

  return nearest;
}

const SEEDS = [1, 7, 20261107];
const LANDMARKS = [
  ["home", 80],
  ["bedroom", 90],
  ["stairs", 90],
  ["irma", 80],
  ["shop", 80],
  ["campfire", 80],
  ["workbench", 80],
  ["hunter", 90],
  ["nameTree", 80],
  ["mill", 100],
  ["saltMarsh", 100],
  ["ferry", 80],
  ["barrows", 100],
  ["cave", 100],
  ["boss", 110],
  ["cage", 90],
  ["bed", 90],
  ["table", 90],
];

for (const seed of SEEDS) {
  const world = new World({ seed });
  const nearest = buildReach(world);

  check(world.map.width >= 200 && world.map.height >= 144, `seed ${seed}: карта не меньше 200×144`);

  for (const npc of world.npcs) {
    const range = 70;
    check(nearest(npc.x, npc.y, range) < range, `seed ${seed}: NPC ${npc.id} доступен`);
  }

  for (const prop of world.map.props) {
    if (!prop.interact) continue;
    const range = 70 + (prop.r || Math.max(prop.w || 0, prop.h || 0) * 0.5) * 0.4;
    check(nearest(prop.x, prop.y, range) < range, `seed ${seed}: объект ${prop.id} доступен`);
  }

  for (const [name, range] of LANDMARKS) {
    const point = world.map.landmarks[name];
    check(!!point, `seed ${seed}: ориентир ${name} существует`);
    if (!point) continue;
    check(nearest(point.x, point.y, range) < range, `seed ${seed}: до ${name} можно дойти`);
  }

  // Двухэтажный дом: постель наверху и стол внизу — разные области карты.
  const bed = world.map.landmarks.bed;
  const table = world.map.landmarks.table;
  check(Math.abs(bed.y - table.y) > TILE * 3, `seed ${seed}: спальня отделена от столовой`);

  // Зоны спавна должны быть на проходимой земле и не пересекаться с домом.
  for (const zone of world.zones) {
    check(!world.map.isBlocked(zone.x, zone.y, 20), `seed ${seed}: зона ${zone.id} на земле`);
    check(!world.map.inRegion("home", zone.x, zone.y), `seed ${seed}: зона ${zone.id} вне дома`);
  }

  // Босс стоит в арене и ждёт, пока его разбудят.
  check(!!world.boss, `seed ${seed}: босс на карте`);
  check(world.boss.dormant, `seed ${seed}: босс спит до подхода`);
  check(world.map.inRegion("bossArena", world.boss.x, world.boss.y), `seed ${seed}: босс в арене`);

  // Пещера — отдельная область со своей ареной.
  check(!!world.map.landmarks.cave, `seed ${seed}: пещера отмечена`);
  check(
    world.map.inRegion("cave", world.map.landmarks.cage.x, world.map.landmarks.cage.y),
    `seed ${seed}: клетка внутри пещеры`
  );
}

console.log(failed === 0 ? "map checks passed" : `${failed} map checks failed`);
process.exit(failed ? 1 : 0);
