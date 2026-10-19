import { describe, expect, it } from "vitest";
import { buildAppLink, buildShareLink, inviteRoute, parseInviteLink, sameServer } from "./inviteLink.js";

const ID = "ab12cd34ef56ab78";

describe("parseInviteLink: shared https links", () => {
  it("reads a challenge link as the website builds it", () => {
    expect(parseInviteLink(`https://chess.example.com/#/c/${ID}`)).toEqual({
      serverUrl: "https://chess.example.com", target: { kind: "challenge", id: ID },
    });
  });

  it("reads a simul invite, an explicit port, plain http and a trailing slash", () => {
    expect(parseInviteLink(`http://192.168.1.20:3000/#/s/${ID}/`)).toEqual({
      serverUrl: "http://192.168.1.20:3000", target: { kind: "simul", code: ID },
    });
  });

  it("normalizes the origin and tolerates whitespace and a missing scheme", () => {
    expect(parseInviteLink(`  CHESS.Example.com/#/c/${ID}\n`)?.serverUrl).toBe("https://chess.example.com");
  });

  it("ignores tracking parameters, which never reach the server request", () => {
    expect(parseInviteLink(`https://chess.example.com/?utm_source=x#/c/${ID}`)?.target).toEqual({ kind: "challenge", id: ID });
  });

  it.each([
    ["no hash route", "https://chess.example.com/"],
    ["a different route", `https://chess.example.com/#/game/${ID}`],
    ["a path prefix, which the app does not support", `https://chess.example.com/lilchess/#/c/${ID}`],
    ["embedded credentials", `https://user:pass@chess.example.com/#/c/${ID}`],
    ["a malformed id", "https://chess.example.com/#/c/not-hex!"],
    ["an id that is too short", "https://chess.example.com/#/c/abc"],
    ["extra segments", `https://chess.example.com/#/c/${ID}/extra`],
    ["an unsupported scheme", `ftp://chess.example.com/#/c/${ID}`],
    ["javascript:", "javascript://chess.example.com/%0aalert(1)#/c/" + ID],
    ["nothing", "   "],
    ["a value that is too long", `https://chess.example.com/#/c/${ID}` + "a".repeat(3000)],
  ])("rejects %s", (_label, value) => {
    expect(parseInviteLink(value)).toBeNull();
  });
});

describe("parseInviteLink: lilchess:// links", () => {
  it("reads challenge and simul links", () => {
    expect(parseInviteLink(`lilchess://invite?server=${encodeURIComponent("https://chess.example.com")}&c=${ID}`)).toEqual({
      serverUrl: "https://chess.example.com", target: { kind: "challenge", id: ID },
    });
    expect(parseInviteLink(`lilchess://invite?server=${encodeURIComponent("http://10.0.0.5:8080")}&s=${ID}`)).toEqual({
      serverUrl: "http://10.0.0.5:8080", target: { kind: "simul", code: ID },
    });
  });

  it.each([
    ["another host", `lilchess://login?server=https%3A%2F%2Fchess.example.com&c=${ID}`],
    ["no server", `lilchess://invite?c=${ID}`],
    ["two servers", `lilchess://invite?server=https%3A%2F%2Fa.example&server=https%3A%2F%2Fb.example&c=${ID}`],
    ["no target", "lilchess://invite?server=https%3A%2F%2Fchess.example.com"],
    ["two targets", `lilchess://invite?server=https%3A%2F%2Fchess.example.com&c=${ID}&s=${ID}`],
    ["a bad id", "lilchess://invite?server=https%3A%2F%2Fchess.example.com&c=zzz"],
    ["credentials in the server", `lilchess://invite?server=${encodeURIComponent("https://u:p@chess.example.com")}&c=${ID}`],
    ["a server with a path", `lilchess://invite?server=${encodeURIComponent("https://chess.example.com/api")}&c=${ID}`],
    ["an unsupported server scheme", `lilchess://invite?server=${encodeURIComponent("file:///etc/passwd")}&c=${ID}`],
  ])("rejects %s", (_label, value) => {
    expect(parseInviteLink(value)).toBeNull();
  });
});

describe("building links", () => {
  const target = { kind: "challenge", id: ID } as const;

  it("builds the https link from the configured server, not from any WebView origin", () => {
    expect(buildShareLink("https://chess.example.com/", target)).toBe(`https://chess.example.com/#/c/${ID}`);
    expect(buildShareLink("http://192.168.1.20:3000", { kind: "simul", code: ID })).toBe(`http://192.168.1.20:3000/#/s/${ID}`);
  });

  it("round-trips both link shapes", () => {
    const server = "http://192.168.1.20:3000";
    expect(parseInviteLink(buildShareLink(server, target))).toEqual({ serverUrl: server, target });
    expect(parseInviteLink(buildAppLink(server, target))).toEqual({ serverUrl: server, target });
  });

  it("maps targets to the web router's paths", () => {
    expect(inviteRoute(target)).toBe(`/c/${ID}`);
    expect(inviteRoute({ kind: "simul", code: ID })).toBe(`/s/${ID}`);
  });
});

describe("sameServer", () => {
  it("compares canonical origins", () => {
    expect(sameServer("https://Chess.example.com/", "chess.example.com")).toBe(true);
    expect(sameServer("https://chess.example.com", "http://chess.example.com")).toBe(false);
    expect(sameServer("https://chess.example.com", "https://chess.example.com:8443")).toBe(false);
    expect(sameServer("not a url", "not a url")).toBe(false);
  });
});
