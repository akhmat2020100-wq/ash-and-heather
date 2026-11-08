package ru.ashheather.game;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.TextUtils;
import android.webkit.JavascriptInterface;

/** Мост между WebView и локальным сервером приложения. */
public class NativeBridge {
  private final MainActivity activity;

  NativeBridge(MainActivity activity) {
    this.activity = activity;
  }

  @JavascriptInterface
  public boolean isEmbedded() {
    return true;
  }

  @JavascriptInterface
  public String startHost() {
    return activity.getLanUrl();
  }

  @JavascriptInterface
  public String getLanUrl() {
    return activity.getLanUrl();
  }

  @JavascriptInterface
  public String getRelayUrl() {
    return activity.getRelayUrl();
  }

  @JavascriptInterface
  public String getLanWsUrl() {
    return activity.getLanWsUrl();
  }

  @JavascriptInterface
  public int getStaticPort() {
    return activity.getStaticPort();
  }

  @JavascriptInterface
  public int getRelayPort() {
    return activity.getRelayPort();
  }

  @JavascriptInterface
  public String getLanAddresses() {
    return TextUtils.join(",", Lan.addresses());
  }

  @JavascriptInterface
  public String discoverHosts() {
    return LanDiscovery.discoverHostsJson();
  }

  @JavascriptInterface
  public void vibrate(int milliseconds) {
    try {
      Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
      if (v == null || !v.hasVibrator()) return;
      int ms = Math.max(8, Math.min(80, milliseconds));
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
      } else {
        v.vibrate(ms);
      }
    } catch (Exception ignored) {
    }
  }
}
