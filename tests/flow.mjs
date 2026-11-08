/*
 * Сюжетный прогон v0.4: полный путь от вечера в детской до затушенной
 * свечи, плюс магазин, боковые квесты, автосейв и масштабирование босса.
 */
import { World } from "../public/js/world.js";
import { ENEMY_TYPES, QUEST_MAIN, SHOP_ITEMS } from "../public/js/data.js";

let failed = 0;
function check(ok, label, extra = "") {
  if (ok) {
    console.log("ok", label);
    return;
  }
  failed++;
  console.error("FAIL", label, extra);
}

const w = new World({ seed: 1 });
const p = w.addPlayer("host", "Тест", "lantern");
p.invuln = 999;

const npc = (id) => w.npcs.find((n) => n.id === id || n.dialogue === id);
const go = (x, y) => {
  p.x = x;
  p.y = y;
  p.interactCd = 0;
};
const goLandmark = (name) => {
  const l = w.map.landmarks[name];
  go(l.x, l.y);
};
const interact = () => {
  p.talking = false;
  p.dialogue = null;
  p.interactCd = 0;
  w.tryInteract(p);
};

/* ---------- пролог: вечер, сказка, похищение ---------- */

check(w.quest.main.stage === 0, "старт на стадии 0");
check(w.daughter.state === "home", "Лира дома в начале");

goLandmark("bed");
interact();
check(p.dialogueView?.nodeId === "intro", "постель открывает вечернюю сцену");
check(p.dialogueView?.speaker === "Лира", "говорит Лира");

w.chooseDialogue(p, 0); // сказка
check(p.dialogueView?.nodeId === "story", "сказка про фонарщика");
w.chooseDialogue(p, 0); // продолжение
check(p.dialogueView?.nodeId === "story2", "сказка про девочку");
w.chooseDialogue(p, 0); // к постели
check(p.dialogueView?.nodeId === "tuck", "сцена укладывания");
w.chooseDialogue(p, 0); // укрыть одеялом -> kidnap
check(w.quest.main.stage === 1, "похищение двигает сюжет на стадию 1");
check(w.daughter.state === "cage", "Лира в клетке");
check(w.flags.kidnapDone, "флаг похищения");
check(p.dialogueView?.nodeId === "dark", "показана сцена удара");
w.endDialogue(p);

/* ---------- три следа ---------- */

for (const [name, label] of [
  ["clueLantern", "фонарь"],
  ["clueRibbon", "лента"],
  ["clueTracks", "колея"],
]) {
  goLandmark(name);
  interact();
  check(w.flags.cluesFound > 0, `след найден: ${label}`);
}

check(w.flags.cluesFound === 3, "все три следа собраны");
check(w.quest.main.stage === 2, "следы ведут к мельнице");

/* ---------- мельник и пещера ---------- */

const miller = npc("miller");
go(miller.x + 8, miller.y);
interact();
check(p.dialogueView?.nodeId === "daughter", "мельник говорит о Лире");
w.chooseDialogue(p, 0); // куда именно
check(p.dialogueView?.nodeId === "cave", "мельник указывает на скалы");
w.chooseDialogue(p, 0); // идти -> millClue
check(w.quest.main.stage === 3, "цель — пещера");
w.endDialogue(p);

/* ---------- босс: масштабирование по числу игроков ---------- */

check(!!w.boss, "босс создан");
check(w.boss.dormant, "босс ждёт игроков");
const soloHp = w.boss.maxHp;
check(soloHp === ENEMY_TYPES.boss.hp, "соло-HP босса базовый");

const p2 = w.addPlayer("bro", "Брат", "ember");
p2.invuln = 999;
const duoHp = w.boss.maxHp;
check(duoHp === Math.round(ENEMY_TYPES.boss.hp * 1.65), "HP босса растёт на двоих");
check(w.boss.damage === Math.round(ENEMY_TYPES.boss.damage * 1.2), "урон босса растёт на двоих");

/* ---------- победа и спасение ---------- */

w.damageEnemy(w.boss, w.boss.hp + 999, p);
check(w.flags.bossDead, "похититель повержен");
check(w.quest.main.stage === 4, "клетка открыта");

goLandmark("cage");
interact();
check(p.dialogueView?.nodeId === "intro", "клетка открывает диалог спасения");
w.chooseDialogue(p, 0); // сломать замок -> rescueDaughter
check(w.quest.main.stage === 5, "Лира идёт за героем");
check(w.daughter.state === "following", "дочь следует");
w.endDialogue(p);

/* ---------- домой, накормить, уложить ---------- */

goLandmark("home");
w.daughter.x = w.map.landmarks.home.x + 12;
w.daughter.y = w.map.landmarks.home.y + 12;
w.updateStory();
check(w.quest.main.stage === 6, "дома Лира садится за стол");
check(w.daughter.state === "table", "дочь за столом");

goLandmark("table");
interact();
check(p.dialogueView?.nodeId === "intro", "стол открывает сцену кормления");
w.chooseDialogue(p, 0); // съешь всё -> feedDaughter
check(w.quest.main.stage === 7, "Лира накормлена");
w.endDialogue(p);

goLandmark("bed");
interact();
check(p.dialogueView?.nodeId === "intro", "постель открывает сцену укладывания");
w.chooseDialogue(p, 0); // буду рядом -> tuckIn
check(w.quest.main.stage === 8, "Лира уснула");
check(w.flags.daughterTucked, "флаг укрытой дочери");

// Ветка stage>=8 должна открываться — раньше её съедал stage>=7.
goLandmark("bed");
interact();
check(p.dialogueView?.nodeId === "after", "после финала постель говорит 'after'");
w.endDialogue(p);

/* ---------- финал ---------- */

w.startDialogue(p, "tuck", "asleep");
w.chooseDialogue(p, 0); // погасить свечу -> finishStory
check(!!w.flags.ending, "история завершена");
check(w.events.some((e) => e.type === "ending"), "событие концовки отправлено");

/* ---------- магазин ---------- */

const shopper = w.addPlayer("shopper", "Покупатель", "ember");
shopper.coins = 5000;
shopper.shopOpen = true;
const beforeDmg = w.weaponDamage(shopper);
w.buyItem(shopper, "kitchen_knife");
check(shopper.equipment.weapon === "kitchen_knife", "нож куплен и надет");
check(w.weaponDamage(shopper) > beforeDmg, "нож добавил урон");
const coinsAfterKnife = shopper.coins;
check(coinsAfterKnife === 5000 - SHOP_ITEMS.kitchen_knife.price, "монеты списаны по цене");

w.buyItem(shopper, "grey_aegis");
check(shopper.equipment.armor === "grey_aegis", "броня куплена и надета");
check(shopper.damageReduce > 0, "броня даёт защиту");
check(SHOP_ITEMS.grey_aegis.price > SHOP_ITEMS.kitchen_knife.price, "цены растут вместе со статами");

/* ---------- автосейв ---------- */

const save = w.serialize("host");
check(save?.version === 2, "сейв версии 2");
check(save.quest.main.stage >= 8, "в сейве финальная стадия");
const w2 = new World({ seed: save.seed });
check(w2.restoreSave(save, "host"), "сейв восстанавливается");
check(w2.quest.main.stage === save.quest.main.stage, "стадия восстановлена");
check(w2.flags.ending === save.flags.ending, "концовка восстановлена");
check(w2.daughter.state === save.daughter.state, "состояние дочери восстановлено");
check(w2.players.get("host").coins >= 0, "игрок восстановлен");

/* ---------- спавн вне поля зрения ---------- */

const w3 = new World({ seed: 7 });
w3.setViewport(1920, 1080, 0.82);
const viewer = w3.addPlayer("viewer", "Зритель", "lantern");
viewer.x = w3.map.landmarks.home.x;
viewer.y = w3.map.landmarks.home.y;
const half = w3.viewHalf();
check(!w3.canSpawnAt(viewer.x + half.x - 10, viewer.y, 14), "внутри экрана спавн запрещён");
check(!w3.canSpawnAt(viewer.x, viewer.y + half.y - 10, 14), "по вертикали тоже запрещён");
check(w3.canSpawnAt(viewer.x + half.x + 40, viewer.y, 14), "за краем экрана спавн разрешён");

let inside = 0;
for (const zone of w3.zones) {
  const point = w3.pickZonePoint(zone);
  if (!point) continue;
  if (Math.abs(point.x - viewer.x) < half.x && Math.abs(point.y - viewer.y) < half.y) inside++;
}
check(inside === 0, "ни одна зона не ставит врага в кадр");

/* ---------- итог ---------- */

if (failed) {
  console.error(`\n${failed} проверок упало`);
  process.exit(1);
}
console.log(`\nвсе проверки прошли · ${Object.keys(QUEST_MAIN.stages).length} стадий сюжета`);
