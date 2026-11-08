package ru.ashheather.game;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;

import fi.iki.elonen.NanoHTTPD;

public class MainActivity extends Activity {
  private static final String TAG = "AshMain";
  private static final int[] BASE_PORTS = {8080, 8090, 8100, 8120};

  private WebView webView;
  private StaticServer staticServer;
  private RelayServer relayServer;
  private int staticPort = -1;
  private int relayPort = -1;

  private View customView;
  private WebChromeClient.CustomViewCallback customViewCallback;
  private long lastBackAt = 0L;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }
    hideSystemUi();

    if (!startServers()) {
      showFatal("Не удалось занять локальные порты 8080/8081.\nЗакрой другие игры и запусти «Пепел и Вереск» снова.");
      return;
    }

    webView = new WebView(this);
    configureWebView(webView);
    setContentView(webView);
    webView.loadUrl("http://127.0.0.1:" + staticPort + "/");
  }

  private boolean startServers() {
    for (int base : BASE_PORTS) {
      if (!portFree(base) || !portFree(base + 1)) continue;

      RelayServer relay = new RelayServer(base + 1);
      try {
        relay.start();
        if (!relay.awaitStartup(1800)) {
          stopRelay(relay);
          continue;
        }
      } catch (Exception e) {
        Log.w(TAG, "relay start failed on " + (base + 1), e);
        stopRelay(relay);
        continue;
      }

      StaticServer stat = new StaticServer(base, getAssets(), relay);
      try {
        stat.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
      } catch (IOException e) {
        Log.w(TAG, "static start failed on " + base, e);
        stopRelay(relay);
        continue;
      }

      relayServer = relay;
      staticServer = stat;
      staticPort = base;
      relayPort = base + 1;
      LanDiscovery.startResponder(relay, staticPort, relayPort);
      Log.i(TAG, "serving http://127.0.0.1:" + staticPort + " relay ws://127.0.0.1:" + relayPort);
      return true;
    }
    return false;
  }

  private static boolean portFree(int port) {
    ServerSocket socket = null;
    try {
      socket = new ServerSocket();
      socket.setReuseAddress(true);
      socket.bind(new InetSocketAddress(port));
      return true;
    } catch (IOException e) {
      return false;
    } finally {
      if (socket != null) {
        try {
          socket.close();
        } catch (IOException ignored) {
        }
      }
    }
  }

  private static void stopRelay(RelayServer relay) {
    if (relay == null) return;
    try {
      relay.stop(800);
    } catch (Exception ignored) {
    }
  }

  private void configureWebView(WebView view) {
    WebSettings s = view.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setCacheMode(WebSettings.LOAD_NO_CACHE);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setDisplayZoomControls(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setTextZoom(100);

    view.setBackgroundColor(Color.rgb(11, 13, 18));
    view.setOverScrollMode(View.OVER_SCROLL_NEVER);
    view.setVerticalScrollBarEnabled(false);
    view.setHorizontalScrollBarEnabled(false);
    view.setFitsSystemWindows(false);
    view.addJavascriptInterface(new NativeBridge(this), "AshNative");

    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
    }

    view.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (("http".equals(scheme) || "https".equals(scheme))
            && ("127.0.0.1".equals(host) || "localhost".equals(host))) {
          return false;
        }
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
        return true;
      }
    });

    view.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onShowCustomView(View v, CustomViewCallback callback) {
        if (customView != null) {
          callback.onCustomViewHidden();
          return;
        }
        customView = v;
        customViewCallback = callback;
        ViewGroup root = findViewById(android.R.id.content);
        root.addView(v, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));
        if (webView != null) webView.setVisibility(View.GONE);
      }

      @Override
      public void onHideCustomView() {
        ViewGroup root = findViewById(android.R.id.content);
        if (customView != null) {
          root.removeView(customView);
          customView = null;
        }
        if (customViewCallback != null) {
          customViewCallback.onCustomViewHidden();
          customViewCallback = null;
        }
        if (webView != null) webView.setVisibility(View.VISIBLE);
      }

      @Override
      public boolean onConsoleMessage(ConsoleMessage msg) {
        if (msg != null) Log.d("AshWeb", msg.message() + " @" + msg.sourceId() + ":" + msg.lineNumber());
        return true;
      }
    });
  }

  @Override
  public void onBackPressed() {
    if (customView != null) {
      ViewGroup root = findViewById(android.R.id.content);
      root.removeView(customView);
      customView = null;
      if (customViewCallback != null) {
        customViewCallback.onCustomViewHidden();
        customViewCallback = null;
      }
      if (webView != null) webView.setVisibility(View.VISIBLE);
      return;
    }
    if (webView != null) {
      webView.evaluateJavascript(
          "(window.AshBack && window.AshBack()) ? '1' : '0'",
          value -> {
            if (!"\"1\"".equals(value)) {
              long now = System.currentTimeMillis();
              if (now - lastBackAt < 2200) {
                moveTaskToBack(true);
              } else {
                lastBackAt = now;
                Toast.makeText(MainActivity.this, "Ещё раз — свернуть игру", Toast.LENGTH_SHORT).show();
              }
            }
          });
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onResume() {
    super.onResume();
    hideSystemUi();
    if (webView != null) webView.onResume();
    if (relayServer == null || !relayServer.hasHost()) LanDiscovery.warmUp();
  }

  @Override
  protected void onPause() {
    if (webView != null) webView.onPause();
    super.onPause();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemUi();
  }

  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }

  private void showFatal(String message) {
    TextView tv = new TextView(this);
    tv.setText("ПЕПЕЛ И ВЕРЕСК\n\n" + message);
    tv.setTextColor(Color.rgb(230, 220, 200));
    tv.setBackgroundColor(Color.rgb(11, 13, 18));
    tv.setGravity(Gravity.CENTER);
    tv.setPadding(56, 56, 56, 56);
    tv.setTextSize(18f);
    setContentView(tv);
  }

  String getLanUrl() {
    String ip = Lan.primary();
    if (ip.isEmpty() || staticPort <= 0) return "";
    return "http://" + ip + ":" + staticPort;
  }

  String getLanWsUrl() {
    String ip = Lan.primary();
    if (ip.isEmpty() || relayPort <= 0) return "";
    return "ws://" + ip + ":" + relayPort + "/ws";
  }

  String getRelayUrl() {
    if (relayPort <= 0) return "";
    return "ws://127.0.0.1:" + relayPort + "/ws";
  }

  int getStaticPort() {
    return staticPort;
  }

  int getRelayPort() {
    return relayPort;
  }

  @Override
  protected void onDestroy() {
    LanDiscovery.stopResponder();
    if (webView != null) {
      try {
        webView.loadUrl("about:blank");
        webView.removeJavascriptInterface("AshNative");
        webView.destroy();
      } catch (Exception ignored) {
      }
      webView = null;
    }
    if (relayServer != null) {
      stopRelay(relayServer);
      relayServer = null;
    }
    if (staticServer != null) {
      staticServer.stop();
      staticServer = null;
    }
    super.onDestroy();
  }
}
