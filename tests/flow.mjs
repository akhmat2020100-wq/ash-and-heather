import { World } from "../public/js/world.js";

let failed = 0;
function check(ok, label, extra = "") {
  if (!ok) {
    failed++;
    console.error("FAIL", label, extra);
  } else {
    console.log("ok", label);
  }
}

const w = new World({ seed: 1 });
const p = w.addPlayer("host", "Тест", "lantern");
p.x = 43.5 * 32;
p.y = 36.3 * 32;
p.invuln = 0;

w.tryInteract(p);
check(p.dialogueView?.nodeId === "intro", "Ирма открывает пролог");
console.log("dialogue", p.dialogueView?.nodeId, p.dialogueView?.speaker);
w.chooseDialogue(p, 2); // start main
check(w.quest.main.stage === 1, "квест начинается");
check(p.talking, "диалог не закрылся до конца текста");
console.log("stage after intro", w.quest.main.stage, "talking", p.talking);
w.endDialogue(p);

w.addEmber("loyalty", p);
w.addEmber("memory", p);
w.addEmber("peace", p);
check(w.flags.embers === 3, "три уголька собраны");
check(w.quest.main.stage === 2, "квест перешёл к возвращению");
console.log("embers", w.flags.embers, "stage", w.quest.main.stage);

p.x = 43.5 * 32;
p.y = 36.3 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "return", "Ирма ждёт у часовни");
console.log("irma node", p.dialogueView?.nodeId);
check(w.map.isBlocked(44 * 32, 17 * 32, 10), "дверь часовни запечатана");
w.chooseDialogue(p, 0); // начать обряд имён
check(w.flags.riteStarted, "Ирма просит собрать три имени");
check(!w.flags.chapelOpen, "дверь ещё запечатана без имён");

p.x = 104.5 * 32;
p.y = 45.5 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "rite", "Мила хранит первое имя");
w.chooseDialogue(p, 0);
check(w.flags.riteNames.mila, "имя Ильги сохранено");

p.x = 113.5 * 32;
p.y = 53.5 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "rite", "Гарм хранит второе имя");
w.chooseDialogue(p, 0);
check(w.flags.riteNames.garm, "имя Орена сохранено");

p.x = 72 * 32;
p.y = 80 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "rite", "Ада хранит третье имя");
w.chooseDialogue(p, 0);
check(w.flags.riteNames.ada, "имя Ивара сохранено");
check(w.flags.riteReady, "три имени собраны");
check(!w.flags.chapelOpen, "дверь ждёт имена у порога");
check(w.map.isBlocked(44 * 32, 17 * 32, 10), "дверь ещё запечатана");
check(w.quest.main.stage === 2, "квест всё ещё ведёт к дверям");

p.x = 44 * 32;
p.y = 18.5 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "rite", "дверь просит назвать имена");
w.chooseDialogue(p, 0); // назвать имена
check(w.flags.chapelOpen, "три имени открыли дверь часовни");
check(p.dialogueView?.nodeId === "open", "дверь открывается в часовню");
check(!w.map.isBlocked(44 * 32, 17 * 32, 10), "проход в часовню открыт");
check(w.quest.main.stage === 3, "квест перешёл к боссу");
w.chooseDialogue(p, 0); // закрыть диалог двери
check(!p.talking, "диалог у двери закрыт");
console.log("chapel", w.flags.chapelOpen, "stage", w.quest.main.stage);

p.x = 44 * 32;
p.y = 12 * 32;
w.update(0.016);
const boss = w.enemies.find((e) => e.boss);
check(!!boss?.active, "Плакальщик пробудился");
console.log("boss active", boss?.active, "flags", w.flags.bossActive);
if (boss) {
  boss.hp = 1;
  w.damageEnemy(boss, 999, p);
}
check(w.flags.bossDead, "Плакальщик побеждён");
check(w.quest.main.stage === 4, "квест перешёл к Сердцу");
console.log("bossDead", w.flags.bossDead, "stage", w.quest.main.stage, "pickups", w.pickups.map((x) => x.type));

const heart = w.pickups.find((x) => x.type === "heart");
check(!!heart, "Сердце Мглы выпало");
if (heart) {
  p.x = heart.x;
  p.y = heart.y;
  w.update(0.016);
}
check(w.flags.hasHeart, "Сердце Мглы подобрано");
check(w.quest.main.stage === 5, "квест перешёл к Ирме");
console.log("hasHeart", w.flags.hasHeart, "stage", w.quest.main.stage);

p.x = 43.5 * 32;
p.y = 36.3 * 32;
w.tryInteract(p);
check(p.dialogueView?.nodeId === "afterBoss", "Ирма предлагает финал");
console.log("irma after boss", p.dialogueView?.nodeId);
w.chooseDialogue(p, 0); // ending hope
check(p.dialogueView?.nodeId === "endingHope", "выбран финал надежды");
check(w.flags.pendingEnding === "hope", "финал надежды ожидает подтверждения");
console.log("ending node", p.dialogueView?.nodeId, "pending", w.flags.pendingEnding);
w.chooseDialogue(p, 0); // finish
check(w.flags.ending === "hope", "финал надежды записан");
check(w.quest.main.stage === 6, "глава завершена");
check(!p.talking, "диалог закрыт после финала");
console.log("ending", w.flags.ending, "stage", w.quest.main.stage, "talking", p.talking);

/* --- второй финал --- */
const w2 = new World({ seed: 2 });
const p2 = w2.addPlayer("p2", "Второй", "hunter");
w2.flags.hasHeart = true;
w2.flags.bossDead = true;
w2.quest.main.stage = 5;
p2.x = 43.5 * 32;
p2.y = 36.3 * 32;
w2.tryInteract(p2);
check(p2.dialogueView?.nodeId === "afterBoss", "второй финал доступен");
w2.chooseDialogue(p2, 1); // ending power
check(w2.flags.pendingEnding === "power", "финал силы ожидает подтверждения");
w2.chooseDialogue(p2, 0);
check(w2.flags.ending === "power", "финал силы записан");
check(w2.quest.main.stage === 6, "второй финал завершает главу");

/* --- побочные квесты --- */
const w3 = new World({ seed: 3 });
const p3 = w3.addPlayer("p3", "Третий", "lantern");
p3.x = 12 * 32;
p3.y = 33 * 32;
w3.tryInteract(p3);
check(p3.dialogueView?.nodeId === "intro", "Дерево Имён отвечает");
const hpBefore = p3.maxHp;
w3.chooseDialogue(p3, 1); // вернуть имя
check(w3.flags.nameChoice === "return", "имя возвращено миру");
check(p3.maxHp === hpBefore + 10, "возврат имени даёт здоровье");
check(w3.flags.emberKinds.memory, "уголёк памяти получен у дерева");
w3.chooseDialogue(p3, 0); // закрыть диалог дерева
check(!p3.talking, "диалог дерева закрыт");

p3.x = 38.5 * 32;
p3.y = 31.5 * 32;
p3.memory = Math.max(p3.memory, 40);
w3.tryInteract(p3);
check(p3.dialogueView?.nodeId === "intro", "Ворон начинает торг");
const hp2 = p3.maxHp;
w3.chooseDialogue(p3, 0); // обмен
check(w3.flags.merchantTrade, "сделка с Вороном состоялась");
check(p3.maxHp === hp2 + 15, "оберег увеличивает здоровье");
check(w3.quest.side.merchant === 2, "побочный квест торговца закрыт");
check(p3.dialogueView?.nodeId === "trade", "Ворон завершает сделку");
w3.chooseDialogue(p3, 0);
check(!p3.talking, "диалог с Вороном закрыт");

/* --- кооператив: подъём союзника --- */
const w5 = new World({ seed: 5 });
const a5 = w5.addPlayer("a5", "Первый", "lantern");
const b5 = w5.addPlayer("b5", "Второй", "hunter");
b5.invuln = 0;
w5.damagePlayer(b5, 9999, null);
check(b5.downed, "союзник падает");
a5.x = b5.x;
a5.y = b5.y;
a5.invuln = 99;
w5.tryInteract(a5);
check(a5.channeling && a5.reviveTargetId === b5.id, "подъём начат");
for (let i = 0; i < 40; i++) w5.update(0.05);
check(!b5.downed, "союзник поднят");
check(b5.hp > 0, "у поднятого есть здоровье");
check(a5.memory < 100, "подъём тратит память");

/* --- побочный квест охотника --- */
const w6 = new World({ seed: 6 });
const p6 = w6.addPlayer("p6", "Шестой", "hunter");
p6.x = 72.5 * 32;
p6.y = 38.5 * 32;
w6.tryInteract(p6);
check(p6.dialogueView?.nodeId === "intro", "Раненый охотник говорит");
w6.chooseDialogue(p6, 0); // отдать уголёк
check(w6.flags.emberKinds.loyalty, "уголёк верности получен");
check(w6.quest.side.hunter === 2, "охотник ждёт вести для Ирмы");
w6.chooseDialogue(p6, 0); // закрыть
check(!p6.talking, "диалог с охотником закрыт");
p6.x = 43.5 * 32;
p6.y = 36.3 * 32;
w6.tryInteract(p6);
check(p6.dialogueView?.nodeId === "hunterMessage", "Ирма ждёт вести");
const mem6 = p6.memory;
w6.chooseDialogue(p6, 0); // передать слова
check(w6.quest.side.hunter === 3, "вести переданы");
check(p6.memory === mem6 + 10 || p6.memory === p6.maxMemory, "память за весть");
w6.chooseDialogue(p6, 0);
check(!p6.talking, "диалог с Ирмой закрыт");

/* --- осколки и верстак --- */
const w7 = new World({ seed: 7 });
const p7 = w7.addPlayer("p7", "Седьмой", "hunter");
p7.x = 20 * 32;
p7.y = 20 * 32;
const victim = w7.spawnEnemy("hollow", p7.x + 48, p7.y, {});
check(!!victim, "враг для проверки осколков создан");
if (victim) w7.damageEnemy(victim, 9999, p7);
const shardDrop = w7.pickups.find((x) => x.type === "shard");
check(!!shardDrop, "с врага падает осколок");
if (shardDrop) {
  p7.x = shardDrop.x;
  p7.y = shardDrop.y;
  w7.update(0.016);
}
check(p7.shards > 0, "осколок подбирается в валюту");

p7.shards = 100;
p7.x = 47.5 * 32;
p7.y = 36.5 * 32;
w7.upgradeWeapon(p7, "damage");
check(p7.weapon.damage === 1, "прокачка урона покупается на верстаке");
check(p7.shards === 97, "прокачка списывает осколки");
const dmgLevel = p7.weapon.damage;
p7.x = 10 * 32;
p7.y = 10 * 32;
w7.upgradeWeapon(p7, "damage");
check(p7.weapon.damage === dmgLevel, "вдали от верстака прокачка недоступна");

/* --- травы, Мила и сигнальные огни --- */
const w8 = new World({ seed: 8 });
const p8 = w8.addPlayer("p8", "Восьмой", "lantern");
p8.x = 104.5 * 32;
p8.y = 45.5 * 32;
w8.tryInteract(p8);
check(p8.dialogueView?.nodeId === "intro", "Мила начинает разговор");
w8.chooseDialogue(p8, 0); // взять задание
check(w8.quest.side.herbs === 2, "квест Милы начат");
w8.chooseDialogue(p8, 0); // закрыть

for (const [hx, hy] of [[94, 48], [113, 42], [121, 54]]) {
  p8.x = hx * 32;
  p8.y = hy * 32;
  w8.tryInteract(p8);
}
check(w8.flags.herbs === 3, "три травы собраны");
check(Object.values(w8.flags.herbCollected).filter(Boolean).length === 3, "травы отмечены как собранные");
w8.tryInteract(p8); // повторно на последней траве
check(w8.flags.herbs === 3, "собранная трава не даёт бонус повторно");

p8.x = 104.5 * 32;
p8.y = 45.5 * 32;
w8.tryInteract(p8);
check(p8.dialogueView?.nodeId === "reward", "Мила ждёт три травы");
const shardsBeforeHerb = p8.shards;
w8.chooseDialogue(p8, 0); // принять дар
check(w8.quest.side.herbs === 3, "квест Милы завершён");
check(p8.shards === shardsBeforeHerb + 8, "Мила платит осколками");

const w9 = new World({ seed: 9 });
const p9 = w9.addPlayer("p9", "Девятый", "lantern");
p9.x = 27 * 32;
p9.y = 77 * 32;
w9.tryInteract(p9);
check(w9.flags.beacons === 1, "сигнальный огонь зажжён");
check(w9.flags.beaconsLit.mill === true, "огонь у мельницы отмечен");
w9.tryInteract(p9);
check(w9.flags.beacons === 1, "один и тот же огонь не считается дважды");

/* --- третий путь --- */
const w10 = new World({ seed: 10 });
const p10 = w10.addPlayer("p10", "Десятый", "lantern");
p10.x = 100.5 * 32;
p10.y = 16.5 * 32;
w10.tryInteract(p10);
check(p10.dialogueView?.nodeId === "intro", "Отшельник Каль говорит");
w10.chooseDialogue(p10, 0); // узнать правду
check(w10.flags.truthKnown === true, "правда об огне узнана");
check(w10.quest.side.truth === 2, "третий путь открыт");
w10.chooseDialogue(p10, 0); // truth -> truth2
w10.chooseDialogue(p10, 0); // закрыть
check(!p10.talking, "диалог с Калем закрыт");

w10.flags.hasHeart = true;
w10.flags.bossDead = true;
w10.quest.main.stage = 5;
p10.x = 43.5 * 32;
p10.y = 36.3 * 32;
w10.tryInteract(p10);
check(p10.dialogueView?.nodeId === "afterBoss", "Ирма предлагает третий путь");
w10.chooseDialogue(p10, 2);
check(p10.dialogueView?.nodeId === "endingTruth", "финал правды доступен");
check(w10.flags.pendingEnding === "truth", "финал правды ожидает подтверждения");
w10.chooseDialogue(p10, 0);
check(w10.flags.ending === "truth", "финал правды записан");
check(w10.quest.main.stage === 6, "третий финал завершает главу");

const w11 = new World({ seed: 11 });
const p11 = w11.addPlayer("p11", "Одиннадцатый", "lantern");
w11.flags.hasHeart = true;
w11.flags.bossDead = true;
w11.quest.main.stage = 5;
p11.x = 43.5 * 32;
p11.y = 36.3 * 32;
w11.tryInteract(p11);
w11.chooseDialogue(p11, 2);
check(p11.dialogueView?.nodeId === "noTruth", "без правды третий путь закрыт");
check(!w11.flags.pendingEnding, "без правды финал не записывается");

/* --- сохранение --- */
const saved = w3.serialize(p3.id);
check(!!saved && saved.version === 1, "состояние сериализуется");
const w4 = new World({ seed: saved.seed });
check(w4.restoreSave(saved, "host"), "состояние восстанавливается");
const p4 = w4.players.get("host");
check(!!p4 && p4.name === p3.name, "восстановлен игрок");
check(w4.flags.merchantTrade === true, "восстановлены флаги");
check(w4.flags.emberKinds.memory === true, "восстановлены угольки");

const saved8 = w8.serialize(p8.id);
const w12 = new World({ seed: saved8.seed });
check(w12.restoreSave(saved8, "host"), "сохранение с травами восстанавливается");
check(w12.flags.herbCollected.herb_94_48 === true, "восстановлены собранные травы");
check(w12.flags.herbs === 3, "восстановлен счётчик трав");

const saved7 = w7.serialize(p7.id);
const w13 = new World({ seed: saved7.seed });
check(w13.restoreSave(saved7, "host"), "сохранение с осколками восстанавливается");
const p13 = w13.players.get("host");
check(p13?.shards === 97, "восстановлены осколки");
check(p13?.weapon?.damage === 1, "восстановлена прокачка оружия");

const savedRite = w.serialize(p.id);
const w14 = new World({ seed: savedRite.seed });
check(w14.restoreSave(savedRite, "host"), "сохранение обряда восстанавливается");
check(
  w14.flags.riteNames?.mila === true && w14.flags.riteNames?.garm === true && w14.flags.riteNames?.ada === true,
  "восстановлены три имени обряда"
);
check(w14.flags.riteStarted === true && w14.flags.chapelOpen === true, "восстановлено открытие часовни");

if (failed) {
  console.error(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nall narrative checks passed");
