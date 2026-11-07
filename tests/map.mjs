/* Пепел и Вереск — проверка карты: доступность NPC, объектов и часовни */
import { World } from "../public/js/world.js";

const TILE = 32;
const STEP = 8;
const PLAYER_RADIUS = 10;
const NPC_RANGE = 58;

let failed = 0;
function check(ok, label, extra = "") {
  if (!ok) {
    failed++;
    console.error("FAIL", label, extra);
  } else {
    console.log("ok", label);
  }
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

for (const seed of SEEDS) {
  const world = new World({ seed });
  const nearest = buildReach(world);

  for (const npc of world.map.npcs) {
    check(nearest(npc.x, npc.y, NPC_RANGE) < NPC_RANGE, `seed ${seed}: NPC ${npc.id} доступен`);
  }

  // Руна лежит внутри часовни — её проверяем после открытия двери.
  for (const prop of world.map.props.filter((p) => p.interact && p.id !== "rune_38_12")) {
    const range = NPC_RANGE + (prop.r || 8) * 0.35;
    check(nearest(prop.x, prop.y, range) < range, `seed ${seed}: объект ${prop.id} доступен`);
  }

  const boss = { x: 44 * TILE, y: 9 * TILE };
  check(
    !Number.isFinite(nearest(boss.x, boss.y, 100)),
    `seed ${seed}: часовня запечатана до трёх угольков`
  );

  const opened = new World({ seed });
  opened.map.setChapelOpen(true);
  const openedNear = buildReach(opened);
  check(openedNear(boss.x, boss.y, 100) < 100, `seed ${seed}: Плакальщик достижим после двери`);
  check(openedNear(38 * TILE, 12 * TILE, 61.1) < 61.1, `seed ${seed}: руна в часовне доступна`);
}

console.log(failed === 0 ? "map checks passed" : `${failed} map checks failed`);
process.exit(failed ? 1 : 0);
