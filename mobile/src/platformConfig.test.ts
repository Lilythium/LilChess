import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../capacitor.config.js";

// These tests read the native project files as text. They cannot prove the platforms behave as intended (only a
// device can), but they stop the policy in docs/mobile-phase-7-platform.md from being weakened by accident, for
// example by copying the debug network config into a release build or adding a blanket ATS exception.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const stripXmlComments = (xml: string) => xml.replace(/<!--[\s\S]*?-->/g, "");

const manifest = () => stripXmlComments(read("mobile/android/app/src/main/AndroidManifest.xml"));
const releaseNsc = () => stripXmlComments(read("mobile/android/app/src/main/res/xml/network_security_config.xml"));
const debugNsc = () => stripXmlComments(read("mobile/android/app/src/debug/res/xml/network_security_config.xml"));
const plist = () => stripXmlComments(read("mobile/ios/App/App/Info.plist"));

describe("Android network policy", () => {
  it("release builds are HTTPS-only with system trust anchors", () => {
    const nsc = releaseNsc();
    expect(nsc).toMatch(/<base-config cleartextTrafficPermitted="false">/);
    expect(nsc).not.toContain('cleartextTrafficPermitted="true"');
    expect(nsc).not.toContain("<domain-config");
    expect(nsc).not.toContain('src="user"');
  });

  it("only debug builds permit cleartext, and the debug file lives in the debug source set", () => {
    expect(debugNsc()).toContain('cleartextTrafficPermitted="true"');
    expect(read("mobile/android/app/src/debug/res/xml/network_security_config.xml")).toContain("DEBUG BUILDS ONLY");
  });

  it("wires the policy in and never uses the blunt global flags", () => {
    const m = manifest();
    expect(m).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(m).not.toMatch(/usesCleartextTraffic="true"/);
    expect(config.server?.cleartext).toBeUndefined();
    expect(config.android?.allowMixedContent).toBe(false);
  });

  it("relaxes mixed content for ws:// only in debuggable builds", () => {
    const activity = read("mobile/android/app/src/main/java/io/github/lilythium/lilchess/MainActivity.java");
    const guard = activity.indexOf("FLAG_DEBUGGABLE");
    const relax = activity.indexOf("MIXED_CONTENT_ALWAYS_ALLOW");
    expect(guard).toBeGreaterThan(-1);
    expect(relax).toBeGreaterThan(guard);
    expect(activity.slice(guard, relax)).toContain("if (debuggable");
  });

  it("does not let the OS back up or transfer app data", () => {
    expect(manifest()).toContain('android:allowBackup="false"');
  });

  it("stays on a target SDK that does not require the Android 17 local-network permission", () => {
    const target = Number(/targetSdkVersion = (\d+)/.exec(read("mobile/android/variables.gradle"))?.[1]);
    expect(Number.isInteger(target)).toBe(true);
    // Android 17 (API 37) blocks LAN access for apps that target it unless they request ACCESS_LOCAL_NETWORK.
    // Raising targetSdk past 36 is only safe once the app declares and requests that permission.
    if (target >= 37) expect(manifest()).toContain("android.permission.ACCESS_LOCAL_NETWORK");
  });
});

describe("iOS transport security", () => {
  it("allows local networking and nothing broader", () => {
    const p = plist();
    expect(p).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
    expect(p).not.toContain("NSAllowsArbitraryLoads");
    expect(p).not.toContain("NSExceptionDomains");
  });

  it("explains the local network prompt and declares export compliance", () => {
    const p = plist();
    expect(p).toContain("<key>NSLocalNetworkUsageDescription</key>");
    expect(p).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it("targets 64-bit devices only", () => {
    expect(plist()).toMatch(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>\s*<\/array>/);
  });
});

describe("deep links and app links", () => {
  it("registers the lilchess:// scheme on both platforms", () => {
    expect(manifest()).toContain('android:scheme="lilchess" android:host="invite"');
    expect(plist()).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>lilchess<\/string>/);
  });

  it("verified https links are opt-in and never hard-code a server", () => {
    const m = manifest();
    const alias = /<activity-alias[\s\S]*?<\/activity-alias>/.exec(m)?.[0] ?? "";
    expect(alias).toContain('android:autoVerify="true"');
    expect(alias).toContain('android:host="${appLinkHost}"');
    expect(alias).toContain('android:enabled="${appLinksEnabled}"');
    expect(alias).toContain('android:path="/"');
    const gradle = read("mobile/android/app/build.gradle");
    expect(gradle).toContain("appLinksEnabled: appLinkHost ? 'true' : 'false'");
    expect(gradle).toContain("'app-links.invalid'");
    // Only one https host entry in the whole manifest, and it is the placeholder.
    expect(m.match(/android:scheme="https"/g)?.length).toBe(1);
  });
});

describe("privacy and credentials", () => {
  it("asks for the INTERNET permission only", () => {
    const permissions = [...manifest().matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
    const allowed = new Set(["android.permission.INTERNET"]);
    const target = Number(/targetSdkVersion = (\d+)/.exec(read("mobile/android/variables.gradle"))?.[1]);
    if (target >= 37) allowed.add("android.permission.ACCESS_LOCAL_NETWORK");
    expect(permissions.filter((name) => !allowed.has(name ?? ""))).toEqual([]);
  });

  it("declares no tracking or device-identifier usage on iOS", () => {
    const p = plist();
    for (const key of ["NSUserTrackingUsageDescription", "NSAdvertisingAttributionReportEndpoint", "NSContactsUsageDescription", "NSLocationWhenInUseUsageDescription"]) {
      expect(p, key).not.toContain(key);
    }
  });

  it("never logs credentials from the native or realtime code paths", () => {
    const roots = ["mobile/src", "web/src/native", "web/src/lib/ws", "web/src/lib/api.ts"];
    const offenders: string[] = [];
    for (const file of roots.flatMap((entry) => sourceFiles(resolve(root, entry)))) {
      if (/\.test\.ts$/.test(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/console\.\w+\(/.test(line) && /token|ticket|password|authorization|secret|credential|cookie|bearer/i.test(line)) {
            offenders.push(`${relative(root, file)}:${index + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("release hygiene", () => {
  it("reads signing material from an ignored file, never from the build script", () => {
    const gradle = read("mobile/android/app/build.gradle");
    expect(gradle).toContain("keystore.properties");
    expect(gradle).not.toMatch(/^\s*(?:storePassword|keyPassword)\s*=?\s*['"][^'"]+['"]/m);
    const ignore = read("mobile/.gitignore");
    for (const pattern of ["*.jks", "*.keystore", "keystore.properties", "*.mobileprovision", "*.p12"]) {
      expect(ignore, pattern).toContain(pattern);
    }
  });

  it("uses one launcher background colour across the web theme, Android and the Capacitor config", () => {
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(read("web/src/app.css"))?.[1]?.toLowerCase();
    expect(bg).toBeDefined();
    expect(config.backgroundColor?.toLowerCase()).toBe(bg);
    expect(read("mobile/android/app/src/main/res/values/colors.xml").toLowerCase()).toContain(bg);
    expect(read("mobile/android/app/src/main/res/values/ic_launcher_background.xml").toLowerCase()).toContain(bg);
  });
});

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    if (name === "node_modules") return [];
    return statSync(child).isDirectory() ? sourceFiles(child) : /\.(ts|svelte)$/.test(name) ? [child] : [];
  });
}
