import type { GameEvent, GameState } from "@lilchess/shared";
import type { GameResponse, H2H, Players } from "../types";
import { api } from "../api";

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
    if (!view.game) return;
    switch (event.type) {
      case "move": {
        if (event.ply <= view.game.ply) return;            // duplicate / already applied
        if (event.ply !== view.game.ply + 1) { void resync(); return; } // gap
        view.game.moves.push(event.uci);
        view.game.ply = event.ply;
        view.game.turn = event.turn;
        view.game.whiteMs = event.whiteMs;
        view.game.blackMs = event.blackMs;
        view.game.deadlineAt = event.deadlineAt;
        view.game.drawOfferedBy = undefined;
        view.game.takebackOfferedBy = undefined;
        view.sanByPly[event.ply] = event.san;
        break;
      }
      case "clock":
        view.game.whiteMs = event.whiteMs; view.game.blackMs = event.blackMs;
        view.game.deadlineAt = event.deadlineAt; break;
      case "draw_offer": view.game.drawOfferedBy = event.by ?? undefined; break;
      case "takeback_offer": view.game.takebackOfferedBy = event.by ?? undefined; break;
      case "takeback":
        view.game.takebackOfferedBy = undefined;
        void resync(); // moves, SANs and clocks all changed
        break;
      case "game_over":
        view.game.status = event.status; view.game.result = event.result;
        view.game.termination = event.termination;
        void resync(); // pick up final clocks and the updated H2H
        break;
    }
  }

  return { get view() { return view; }, resync, applyEvent };
}