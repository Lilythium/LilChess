import type { RawScore } from "./score.js";

export interface EngineInfo {
  depth: number;
  multipv: number;
  score: RawScore; // side-to-move point of view
  pv: string[]; // UCI moves
  nodes?: number;
  nps?: number;
  bound?: "lower" | "upper"; // set when the score is only a bound (fail-high / fail-low)
}

/**
 * Parses an `info ...` line. Returns null for anything that is not a usable
 * principal-variation report (info string, currmove, a terminal position's
 * `info depth 0 score mate 0`, ...).
 */
export function parseInfoLine(line: string): EngineInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== "info") return null;

  let depth: number | undefined;
  let multipv = 1;
  let score: RawScore | undefined;
  let bound: EngineInfo["bound"];
  let nodes: number | undefined;
  let nps: number | undefined;
  let pv: string[] = [];

  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case "depth": depth = Number(t[++i]); break;
      case "multipv": multipv = Number(t[++i]); break;
      case "nodes": nodes = Number(t[++i]); break;
      case "nps": nps = Number(t[++i]); break;
      case "score": {
        const kind = t[++i];
        const value = Number(t[++i]);
        if (!Number.isFinite(value)) return null;
        score = kind === "cp" ? { kind: "cp", cp: value } : kind === "mate" ? { kind: "mate", moves: value } : undefined;
        break;
      }
      case "lowerbound": bound = "lower"; break;
      case "upperbound": bound = "upper"; break;
      case "string": return null; // free text until the end of the line
      case "pv": pv = t.slice(i + 1); i = t.length; break;
    }
  }

  if (depth === undefined || !Number.isFinite(depth) || !score || pv.length === 0) return null;
  return { depth, multipv, score, pv, nodes, nps, bound };
}

/** `bestmove e2e4 ponder e7e5` → { move: "e2e4" }; `bestmove (none)` → { move: null }. */
export function parseBestMove(line: string): { move: string | null } | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== "bestmove" || !t[1]) return null;
  return { move: t[1] === "(none)" || t[1] === "0000" ? null : t[1] };
}
