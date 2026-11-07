const URL = process.env.WS_URL || "ws://127.0.0.1:8090/ws";

function waitFor(ws, pred, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error("timeout"));
    }, timeout);
    function onMsg(ev) {
      const msg = JSON.parse(String(ev.data));
      if (pred(msg)) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMsg);
        resolve(msg);
      }
    }
    ws.addEventListener("message", onMsg);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
  });
}

const host = await connect();
host.send(JSON.stringify({ t: "hello", role: "host", name: "Хост", cls: "lantern" }));
const hostWelcome = await waitFor(host, (m) => m.t === "welcome");
console.log("host welcome", hostWelcome.id, hostWelcome.role);

const client = await connect();
const joinP = waitFor(host, (m) => m.t === "join");
client.send(JSON.stringify({ t: "hello", role: "client", name: "Гость", cls: "hunter" }));
const clientWelcome = await waitFor(client, (m) => m.t === "welcome");
const join = await joinP;
console.log("client welcome", clientWelcome.id, "host saw join", join.id, join.name);

client.send(JSON.stringify({ t: "input", mx: 1, my: 0 }));
const input = await waitFor(host, (m) => m.t === "input");
console.log("input relayed", input.from === clientWelcome.id, input.mx, input.my);

client.send(JSON.stringify({ t: "action", action: "attack", data: {} }));
const action = await waitFor(host, (m) => m.t === "action");
console.log("action relayed", action.from === clientWelcome.id, action.action);

host.send(JSON.stringify({ t: "snap", seed: 42, snap: { players: [], t: 1.5 } }));
const snap = await waitFor(client, (m) => m.t === "snap");
console.log("snapshot relayed", snap.seed, snap.snap.t);

host.send(JSON.stringify({ t: "event", to: clientWelcome.id, type: "worldSeed", seed: 42 }));
const ev = await waitFor(client, (m) => m.t === "event");
console.log("targeted event", ev.type, ev.seed);

const leaveP = waitFor(host, (m) => m.t === "leave");
client.close();
const leave = await leaveP;
console.log("leave relayed", leave.id === clientWelcome.id);

const hostLeftP = new Promise((resolve) => {
  const c2 = new WebSocket(URL);
  c2.addEventListener("open", () => {
    c2.send(JSON.stringify({ t: "hello", role: "client", name: "Второй", cls: "lantern" }));
  });
  c2.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.t === "welcome") {
      globalThis.__c2 = c2;
    }
    if (msg.t === "hostLeft") resolve(msg);
  });
});
await new Promise((r) => setTimeout(r, 200));
host.close();
const hl = await hostLeftP;
console.log("hostLeft", hl.message);
globalThis.__c2?.close();

process.exit(0);
