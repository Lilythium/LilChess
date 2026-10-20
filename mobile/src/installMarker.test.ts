import { describe, expect, it, vi } from "vitest";
import { clearSecureStorageOnFreshInstall, INSTALL_MARKER_KEY, type MarkerStorage } from "./installMarker.js";

function memoryStorage(initial: Record<string, string> = {}): MarkerStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("clearSecureStorageOnFreshInstall", () => {
  it("wipes secure storage on the first launch and records that it did", async () => {
    const storage = memoryStorage();
    const clear = vi.fn().mockResolvedValue(undefined);
    await expect(clearSecureStorageOnFreshInstall(storage, clear)).resolves.toBe("cleared");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(storage.data.has(INSTALL_MARKER_KEY)).toBe(true);
  });

  it("leaves a returning install's sessions alone", async () => {
    const storage = memoryStorage({ [INSTALL_MARKER_KEY]: "1" });
    const clear = vi.fn().mockResolvedValue(undefined);
    await expect(clearSecureStorageOnFreshInstall(storage, clear)).resolves.toBe("already-initialized");
    expect(clear).not.toHaveBeenCalled();
  });

  it("only wipes once across launches", async () => {
    const storage = memoryStorage();
    const clear = vi.fn().mockResolvedValue(undefined);
    await clearSecureStorageOnFreshInstall(storage, clear);
    await clearSecureStorageOnFreshInstall(storage, clear);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not write the marker when the wipe failed, so the next launch retries", async () => {
    const storage = memoryStorage();
    const clear = vi.fn().mockRejectedValue(new Error("keychain unavailable"));
    await expect(clearSecureStorageOnFreshInstall(storage, clear)).resolves.toBe("skipped");
    expect(storage.data.has(INSTALL_MARKER_KEY)).toBe(false);
  });

  it("does nothing when localStorage cannot be read, instead of signing everyone out each launch", async () => {
    const broken: MarkerStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    const clear = vi.fn().mockResolvedValue(undefined);
    await expect(clearSecureStorageOnFreshInstall(broken, clear)).resolves.toBe("skipped");
    expect(clear).not.toHaveBeenCalled();
  });

  it("still reports the wipe when the marker cannot be written", async () => {
    const storage: MarkerStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const clear = vi.fn().mockResolvedValue(undefined);
    await expect(clearSecureStorageOnFreshInstall(storage, clear)).resolves.toBe("cleared");
  });
});
