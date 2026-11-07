package ru.ashheather.game;

import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Ретранслятор комнаты. Повторяет протокол server.js:
 * хост присылает snap/event, клиенты — input/action; сервер только пересылает.
 */
public class RelayServer extends WebSocketServer {
  public static final int MAX_PLAYERS = 4;
  private static final String TAG = "AshRelay";
  private static final String HOST_LEFT = "Хост покинул игру. Комната закрыта.";

  private final Object lock = new Object();
  private final int port;
  private final Map<WebSocket, Peer> peers = new LinkedHashMap<>();
  private WebSocket host;
  private String hostId = "";
  private int nextId = 1;

  private final CountDownLatch startup = new CountDownLatch(1);
  private volatile boolean started;
  private volatile Exception startupError;

  public RelayServer(int port) {
    super(new InetSocketAddress(port));
    this.port = port;
    setReuseAddr(true);
    setConnectionLostTimeout(45);
    setTcpNoDelay(true);
  }

  private static class Peer {
    final String id;
    final String role;
    final String name;
    final String cls;

    Peer(String id, String role, String name, String cls) {
      this.id = id;
      this.role = role;
      this.name = name;
      this.cls = cls;
    }
  }

  private static JSONObject obj(Object... kv) {
    JSONObject o = new JSONObject();
    try {
      for (int i = 0; i + 1 < kv.length; i += 2) {
        o.put(String.valueOf(kv[i]), kv[i + 1]);
      }
    } catch (JSONException ignored) {
    }
    return o;
  }

  private void send(WebSocket ws, JSONObject o) {
    if (ws == null) return;
    try {
      if (ws.isOpen()) ws.send(o.toString());
    } catch (Exception ignored) {
    }
  }

  private void sendError(WebSocket ws, String code, String message) {
    send(ws, obj("t", "error", "code", code, "message", message));
  }

  private JSONArray playerArrayLocked() {
    JSONArray arr = new JSONArray();
    for (Peer p : peers.values()) {
      arr.put(obj("id", p.id, "role", p.role, "name", p.name, "cls", p.cls));
    }
    return arr;
  }

  public JSONArray playerList() {
    synchronized (lock) {
      return playerArrayLocked();
    }
  }

  public boolean hasHost() {
    synchronized (lock) {
      return host != null;
    }
  }

  private void broadcastLocked(JSONObject o, WebSocket except) {
    for (WebSocket ws : new ArrayList<>(peers.keySet())) {
      if (ws != except) send(ws, o);
    }
  }

  private WebSocket peerByIdLocked(String id) {
    for (Map.Entry<WebSocket, Peer> e : peers.entrySet()) {
      if (e.getValue().id.equals(id)) return e.getKey();
    }
    return null;
  }

  @Override
  public void onOpen(WebSocket conn, ClientHandshake handshake) {
    // Ждём hello, чтобы не занимать место в комнате.
  }

  @Override
  public void onMessage(WebSocket conn, String raw) {
    JSONObject msg;
    try {
      msg = new JSONObject(raw);
    } catch (Exception e) {
      return;
    }
    String type = msg.optString("t", "");
    if (type.isEmpty()) return;

    if ("hello".equals(type)) {
      synchronized (lock) {
        if (peers.containsKey(conn)) return;
        String role = "host".equals(msg.optString("role", "")) ? "host" : "client";
        String name = msg.optString("name", "Странник").trim();
        String cls = msg.optString("cls", "lantern").trim();
        if (name.isEmpty()) name = "Странник";
        if (name.length() > 24) name = name.substring(0, 24);
        if (cls.isEmpty()) cls = "lantern";
        if (cls.length() > 24) cls = cls.substring(0, 24);

        if ("host".equals(role) && host != null) {
          sendError(conn, "host_exists", "В этой сети уже есть открытая игра.");
          return;
        }
        if ("client".equals(role) && host == null) {
          sendError(conn, "no_host", "Хост ещё не создал игру.");
          return;
        }
        if (peers.size() >= MAX_PLAYERS) {
          sendError(conn, "full", "Комната заполнена (максимум 4 игрока).");
          return;
        }

        Peer peer = new Peer(String.valueOf(nextId++), role, name, cls);
        peers.put(conn, peer);
        if ("host".equals(role)) {
          host = conn;
          hostId = peer.id;
        }
        JSONObject welcome = obj(
            "t", "welcome",
            "id", peer.id,
            "role", role,
            "hostId", hostId,
            "players", playerArrayLocked(),
            "maxPlayers", MAX_PLAYERS);
        send(conn, welcome);
        if ("client".equals(role) && host != null) {
          send(host, obj("t", "join", "id", peer.id, "name", name, "cls", cls));
        }
        Log.i(TAG, "peer " + role + " " + name + " (" + peer.id + "), total " + peers.size());
      }
      return;
    }

    synchronized (lock) {
      Peer peer = peers.get(conn);
      if (peer == null) return;

      if ("input".equals(type) || "action".equals(type)) {
        if (!"client".equals(peer.role) || host == null) return;
        try {
          msg.put("from", peer.id);
        } catch (JSONException ignored) {
        }
        send(host, msg);
        return;
      }

      if ("snap".equals(type)) {
        if (!"host".equals(peer.role)) return;
        broadcastLocked(msg, conn);
        return;
      }

      if ("event".equals(type)) {
        if (!"host".equals(peer.role)) return;
        String to = msg.optString("to", "");
        WebSocket target = to.isEmpty() ? null : peerByIdLocked(to);
        if (target != null) send(target, msg);
        else broadcastLocked(msg, conn);
        return;
      }

      if ("chat".equals(type)) {
        String text = msg.optString("text", "").trim();
        if (text.isEmpty()) return;
        if (text.length() > 200) text = text.substring(0, 200);
        try {
          msg.put("from", peer.id);
          msg.put("name", peer.name);
          msg.put("text", text);
        } catch (JSONException ignored) {
        }
        broadcastLocked(msg, null);
        return;
      }

      if ("ping".equals(type)) {
        send(conn, obj("t", "pong", "at", msg.optLong("at", 0L)));
      }
    }
  }

  @Override
  public void onClose(WebSocket conn, int code, String reason, boolean remote) {
    List<WebSocket> clientsToClose = null;
    synchronized (lock) {
      Peer peer = peers.remove(conn);
      if (peer == null) return;

      if ("host".equals(peer.role)) {
        host = null;
        hostId = "";
        broadcastLocked(obj("t", "hostLeft", "message", HOST_LEFT), null);
        clientsToClose = new ArrayList<>(peers.keySet());
        peers.clear();
        Log.i(TAG, "host left; room closed");
      } else {
        if (host != null) send(host, obj("t", "leave", "id", peer.id));
        broadcastLocked(obj("t", "presence", "players", playerArrayLocked()), conn);
      }
    }

    if (clientsToClose != null) {
      final List<WebSocket> clients = clientsToClose;
      new Thread(() -> {
        try {
          Thread.sleep(1200);
        } catch (InterruptedException ignored) {
          Thread.currentThread().interrupt();
        }
        for (WebSocket ws : clients) {
          try {
            ws.close(4001, "host left");
          } catch (Exception ignored) {
          }
        }
      }, "ash-room-close").start();
    }
  }

  @Override
  public void onError(WebSocket conn, Exception ex) {
    if (!started) {
      startupError = ex;
      startup.countDown();
    }
    Log.w(TAG, "websocket error", ex);
  }

  @Override
  public void onStart() {
    started = true;
    startup.countDown();
    Log.i(TAG, "relay listening on " + port);
  }

  public boolean awaitStartup(long timeoutMs) {
    try {
      if (!startup.await(timeoutMs, TimeUnit.MILLISECONDS)) return false;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    }
    return startupError == null && started;
  }

  public int getRelayPort() {
    return port;
  }
}
