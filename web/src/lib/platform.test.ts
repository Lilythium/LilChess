import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canShare, copyText, inviteLink, isNativeApp, publicOrigin, setPlatformServices, shareContent,
} from "./platform";

afterEach(() => {
  setPlatformServices(null);
  vi.unstubAllGlobals();
});

function services(overrides: Partial<Parameters<typeof setPlatformServices>[0] & object> = {}) {
  return {
    publicOrigin: "https://chess.example.com",
    copyText: vi.fn().mockResolvedValue(undefined),
    share: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("in the browser", () => {
  it("links to the page's own origin and uses the Web APIs", async () => {
    vi.stubGlobal("location", { origin: "https://site.example" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(isNativeApp()).toBe(false);
    expect(publicOrigin()).toBe("https://site.example");
    expect(inviteLink("c", "abcdef12")).toBe("https://site.example/#/c/abcdef12");
    expect(canShare()).toBe(false);
    await expect(copyText("hi")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it("reports a refused clipboard instead of throwing", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(copyText("hi")).resolves.toBe(false);
  });

  it("treats a dismissed share sheet as success but rethrows real failures", async () => {
    const dismissed = new DOMException("Share canceled", "AbortError");
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(dismissed) });
    await expect(shareContent({ url: "https://x.example" })).resolves.toBeUndefined();
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(shareContent({ url: "https://x.example" })).rejects.toThrow("boom");
  });
});

describe("in the app", () => {
  it("builds links from the selected server, never from the WebView origin", () => {
    vi.stubGlobal("location", { origin: "https://localhost" });
    setPlatformServices(services());
    expect(isNativeApp()).toBe(true);
    expect(inviteLink("s", "0123456789abcdef")).toBe("https://chess.example.com/#/s/0123456789abcdef");
  });

  it("delegates copy and share to the native services", async () => {
    const s = services();
    setPlatformServices(s);
    expect(canShare()).toBe(true);
    await expect(copyText("hello")).resolves.toBe(true);
    await shareContent({ title: "t", url: "u" });
    expect(s.copyText).toHaveBeenCalledWith("hello");
    expect(s.share).toHaveBeenCalledWith({ title: "t", url: "u" });
  });
});
