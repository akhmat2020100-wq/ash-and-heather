/* Пепел и Вереск — LAN relay + static server (Bun) */
import { networkInterfaces } from "node:os";
import { join, normalize, extname } from "node:path";
import dgram from "node:dgram";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = join(import.meta.dir, "public");
const MAX_PLAYERS = 4;
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 45999);
const GAME_VERSION = "0.4.0";
const DISCOVER_REQUEST = "ash-heather-discover";
const DISCOVER_REPLY = "ash-heather-host";

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

function discoveryPayload(ip) {
  const host = hostPeer();
  if (!host) return null;
  const base = ip || lanAddresses()[0] || "127.0.0.1";
  return {
    t: DISCOVER_REPLY,
    name: host.name ? `Пепел и Вереск · ${host.name}` : "Пепел и Вереск",
    host: base,
    port: PORT,
    url: `http://${base}:${PORT}`,
    ws: `ws://${base}:${PORT}/ws`,
    players: peers.size,
    maxPlayers: MAX_PLAYERS,
    version: GAME_VERSION,
  };
}

function parseDiscovery(raw) {
  try {
    const msg = JSON.parse(String(raw));
    if (!msg || (msg.t !== DISCOVER_REQUEST && msg.type !== DISCOVER_REQUEST)) return null;
    return msg;
  } catch {
    return null;
  }
}

function activeDiscovery(timeout = 900) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      try { sock?.close(); } catch {}
      resolve([...found.values()]);
    };
    try {
      sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sock.on("error", finish);
      sock.on("message", (raw, rinfo) => {
        try {
          const msg = JSON.parse(String(raw));
          if (!msg || msg.t !== DISCOVER_REPLY || !msg.ws) return;
          found.set(msg.ws, {
            name: msg.name || "Пепел и Вереск",
            host: msg.host || rinfo.address,
            ws: msg.ws,
            url: msg.url || `http://${rinfo.address}:${msg.port || PORT}`,
            players: msg.players || 0,
            maxPlayers: msg.maxPlayers || MAX_PLAYERS,
            version: msg.version || GAME_VERSION,
          });
        } catch {}
      });
      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
          const req = Buffer.from(JSON.stringify({ t: DISCOVER_REQUEST, v: 2 }));
          sock.send(req, DISCOVERY_PORT, "255.255.255.255");
          for (const addr of lanAddresses()) {
            const parts = addr.split(".");
            if (parts.length !== 4) continue;
            sock.send(req, DISCOVERY_PORT, `${parts[0]}.${parts[1]}.${parts[2]}.255`);
          }
        } catch {}
        timer = setTimeout(finish, timeout);
      });
    } catch {
      finish();
    }
  });
}

function startDiscoveryResponder() {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", (err) => {
    if (process.env.DEBUG_RELAY) console.error("[discovery]", err?.message);
    try { sock.close(); } catch {}
  });
  sock.on("message", (raw, rinfo) => {
    if (!parseDiscovery(raw)) return;
    const payload = discoveryPayload(rinfo.address);
    if (!payload) return;
    try {
      sock.send(Buffer.from(JSON.stringify(payload)), rinfo.port, rinfo.address);
    } catch {}
  });
  sock.bind(DISCOVERY_PORT, "0.0.0.0", () => {
    try { sock.setBroadcast(true); } catch {}
    console.log(`  Поиск:    udp://${DISCOVERY_PORT}`);
  });
  return sock;
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
        version: GAME_VERSION,
      }, {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    if (url.pathname === "/api/discover") {
      let servers = [];
      if (hostPeer()) {
        const payload = discoveryPayload(lanAddresses()[0]);
        if (payload) servers = [payload];
      } else {
        servers = await activeDiscovery(700);
      }
      return Response.json({ servers, version: GAME_VERSION }, {
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
startDiscoveryResponder();
console.log("");
console.log("  ╔══════════════════════════════════════════════╗");
console.log("  ║            ПЕПЕЛ И ВЕРЕСК                    ║");
console.log("  ║        локальная игра по WiFi                ║");
console.log("  ╚══════════════════════════════════════════════╝");
console.log("");
console.log(`  Локально:  http://localhost:${PORT}`);
for (const a of addrs) console.log(`  Телефон:   http://${a}:${PORT}`);
console.log("");
console.log("  Хост: нажми «Создать игру». Друзья увидят комнату в списке рядом.");
console.log("");
