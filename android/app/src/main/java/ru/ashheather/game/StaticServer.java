package ru.ashheather.game;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoHTTPD;

/** Раздаёт public/ из assets и отдаёт /api/status для клиентов в WiFi. */
public class StaticServer extends NanoHTTPD {
  private static final String TAG = "AshStatic";

  private final AssetManager assets;
  private final RelayServer relay;
  private final int port;
  private final ConcurrentHashMap<String, byte[]> cache = new ConcurrentHashMap<>();

  public StaticServer(int port, AssetManager assets, RelayServer relay) {
    super(port);
    this.port = port;
    this.assets = assets;
    this.relay = relay;
  }

  @Override
  public Response serve(IHTTPSession session) {
    String uri = session.getUri();
    if (uri == null || uri.isEmpty()) uri = "/";

    if ("/api/status".equals(uri)) {
      return statusResponse();
    }
    if ("/favicon.ico".equals(uri)) {
      return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "");
    }

    Method method = session.getMethod();
    if (method != Method.GET && method != Method.HEAD) {
      return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain; charset=utf-8", "Метод не разрешён");
    }

    String rel;
    try {
      rel = URLDecoder.decode(uri, "UTF-8");
    } catch (Exception e) {
      rel = uri;
    }
    while (rel.startsWith("/")) rel = rel.substring(1);
    if (rel.isEmpty()) rel = "index.html";
    if (rel.contains("..") || rel.contains("\\") || rel.contains("//")) {
      return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain; charset=utf-8", "Запрещено");
    }

    byte[] data = cache.get(rel);
    if (data == null) {
      try (InputStream in = assets.open("www/" + rel)) {
        data = readAll(in);
        cache.put(rel, data);
      } catch (IOException e) {
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain; charset=utf-8", "Не найдено");
      }
    }

    Response res = newFixedLengthResponse(
        Response.Status.OK,
        mimeType(rel),
        new ByteArrayInputStream(data),
        data.length);
    res.addHeader("Cache-Control", "no-cache");
    res.addHeader("X-Content-Type-Options", "nosniff");
    return res;
  }

  private Response statusResponse() {
    JSONObject o = new JSONObject();
    try {
      o.put("host", relay != null && relay.hasHost());
      o.put("players", relay == null ? new JSONArray() : relay.playerList());
      o.put("maxPlayers", RelayServer.MAX_PLAYERS);
      o.put("port", port);
      o.put("wsPort", relay == null ? -1 : relay.getRelayPort());
      o.put("lan", new JSONArray(Lan.addresses()));
      o.put("version", "0.2.0");
      o.put("game", "ash-and-heather");
    } catch (Exception e) {
      Log.w(TAG, "status json", e);
    }
    Response res = newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", o.toString());
    res.addHeader("Cache-Control", "no-store");
    res.addHeader("Access-Control-Allow-Origin", "*");
    return res;
  }

  private static byte[] readAll(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(1024, in.available()));
    byte[] buffer = new byte[16 * 1024];
    int n;
    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
    return out.toByteArray();
  }

  private static String mimeType(String path) {
    int dot = path.lastIndexOf('.');
    String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    switch (ext) {
      case "html":
      case "htm":
        return "text/html; charset=utf-8";
      case "js":
      case "mjs":
        return "text/javascript; charset=utf-8";
      case "css":
        return "text/css; charset=utf-8";
      case "json":
      case "webmanifest":
        return "application/json; charset=utf-8";
      case "svg":
        return "image/svg+xml";
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "webp":
        return "image/webp";
      case "ico":
        return "image/x-icon";
      case "woff2":
        return "font/woff2";
      case "mp3":
        return "audio/mpeg";
      case "ogg":
        return "audio/ogg";
      case "wav":
        return "audio/wav";
      default:
        return "application/octet-stream";
    }
  }
}
