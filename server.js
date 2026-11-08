/* Пепел и Вереск — LAN relay + static server (Bun) */
import { networkInterfaces } from "node:os";
import { join, normalize, extname } from "node:path";
import dgram from "node:dgram";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = join(import.meta.dir, "public");
const MAX_PLAYERS = 4;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
};

/** @type {Map<string, {ws: any, role: "host"|"client", name: string, cls: string}>} */
const peers = new Map();
let hostId = null;
let nextId = 1;

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    if (process.env.DEBUG_RELAY) console.error("[relay] send failed", err?.message);
  }
}

function broadcast(obj, exceptId = null) {
  for (const [id, p] of peers) {
    if (id === exceptId) continue;
    send(p.ws, obj);
  }
}

function hostPeer() {
  return hostId ? peers.get(hostId) : null;
}

function playerList() {
  return [...peers.entries()].map(([id, p]) => ({
    id,
    role: p.role,
    name: p.name,
    cls: p.cls,
  }));
}

let cachedLan = [];

function lanAddresses() {
  const out = [];
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) out.push(n.address);
      }
    }
  } catch {
    // Android sandboxes may deny getifaddrs; fall back to a UDP route probe.
  }
  for (const ip of cachedLan) {
    if (!out.includes(ip)) out.push(ip);
  }
  return out;
}

function probeLocalAddress() {
  return new Promise((resolve) => {
    let done = false;
    let sock;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { sock?.close(); } catch {}
      resolve(value);
    };
    try {
      sock = dgram.createSocket("udp4");
      sock.on("error", () => finish(null));
      sock.connect(53, "8.8.8.8", () => {
        try {
          const addr = sock.address();
          finish(addr?.address && !addr.address.startsWith("127.") ? addr.address : null);
        } catch {
          finish(null);
        }
      });
      setTimeout(() => finish(null), 900);
    } catch {
      finish(null);
    }
  });
}

async function discoverLan() {
  const ip = await probeLocalAddress();
  if (ip) cachedLan = [ip];
  return lanAddresses();
}

async function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  // prevent traversal
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT + "/") && filePath !== ROOT) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  const headers = {
    "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  };
  return new Response(file, { headers });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = srv.upgrade(req, {
        data: { id: String(nextId++), role: null, name: "", cls: "" },
      });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/api/status") {
      return Response.json({
        host: !!hostId,
        players: playerList(),
        maxPlayers: MAX_PLAYERS,
        port: PORT,
        wsPort: PORT,
        lan: lanAddresses(),
        version: "0.2.0",
      }, {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      // wait for hello; don't register yet
    },
    message(ws, raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;
      const id = ws.data.id;

      if (msg.t === "hello") {
        if (ws.data.role) return;
        const role = msg.role === "host" ? "host" : "client";
        const name = String(msg.name || "Странник").slice(0, 24);
        const cls = String(msg.cls || "lantern").slice(0, 24);
        if (role === "host" && hostId) {
          send(ws, { t: "error", code: "host_exists", message: "В этой сети уже есть открытая игра." });
          return;
        }
        if (role === "client" && !hostId) {
          send(ws, { t: "error", code: "no_host", message: "Хост ещё не создал игру." });
          return;
        }
        if (peers.size >= MAX_PLAYERS) {
          send(ws, { t: "error", code: "full", message: "Комната заполнена (максимум 4 игрока)." });
          return;
        }
        ws.data.role = role;
        ws.data.name = name;
        ws.data.cls = cls;
        peers.set(id, { ws, role, name, cls });
        if (role === "host") hostId = id;
        send(ws, {
          t: "welcome",
          id,
          role,
          hostId,
          players: playerList(),
          maxPlayers: MAX_PLAYERS,
        });
        if (role === "client") {
          const host = hostPeer();
          if (host) send(host.ws, { t: "join", id, name, cls });
        }
        console.log(`[room] ${role} ${name} (${id}) — ${peers.size} peer(s)`);
        return;
      }

      if (msg.t === "input" || msg.t === "action") {
        if (ws.data.role !== "client") return;
        const host = hostPeer();
        if (host) send(host.ws, { ...msg, from: id });
        return;
      }

      if (msg.t === "snap") {
        if (ws.data.role !== "host") return;
        if (process.env.DEBUG_RELAY) console.log("[relay] snap", msg.snap?.t, "peers", peers.size, "bytes", String(raw).length);
        broadcast(msg, id);
        return;
      }

      if (msg.t === "event") {
        if (ws.data.role !== "host") return;
        if (msg.to && peers.has(msg.to)) send(peers.get(msg.to).ws, msg);
        else broadcast(msg, id);
        return;
      }

      if (msg.t === "chat") {
        const text = String(msg.text || "").slice(0, 200);
        if (!text) return;
        broadcast({ t: "chat", from: id, name: ws.data.name, text });
        return;
      }

      if (msg.t === "ping") {
        send(ws, { t: "pong", at: msg.at || 0 });
      }
    },
    close(ws) {
      const id = ws.data.id;
      if (!peers.has(id)) return;
      const wasHost = id === hostId;
      peers.delete(id);
      if (wasHost) {
        hostId = null;
        console.log("[room] host left; closing room");
        broadcast({ t: "hostLeft", message: "Хост покинул игру. Комната закрыта." });
        // Give clients a moment to render the message, then close them.
        setTimeout(() => {
          for (const [, p] of peers) {
            try { p.ws.close(4001, "host left"); } catch {}
          }
          peers.clear();
        }, 1200);
      } else {
        const host = hostPeer();
        if (host) send(host.ws, { t: "leave", id });
        broadcast({ t: "presence", players: playerList() }, id);
      }
    },
  },
});

const addrs = await discoverLan();
console.log("");
console.log("  ╔══════════════════════════════════════════════╗");
console.log("  ║            ПЕПЕЛ И ВЕРЕСК                    ║");
console.log("  ║        локальная игра по WiFi                ║");
console.log("  ╚══════════════════════════════════════════════╝");
console.log("");
console.log(`  Локально:  http://localhost:${PORT}`);
for (const a of addrs) console.log(`  Телефон:   http://${a}:${PORT}`);
console.log("");
console.log("  Хост: нажми «Создать игру». Друзья открывают ссылку и жмут «Присоединиться».");
console.log("");
