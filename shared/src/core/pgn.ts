import { START_FEN } from "./types.js";
import type { GameState } from "./types.js";

export interface BuildPgnOptions {
  game: GameState;
  sans: string[]; // SAN per ply, in order
  white: string;
  black: string;
  createdAt: number; // epoch ms
  site?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function timeControlTag(game: GameState): string {
  const c = game.clock;
  if (c.mode === "live") {
    return `${Math.round((c.initialMs ?? 0) / 1000)}+${Math.round((c.incrementMs ?? 0) / 1000)}`;
  }
  return `1/${(c.daysPerMove ?? 1) * 86_400}`; // PGN: one move per N seconds
}

function terminationTag(game: GameState): string {
  if (game.status === "started") return "Unterminated";
  if (game.status === "aborted") return "Abandoned";
  return game.termination === "timeout" ? "Time forfeit" : "Normal";
}

function wrap(tokens: string[], width = 80): string {
  const lines: string[] = [];
  let line = "";
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > width) {
      lines.push(line);
      line = t;
    } else {
      line = line ? `${line} ${t}` : t;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// Standard games from the normal start position (variants and black-to-move
// starting FENs are not handled yet).
export function buildPgn(o: BuildPgnOptions): string {
  const { game } = o;
  const d = new Date(o.createdAt);
  const date = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  const result = game.status === "finished" && game.result ? game.result : "*";

  const headers: [string, string][] = [
    ["Event", `LilChess ${game.clock.mode} game`],
    ["Site", o.site ?? "LilChess"],
    ["Date", date],
    ["Round", "-"],
    ["White", o.white],
    ["Black", o.black],
    ["Result", result],
    ["TimeControl", timeControlTag(game)],
    ["Termination", terminationTag(game)],
  ];
  if (game.initialFen !== START_FEN) headers.push(["SetUp", "1"], ["FEN", game.initialFen]);

  const tokens: string[] = [];
  o.sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
  });
  tokens.push(result);

  const head = headers.map(([k, v]) => `[${k} "${esc(v)}"]`).join("\n");
  return `${head}\n\n${wrap(tokens)}\n`;
}