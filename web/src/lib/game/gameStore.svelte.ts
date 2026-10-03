import type { GameEvent, GameState } from "@lilchess/shared";
import type { GameResponse, H2H, Players } from "../types";
import { api } from "../api";
import { applyGameEvent } from "./applyEvent";

export interface GameView {
  game: GameState | null;
  players: Players | null;
  h2h: H2H | null;
  sanByPly: Record<number, string>;
  serverOffset: number; // serverNow - clientNow, for clock display
  status: "loading" | "ready" | "error";
  error: string | null;
}

export function createGameStore(gameId: string) {
  const view = $state<GameView>({
    game: null, players: null, h2h: null, sanByPly: {}, serverOffset: 0, status: "loading", error: null,
  });

  async function resync(): Promise<void> {
    try {
      const body = await api<GameResponse>(`/api/games/${gameId}`);
      view.game = body.game;
      view.players = body.players;
      view.h2h = body.h2h;
      view.serverOffset = body.serverNow - Date.now();
      view.sanByPly = Object.fromEntries(body.sans.map((s, i) => [i + 1, s]));
      view.status = "ready";
      view.error = null;
    } catch (err) {
      view.status = "error";
      view.error = err instanceof Error ? err.message : String(err);
    }
  }

  function applyEvent(event: GameEvent): void {
    if (applyGameEvent(view, event) === "resync") void resync();
  }

  return { get view() { return view; }, resync, applyEvent };
}