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
w.chooseDialogue(p, 0); // open chapel
check(w.flags.chapelOpen, "дверь часовни открыта");
check(!w.map.isBlocked(44 * 32, 17 * 32, 10), "проход в часовню открыт");
check(w.quest.main.stage === 3, "квест перешёл к боссу");
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

/* --- сохранение --- */
const saved = w3.serialize(p3.id);
check(!!saved && saved.version === 1, "состояние сериализуется");
const w4 = new World({ seed: saved.seed });
check(w4.restoreSave(saved, "host"), "состояние восстанавливается");
const p4 = w4.players.get("host");
check(!!p4 && p4.name === p3.name, "восстановлен игрок");
check(w4.flags.merchantTrade === true, "восстановлены флаги");
check(w4.flags.emberKinds.memory === true, "восстановлены угольки");

if (failed) {
  console.error(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nall narrative checks passed");
