import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../capacitor.config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, Record<string, string> | undefined>;

describe("Capacitor config", () => {
  it("pins the WebView origin the server's Origin handling depends on", () => {
    expect(config.server?.iosScheme).toBe("capacitor");
    expect(config.server?.androidScheme).toBe("https");
    expect(config.server?.hostname).toBe("localhost");
  });

  it("never loads a remote site or allows cleartext traffic", () => {
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.cleartext).toBeUndefined();
  });

  it("ships the web client's native-mode build, not the server's web/dist", () => {
    expect(config.webDir).toBe("../web/dist-native");
    expect(json("web/package.json").scripts?.["build:native"]).toContain("--outDir dist-native");
    expect(json("web/package.json").scripts?.["build:native"]).toContain("--mode native");
  });

  it("uses one application id across config, Android and iOS projects", () => {
    const id = config.appId;
    expect(read("mobile/android/app/build.gradle")).toContain(`applicationId "${id}"`);
    expect(read("mobile/android/app/build.gradle")).toContain(`namespace = "${id}"`);
    expect(read("mobile/ios/App/App.xcodeproj/project.pbxproj")).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${id};`);
  });
});

describe("server runtime boundary", () => {
  it("keeps every mobile dependency out of production dependencies", () => {
    const mobile = json("mobile/package.json");
    expect(mobile.dependencies).toBeUndefined();
    expect(Object.keys(mobile.devDependencies ?? {}).length).toBeGreaterThan(0);

    for (const workspace of ["package.json", "server/package.json", "web/package.json", "shared/package.json"]) {
      const deps = Object.keys(json(workspace).dependencies ?? {});
      expect(deps.filter((name) => name.startsWith("@capacitor/")), workspace).toEqual([]);
    }
  });

  it("copies only the mobile manifest into the Docker build and nothing into the image", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("COPY mobile/package.json ./mobile/");
    expect(dockerfile).not.toMatch(/COPY --from=build \/app\/mobile/);
    expect(read(".dockerignore")).toMatch(/^mobile\/android$/m);
    expect(read(".dockerignore")).toMatch(/^mobile\/ios$/m);
  });
});
