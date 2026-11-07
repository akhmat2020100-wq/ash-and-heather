/* Пепел и Вереск — WebSocket-клиент для локальной игры */

export function normalizeWsUrl(input) {
  let s = String(input || "").trim();
  if (!s) throw new Error("Пустой адрес хоста");
  if (/^https:\/\//i.test(s)) s = s.replace(/^https:/i, "wss:");
  else if (/^http:\/\//i.test(s)) s = s.replace(/^http:/i, "ws:");
  else if (!/^wss?:\/\//i.test(s)) s = "ws://" + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Не получается разобрать адрес");
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new Error("Адрес должен быть ws:// или http://");
  if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
  else if (!/\/ws$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/+$/, "") + "/ws";
  return u.toString();
}

export function defaultWsUrl() {
  // В APK-оболочке страница открыта локально, а ретранслятор живёт на соседнем порту.
  if (window.AshNative?.isEmbedded?.()) {
    try {
      const native = window.AshNative.getRelayUrl?.();
      if (native) return String(native);
    } catch {}
    return "ws://127.0.0.1:8081/ws";
  }
  if (location.protocol === "http:" || location.protocol === "https:") {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  return "ws://127.0.0.1:8080/ws";
}

export function joinCandidates(input) {
  const base = normalizeWsUrl(input);
  const list = [];
  const add = (url) => {
    const s = url.toString();
    if (!list.includes(s)) list.push(s);
  };
  const u = new URL(base);
  if (!u.port) {
    // Друг мог ввести только IP. В APK статика обычно на 8080, ретранслятор на 8081.
    for (const port of ["8080", "8081"]) {
      const alt = new URL(base);
      alt.port = port;
      add(alt);
    }
    add(u);
  } else {
    add(u);
    // Пары портов, которые использует APK-оболочка: 8080/8081, 8090/8091, 8100/8101.
    if (["8080", "8090", "8100", "8120"].includes(u.port)) {
      const alt = new URL(base);
      alt.port = String(Number(u.port) + 1);
      add(alt);
    }
  }
  return list;
}

/** Дополнительно спрашиваем у HTTP-адреса хоста, на каком порту у него ретранслятор. */
export async function expandJoinCandidates(input, timeoutMs = 2600) {
  const list = joinCandidates(input);
  let httpBase = null;
  const raw = String(input || "").trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      httpBase = new URL(raw);
    } else {
      const ws = new URL(normalizeWsUrl(raw));
      httpBase = new URL(ws.toString());
      httpBase.protocol = ws.protocol === "wss:" ? "https:" : "http:";
    }
  } catch {}
  if (httpBase) {
    let discoveryBase = httpBase;
    if (!discoveryBase.port) {
      discoveryBase = new URL(httpBase.toString());
      discoveryBase.port = "8080";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${discoveryBase.origin}/api/status`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const wsPort = Number(data?.wsPort || data?.port || 0);
        if (wsPort > 0) {
          const alt = new URL(discoveryBase.origin);
          alt.protocol = discoveryBase.protocol === "https:" ? "wss:" : "ws:";
          alt.port = String(wsPort);
          alt.pathname = "/ws";
          alt.search = "";
          alt.hash = "";
          list.unshift(alt.toString());
        }
      }
    } catch {
      // Хост может не отдавать /api/status — обычных кандидатов достаточно.
    } finally {
      clearTimeout(timer);
    }
  }
  return [...new Set(list)];
}

export class Net {
  constructor({ onMessage, onClose, onError } = {}) {
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this.welcomed = false;
    this.closed = false;
    this.pingTimer = null;
    this.latency = 0;
    this.lastPing = 0;
  }

  connect(url, hello, timeoutMs = 9000) {
    this.close(true);
    this.closed = false;
    this.welcomed = false;
    this.gen = (this.gen || 0) + 1;
    const gen = this.gen;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(new Error("Не удалось открыть соединение"));
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (gen !== this.gen) return;
        if (!this.welcomed) {
          try { ws.close(); } catch {}
          reject(new Error("Хост не отвечает"));
        }
      }, timeoutMs);

      ws.onopen = () => {
        if (gen !== this.gen) return;
        try {
          ws.send(JSON.stringify({ t: "hello", ...hello }));
        } catch {}
      };
      ws.onmessage = (ev) => {
        if (gen !== this.gen) return;
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch (err) {
          if (window.__ASH_DEBUG__) console.warn("[ws] bad json", String(ev.data).length, err?.message);
          return;
        }
        if (window.__ASH_DEBUG__) console.log("[ws in]", msg?.t, String(ev.data).length);
        if (!msg || typeof msg.t !== "string") return;
        if (msg.t === "welcome") {
          this.welcomed = true;
          clearTimeout(timeout);
          this.startPing();
          resolve(msg);
          return;
        }
        if (msg.t === "error" && !this.welcomed) {
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          reject(new Error(msg.message || "Сервер отклонил подключение"));
          return;
        }
        if (msg.t === "pong") {
          this.latency = Math.max(0, Date.now() - (msg.at || Date.now()));
          return;
        }
        this.onMessage(msg);
      };
      ws.onerror = () => {
        if (gen !== this.gen) return;
        if (!this.welcomed) {
          clearTimeout(timeout);
          reject(new Error("Ошибка соединения"));
        } else {
          this.onError(new Error("Соединение потеряно"));
        }
      };
      ws.onclose = (ev) => {
        if (gen !== this.gen) return;
        clearTimeout(timeout);
        this.stopPing();
        if (!this.welcomed) {
          reject(new Error(ev.reason || "Хост закрыл соединение"));
          return;
        }
        if (!this.closed) this.onClose(ev);
      };
    });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.lastPing = Date.now();
        this.send({ t: "ping", at: this.lastPing });
      }
    }, 5000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(obj) {
    if (this.ws?.readyState === 1) {
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  close(silent = false) {
    this.closed = true;
    this.gen = (this.gen || 0) + 1;
    this.stopPing();
    if (this.ws) {
      try { this.ws.close(1000, "bye"); } catch {}
      this.ws = null;
    }
    this.welcomed = false;
  }

  get connected() {
    return this.ws?.readyState === 1;
  }
}
