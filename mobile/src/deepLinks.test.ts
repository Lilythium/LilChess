import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLaunchUrl, addListener } = vi.hoisted(() => ({ getLaunchUrl: vi.fn(), addListener: vi.fn() }));
vi.mock("@capacitor/app", () => ({ App: { getLaunchUrl, addListener } }));

import { listenForInviteLinks, readLaunchInvite } from "./deepLinks.js";

const ID = "ab12cd34ef56ab78";
const LINK = `lilchess://invite?server=${encodeURIComponent("https://chess.example.com")}&c=${ID}`;

describe("deep links", () => {
  beforeEach(() => {
    getLaunchUrl.mockReset();
    addListener.mockReset();
  });

  it("reads the invite that launched the app", async () => {
    getLaunchUrl.mockResolvedValue({ url: LINK });
    await expect(readLaunchInvite()).resolves.toEqual({
      serverUrl: "https://chess.example.com", target: { kind: "challenge", id: ID },
    });
  });

  it("ignores a normal launch and URLs that are not invites", async () => {
    getLaunchUrl.mockResolvedValue(undefined);
    await expect(readLaunchInvite()).resolves.toBeNull();
    getLaunchUrl.mockResolvedValue({ url: "lilchess://something-else" });
    await expect(readLaunchInvite()).resolves.toBeNull();
  });

  it("forwards only valid invites while running, and unsubscribes cleanly", async () => {
    const remove = vi.fn();
    let emit: (event: { url: string }) => void = () => {};
    addListener.mockImplementation(async (_name: string, callback: (event: { url: string }) => void) => {
      emit = callback;
      return { remove };
    });

    const onInvite = vi.fn();
    const stop = await listenForInviteLinks(onInvite);
    emit({ url: "https://example.com/not-an-invite" });
    emit({ url: LINK });

    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onInvite).toHaveBeenCalledWith({ serverUrl: "https://chess.example.com", target: { kind: "challenge", id: ID } });
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
