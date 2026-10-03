import type { GameEvent, GameState } from "@lilchess/shared";
import type { GameResponse, H2H, Players } from "../types";
import { api } from "../api";
import { applyGameEvent } from "./applyEvent";
import { playSound } from "../audio/audio";
import { crossedLowTimeThreshold, remainingMs } from "./clock";

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
    game: null,
    players: null,
    h2h: null,
    sanByPly: {},
    serverOffset: 0,
    status: "loading",
    error: null,
  });

  const lowTimeWarningPlayed = {
    white: false,
    black: false,
  };

  const previousRemaining = {
    white: null as number | null,
    black: null as number | null,
  };

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

  function checkLowTimeWarning(): void {
    const game = view.game;

    if (!game) return;
    if (game.clock.mode !== "live") return;
    if (game.status !== "started") return;
    if (game.ply < 2) return;

    const side = game.turn;
    const serverNow = Date.now() + view.serverOffset;
    const current = remainingMs(game, side, serverNow);
    const previous = previousRemaining[side];

    if (
      previous !== null &&
      crossedLowTimeThreshold(
        game.clock.initialMs ?? 0,
        previous,
        current,
      ) &&
      !lowTimeWarningPlayed[side]
    ) {
      lowTimeWarningPlayed[side] = true;
      playSound("lowTime");
    }

    previousRemaining[side] = current;
  }

  function applyEvent(event: GameEvent): void {
    if (event.type === "game_over") {
      playSound("gameEnd");
    }

    const outcome = applyGameEvent(view, event);

    if (outcome === "applied" && event.type === "clock") {
      checkLowTimeWarning();
    }

    if (outcome === "resync") {
      void resync();
      return;
    }

    if (outcome === "applied" && event.type === "move") {
      if (event.san === "O-O" || event.san === "O-O-O") {
        playSound("castle");
      } else if (event.san.endsWith("+")) {
        playSound("check");
      } else if (event.san.includes("x")) {
        playSound("capture");
      } else {
        playSound("move");
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