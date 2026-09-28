import type { Color, GameEvent, GameState } from "@lilchess/shared";

export interface GameView {
  game: GameState | null;
  sanByPly: Record<number, string>;
  status: "loading" | "ready" | "error";
  error: string | null;
}

export function createGameStore(gameId: string) {
  const view = $state<GameView>({
    game: null,
    sanByPly: {},
    status: "loading",
    error: null,
  });

  async function resync(): Promise<void> {
    try {
      const res = await fetch(`/api/games/${gameId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as { ok: true; game: GameState };
      view.game = body.game;
      view.status = "ready";
      view.error = null;
    } catch (err) {
      view.status = "error";
      view.error = err instanceof Error ? err.message : String(err);
    }
  }

  function applyEvent(event: GameEvent): void {
    if (!view.game) return; // resync() hasn't populated anything yet

    switch (event.type) {
      case "move": {
        // Only apply in-order deltas. A gap means something was missed
        // while disconnected — don't try to patch around it.
        if (event.ply !== view.game.ply + 1) {
          void resync();
          return;
        }
        view.game.moves.push(event.uci);
        view.game.ply = event.ply;
        view.game.turn = event.turn;
        view.game.whiteMs = event.whiteMs;
        view.game.blackMs = event.blackMs;
        view.game.deadlineAt = event.deadlineAt;
        view.game.drawOfferedBy = undefined; // a move clears any pending offer
        view.sanByPly[event.ply] = event.san;
        break;
      }
      case "clock": {
        view.game.whiteMs = event.whiteMs;
        view.game.blackMs = event.blackMs;
        view.game.deadlineAt = event.deadlineAt;
        break;
      }
      case "draw_offer": {
        view.game.drawOfferedBy = event.by ?? undefined;
        break;
      }
      case "game_over": {
        view.game.status = event.status;
        view.game.result = event.result;
        view.game.termination = event.termination;
        break;
      }
    }
  }

  return {
    get view() {
      return view;
    },
    resync,
    applyEvent,
  };
}