import type { GameState } from "./types.js";

// Pure sanity check for what every GameState must satisfy.
// Returns human-readable problems; [] means consistent.
export function gameStateProblems(g: GameState): string[] {
  const p: string[] = [];

  if (g.ply !== g.moves.length) p.push(`ply ${g.ply} != moves.length ${g.moves.length}`);
  const expectedTurn = g.ply % 2 === 0 ? "white" : "black";
  if (g.turn !== expectedTurn) p.push(`turn ${g.turn} does not match ply ${g.ply}`);
  if (!(g.whiteMs >= 0) || !(g.blackMs >= 0)) p.push("negative or NaN clock");

  if (g.clock.mode === "live") {
    if (!((g.clock.initialMs ?? 0) > 0)) p.push("live game without initialMs");
  } else if (!((g.clock.daysPerMove ?? 0) > 0)) {
    p.push("correspondence game without daysPerMove");
  }

  switch (g.status) {
    case "started":
      if (g.result !== undefined || g.termination !== undefined) p.push("started game has a result/termination");
      if (g.deadlineAt < g.turnStartedAt) p.push("deadline is before the turn started");
      break;
    case "finished":
      if (g.result === undefined) p.push("finished game without a result");
      if (g.termination === undefined || g.termination === "abort") p.push("finished game with missing/abort termination");
      break;
    case "aborted":
      if (g.result !== undefined) p.push("aborted game has a result");
      if (g.termination !== "abort") p.push("aborted game without abort termination");
      break;
  }

  if (g.status !== "started" && (g.drawOfferedBy !== undefined || g.takebackOfferedBy !== undefined)) {
    p.push("offer still pending on an ended game");
  }
  return p;
}