package ru.ashheather.game;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Небольшой помощник для поиска адреса телефона в WiFi-сети. */
final class Lan {
  private Lan() {}

  static List<String> addresses() {
    Set<String> wifi = new LinkedHashSet<>();
    Set<String> other = new LinkedHashSet<>();
    try {
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
        String name = ni.getName() == null ? "" : ni.getName().toLowerCase();
        boolean prefer = name.startsWith("wlan") || name.startsWith("ap")
            || name.startsWith("eth") || name.contains("wifi") || name.contains("softap");
        boolean mobile = name.startsWith("rmnet") || name.startsWith("ccmni")
            || name.startsWith("pdp") || name.startsWith("clat") || name.startsWith("dummy")
            || name.startsWith("tun") || name.startsWith("ppp");
        for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
          InetAddress address = ia.getAddress();
          if (!(address instanceof Inet4Address)) continue;
          String ip = address.getHostAddress();
          if (ip == null || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
          if (prefer) wifi.add(ip);
          else if (!mobile) other.add(ip);
        }
      }
    } catch (Exception ignored) {
      // На некоторых прошивках список интерфейсов закрыт — вернём то, что успели найти.
    }
    List<String> out = new ArrayList<>(wifi);
    out.addAll(other);
    return out;
  }

  static String primary() {
    List<String> list = addresses();
    return list.isEmpty() ? "" : list.get(0);
  }

  /** Широковещательные адреса подсетей — для UDP-поиска комнат. */
  static List<String> broadcasts() {
    Set<String> out = new LinkedHashSet<>();
    try {
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback()) continue;
        for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
          InetAddress broadcast = ia.getBroadcast();
          if (!(broadcast instanceof Inet4Address)) continue;
          String ip = broadcast.getHostAddress();
          if (ip == null || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
          out.add(ip);
        }
      }
    } catch (Exception ignored) {
    }
    return new ArrayList<>(out);
  }
}
