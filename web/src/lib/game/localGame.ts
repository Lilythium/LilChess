import { createGame, type GameState } from "@lilchess/shared";

export interface LocalConfig { minutes: number | null; incrementSec: number } // minutes null = no clock
export interface LocalSave { game: GameState; sans: string[]; config: LocalConfig; timed: boolean }

const KEY = "lilchess.local";
const UNTIMED_MS = 100 * 60 * 60 * 1000; // 100h: effectively no clock

export function saveLocalGame(s: LocalSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode, quota); the game still works in memory
  }
}

export function loadLocalGame(): LocalSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalSave) : null;
  } catch {
    return null;
  }
}

export function startLocalGame(config: LocalConfig): LocalSave {
  const timed = config.minutes !== null;
  const initialMs = config.minutes === null ? UNTIMED_MS : config.minutes * 60_000;
  const save: LocalSave = {
    game: createGame({
      clock: { mode: "live", initialMs, incrementMs: config.incrementSec * 1000 },
      now: Date.now(),
    }),
    sans: [],
    config,
    timed,
  };
  saveLocalGame(save);
  return save;
}