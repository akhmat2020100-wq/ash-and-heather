package ru.ashheather.game;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Поиск комнат в WiFi. Повторяет протокол server.js:
 * запрос {"t":"ash-heather-discover","v":2} на UDP 45999,
 * ответ {"t":"ash-heather-host",...} — только пока в комнате есть хост.
 */
final class LanDiscovery {
  private static final String TAG = "AshDiscovery";

  static final int PORT = 45999;
  static final String REQUEST = "ash-heather-discover";
  static final String REPLY = "ash-heather-host";
  static final String VERSION = "0.4.0";

  private static final long CACHE_MS = 2500L;

  private static final Object scanLock = new Object();
  private static volatile List<JSONObject> cache = Collections.emptyList();
  private static volatile long cacheAt = 0L;
  private static volatile boolean warmQueued = false;

  private static DatagramSocket responder;
  private static Thread responderThread;

  private LanDiscovery() {}

  /** Запускает UDP-ответчик. Он молчит, пока RelayServer.hasHost() == false. */
  static synchronized void startResponder(final RelayServer relay, final int staticPort, final int relayPort) {
    stopResponder();
    try {
      DatagramSocket socket = new DatagramSocket(null);
      socket.setReuseAddress(true);
      socket.setBroadcast(true);
      socket.bind(new InetSocketAddress(PORT));
      responder = socket;
      responderThread = new Thread(() -> {
        byte[] buffer = new byte[2048];
        while (!Thread.currentThread().isInterrupted()) {
          DatagramSocket active = responder;
          if (active == null || active.isClosed()) break;
          try {
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            active.receive(packet);
            if (packet.getLength() <= 0) continue;
            String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
            JSONObject message;
            try {
              message = new JSONObject(raw);
            } catch (Exception e) {
              continue;
            }
            String type = message.optString("t", message.optString("type", ""));
            if (!REQUEST.equals(type)) continue;
            if (relay == null || !relay.hasHost()) continue;
            JSONObject payload = hostPayload(relay, staticPort, relayPort);
            if (payload == null) continue;
            byte[] out = payload.toString().getBytes(StandardCharsets.UTF_8);
            active.send(new DatagramPacket(out, out.length, packet.getAddress(), packet.getPort()));
          } catch (Exception e) {
            DatagramSocket current = responder;
            if (current == null || current.isClosed()) break;
            if (!(e instanceof SocketTimeoutException)) {
              Log.w(TAG, "responder", e);
            }
          }
        }
      }, "ash-discovery-host");
      responderThread.setDaemon(true);
      responderThread.start();
      Log.i(TAG, "discovery responder on udp " + PORT);
    } catch (Exception e) {
      Log.w(TAG, "discovery responder bind failed", e);
      responder = null;
      responderThread = null;
    }
  }

  static synchronized void stopResponder() {
    DatagramSocket socket = responder;
    responder = null;
    if (socket != null) {
      try {
        socket.close();
      } catch (Exception ignored) {
      }
    }
    Thread thread = responderThread;
    responderThread = null;
    if (thread != null) thread.interrupt();
  }

  static JSONObject hostPayload(RelayServer relay, int staticPort, int relayPort) {
    String ip = Lan.primary();
    if (ip.isEmpty() || staticPort <= 0 || relayPort <= 0) return null;
    try {
      JSONObject o = new JSONObject();
      o.put("t", REPLY);
      o.put("name", "Пепел и Вереск");
      o.put("host", ip);
      o.put("port", staticPort);
      o.put("url", "http://" + ip + ":" + staticPort);
      o.put("ws", "ws://" + ip + ":" + relayPort + "/ws");
      o.put("players", relay == null ? 0 : relay.playerCount());
      o.put("maxPlayers", RelayServer.MAX_PLAYERS);
      o.put("version", VERSION);
      return o;
    } catch (Exception e) {
      return null;
    }
  }

  /** Ответ для /api/discover: своя комната, если мы хост, иначе найденные рядом. */
  static String discoverJson(RelayServer relay, int staticPort, int relayPort) {
    JSONArray servers = new JSONArray();
    try {
      if (relay != null && relay.hasHost()) {
        JSONObject own = hostPayload(relay, staticPort, relayPort);
        if (own != null) servers.put(own);
      } else {
        for (JSONObject o : cachedScan()) servers.put(o);
      }
      JSONObject out = new JSONObject();
      out.put("servers", servers);
      out.put("version", VERSION);
      return out.toString();
    } catch (Exception e) {
      return "{\"servers\":[],\"version\":\"" + VERSION + "\"}";
    }
  }

  /** Вызывается из WebView. Кэш не даёт блокировать JS-поток на каждом обновлении. */
  static String discoverHostsJson() {
    JSONArray arr = new JSONArray();
    for (JSONObject o : cachedScan()) arr.put(o);
    return arr.toString();
  }

  private static List<JSONObject> cachedScan() {
    long now = System.currentTimeMillis();
    if (now - cacheAt <= CACHE_MS) return cache;
    synchronized (scanLock) {
      if (System.currentTimeMillis() - cacheAt > CACHE_MS) {
        cache = scan(850);
        cacheAt = System.currentTimeMillis();
      }
      return cache;
    }
  }

  /** Прогрев кэша в фоне, чтобы экран «Присоединиться» открывался без паузы. */
  static void warmUp() {
    if (warmQueued) return;
    warmQueued = true;
    Thread thread = new Thread(() -> {
      try {
        cachedScan();
      } finally {
        warmQueued = false;
      }
    }, "ash-discovery-warmup");
    thread.setDaemon(true);
    thread.start();
  }

  private static List<JSONObject> scan(int timeoutMs) {
    Map<String, JSONObject> found = new LinkedHashMap<>();
    DatagramSocket socket = null;
    try {
      socket = new DatagramSocket();
      socket.setBroadcast(true);
      socket.setSoTimeout(120);

      byte[] request = new JSONObject()
          .put("t", REQUEST)
          .put("v", 2)
          .toString()
          .getBytes(StandardCharsets.UTF_8);

      Set<String> targets = new LinkedHashSet<>();
      targets.add("255.255.255.255");
      targets.addAll(Lan.broadcasts());
      for (String target : targets) {
        try {
          socket.send(new DatagramPacket(request, request.length, InetAddress.getByName(target), PORT));
        } catch (Exception ignored) {
        }
      }

      long deadline = System.currentTimeMillis() + Math.max(250, timeoutMs);
      byte[] buffer = new byte[4096];
      while (System.currentTimeMillis() < deadline) {
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        try {
          socket.receive(packet);
        } catch (SocketTimeoutException e) {
          continue;
        } catch (Exception e) {
          break;
        }
        String raw = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
        JSONObject message;
        try {
          message = new JSONObject(raw);
        } catch (Exception e) {
          continue;
        }
        if (!REPLY.equals(message.optString("t", ""))) continue;
        String ws = message.optString("ws", "").trim();
        if (ws.isEmpty()) continue;
        String host = message.optString("host", packet.getAddress().getHostAddress());
        try {
          JSONObject entry = new JSONObject();
          entry.put("name", message.optString("name", "Пепел и Вереск"));
          entry.put("host", host);
          entry.put("ws", ws);
          entry.put("url", message.optString("url", "http://" + host + ":" + message.optInt("port", 8080)));
          entry.put("players", message.optInt("players", 0));
          entry.put("maxPlayers", message.optInt("maxPlayers", RelayServer.MAX_PLAYERS));
          entry.put("version", message.optString("version", VERSION));
          found.put(ws, entry);
        } catch (Exception ignored) {
        }
      }
    } catch (Exception e) {
      Log.w(TAG, "scan", e);
    } finally {
      if (socket != null) {
        try {
          socket.close();
        } catch (Exception ignored) {
        }
      }
    }
    return new ArrayList<>(found.values());
  }
}
