import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig, type MobileLinkConfig } from "../config.js";
import { appLinkRoutes, buildAppleSiteAssociation, buildAssetLinks } from "./appLinks.js";

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const configured: MobileLinkConfig = {
  androidPackage: "io.github.lilythium.lilchess",
  androidCertSha256: [FINGERPRINT],
  iosAppIds: ["ABCDE12345.io.github.lilythium.lilchess"],
};
const unconfigured: MobileLinkConfig = { androidPackage: configured.androidPackage, androidCertSha256: [], iosAppIds: [] };

async function appWith(mobile: MobileLinkConfig) {
  const app = Fastify();
  await app.register(appLinkRoutes, { mobile });
  return app;
}

describe("app link association files", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it("serves Digital Asset Links for the configured package and fingerprints", async () => {
    const app = await appWith(configured);
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "io.github.lilythium.lilchess", sha256_cert_fingerprints: [FINGERPRINT] },
      },
    ]);
  });

  it("serves an apple-app-site-association file limited to the two invite hash routes", async () => {
    const app = await appWith(configured);
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/.well-known/apple-app-site-association" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json() as ReturnType<typeof buildAppleSiteAssociation>;
    expect(body?.applinks.details[0]?.appIDs).toEqual(configured.iosAppIds);
    expect(body?.applinks.details[0]?.components.map((c) => [c["/"], c["#"]])).toEqual([
      ["/", "/c/*"],
      ["/", "/s/*"],
    ]);
  });

  it("returns 404 JSON, never the SPA page, when nothing is configured", async () => {
    const app = await appWith(unconfigured);
    apps.push(app);
    for (const url of ["/.well-known/assetlinks.json", "/.well-known/apple-app-site-association"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: "Not found" });
    }
  });

  it("only configures a platform that has settings for it", () => {
    expect(buildAssetLinks({ ...configured, iosAppIds: [] })).not.toBeNull();
    expect(buildAppleSiteAssociation({ ...configured, iosAppIds: [] })).toBeNull();
    expect(buildAssetLinks({ ...configured, androidCertSha256: [] })).toBeNull();
    expect(buildAppleSiteAssociation({ ...configured, androidCertSha256: [] })).not.toBeNull();
  });

  it("is registered on the real app and stays off by default", async () => {
    const app = await buildApp();
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(res.statusCode).toBe(404);
  });
});

describe("mobile link configuration", () => {
  it("defaults to the official package id and no association files", () => {
    expect(loadConfig({}).mobile).toEqual({ androidPackage: "io.github.lilythium.lilchess", androidCertSha256: [], iosAppIds: [] });
  });

  it("normalizes fingerprints and splits comma-separated lists", () => {
    const lower = FINGERPRINT.toLowerCase();
    const c = loadConfig({
      MOBILE_ANDROID_CERT_SHA256: `${lower}, ${FINGERPRINT}`,
      MOBILE_IOS_APP_ID: "ABCDE12345.io.github.lilythium.lilchess, FGHIJ67890.com.example.chess",
    });
    expect(c.mobile.androidCertSha256).toEqual([FINGERPRINT, FINGERPRINT]);
    expect(c.mobile.iosAppIds).toEqual(["ABCDE12345.io.github.lilythium.lilchess", "FGHIJ67890.com.example.chess"]);
  });

  it("rejects malformed values instead of serving a file the platform will silently ignore", () => {
    expect(() => loadConfig({ MOBILE_ANDROID_CERT_SHA256: "not-a-fingerprint" })).toThrow(/MOBILE_ANDROID_CERT_SHA256/);
    expect(() => loadConfig({ MOBILE_IOS_APP_ID: "io.github.lilythium.lilchess" })).toThrow(/MOBILE_IOS_APP_ID/);
    expect(() => loadConfig({ MOBILE_ANDROID_PACKAGE: "nodots" })).toThrow(/MOBILE_ANDROID_PACKAGE/);
  });
});
