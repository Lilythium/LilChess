import { describe, expect, it } from "vitest";
import {
  NATIVE_WS_SUBPROTOCOL,
  nativeWebSocketProtocols,
  nativeWebSocketUrl,
} from "./nativeWebSocket.js";

describe("native WebSocket ticket transport", () => {
  it("puts the one-use ticket in a subprotocol, after a stable echoed protocol", () => {
    const ticket = "A".repeat(43);
    expect(nativeWebSocketProtocols(ticket)).toEqual([NATIVE_WS_SUBPROTOCOL, `lilchess-ticket.${ticket}`]);
  });

  it("rejects malformed tickets", () => {
    expect(() => nativeWebSocketProtocols("access_token=secret")).toThrow(/invalid WebSocket ticket/);
  });

  it("derives ws/wss from the selected server without putting credentials in the URL", () => {
    expect(nativeWebSocketUrl("https://Chess.example.com", "/ws/me"))
      .toBe("wss://chess.example.com/ws/me");
    expect(nativeWebSocketUrl("http://192.168.1.4:3000", "/ws/games/abcdef12"))
      .toBe("ws://192.168.1.4:3000/ws/games/abcdef12");
  });

  it("only accepts supported application WebSocket routes", () => {
    expect(() => nativeWebSocketUrl("https://chess.example.com", "/ws/me?token=secret"))
      .toThrow(/Unsupported LilChess WebSocket path/);
    expect(() => nativeWebSocketUrl("https://chess.example.com", "wss://evil.example/ws/me"))
      .toThrow(/Unsupported LilChess WebSocket path/);
  });
});
