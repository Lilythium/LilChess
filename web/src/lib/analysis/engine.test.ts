import { describe, expect, it } from "vitest";
import { Engine, type EngineTransport } from "./engine";

/** A scripted UCI engine: replies to `go` with canned lines, one tick later. */
function fakeTransport(script: (command: string, emit: (line: string) => void) => void) {
  let listener: (line: string) => void = () => {};
  let errorListener: (m: string) => void = () => {};
  const sent: string[] = [];
  const transport: EngineTransport = {
    send(command) {
      sent.push(command);
      queueMicrotask(() => script(command, (l) => listener(l)));
    },
    onLine: (l) => (listener = l),
    onError: (l) => (errorListener = l),
    terminate: () => sent.push("<terminate>"),
  };
  return { transport, sent, fail: (m: string) => errorListener(m) };
}

const basicScript = (command: string, emit: (l: string) => void) => {
  if (command === "uci") emit("uciok");
  if (command === "isready") emit("readyok");
  if (command.startsWith("go")) {
    emit("info depth 10 multipv 1 score cp 30 pv e2e4 e7e5");
    emit("info depth 12 multipv 1 score cp 40 pv e2e4 c7c5");
    emit("info depth 12 multipv 1 score cp 45 lowerbound pv d2d4"); // bound: ignored
    emit("info depth 12 multipv 2 score cp 20 pv d2d4 d7d5");
    emit("bestmove e2e4 ponder c7c5");
  }
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("Engine", () => {
  it("initialises with uci / isready", async () => {
    const { transport, sent } = fakeTransport(basicScript);
    await new Engine(transport).init();
    expect(sent).toEqual(["uci", "isready"]);
  });

  it("returns the best move and the latest line per multipv, sorted", async () => {
    const { transport, sent } = fakeTransport(basicScript);
    const engine = new Engine(transport);
    await engine.init();
    const updates: number[] = [];
    const r = await engine.search({ fen: START, chess960: false, depth: 12, multipv: 2, onUpdate: (l) => updates.push(l.length) });

    expect(r.cancelled).toBe(false);
    expect(r.bestMove).toBe("e2e4");
    expect(r.lines.map((l) => [l.multipv, l.depth, l.pv[0]])).toEqual([[1, 12, "e2e4"], [2, 12, "d2d4"]]);
    expect(r.lines[0]!.score).toEqual({ kind: "cp", cp: 40 }); // bound line did not overwrite it
    expect(updates).toEqual([1, 1, 2]);
    expect(sent).toContain("setoption name MultiPV value 2");
    expect(sent.slice(-2)).toEqual([`position fen ${START}`, "go depth 12"]);
  });

  it("converts scores to White's point of view", async () => {
    const { transport } = fakeTransport(basicScript);
    const engine = new Engine(transport);
    await engine.init();
    const r = await engine.search({ fen: BLACK_TO_MOVE, chess960: false, depth: 10 });
    expect(r.lines[0]!.score).toEqual({ kind: "cp", cp: -40 }); // +40 for Black = -40 for White
  });

  it("only sends option changes when they change", async () => {
    const { transport, sent } = fakeTransport(basicScript);
    const engine = new Engine(transport);
    await engine.init();
    await engine.search({ fen: START, chess960: true, depth: 8 });
    await engine.search({ fen: START, chess960: true, depth: 8 });
    expect(sent.filter((c) => c.includes("UCI_Chess960"))).toEqual(["setoption name UCI_Chess960 value true"]);
    expect(sent.filter((c) => c.includes("MultiPV"))).toEqual([]); // default of 1 needs no command
  });

  it("returns a null best move for a finished position", async () => {
    const { transport } = fakeTransport((c, emit) => {
      if (c === "uci") emit("uciok");
      if (c === "isready") emit("readyok");
      if (c.startsWith("go")) { emit("info depth 0 score mate 0"); emit("bestmove (none)"); }
    });
    const engine = new Engine(transport);
    await engine.init();
    const r = await engine.search({ fen: START, chess960: false, depth: 5 });
    expect(r).toEqual({ cancelled: false, bestMove: null, lines: [] });
  });

  it("stops the running search when a new one starts, and only the newest counts", async () => {
    // The engine only answers `go` when told to `stop`, like an infinite search.
    let pendingBest = false;
    const { transport, sent } = fakeTransport((c, emit) => {
      if (c === "uci") emit("uciok");
      if (c === "isready") emit("readyok");
      if (c.startsWith("go")) { pendingBest = true; emit("info depth 3 multipv 1 score cp 5 pv e2e4"); }
      if (c === "stop" && pendingBest) { pendingBest = false; emit("bestmove e2e4"); }
    });
    const engine = new Engine(transport);
    await engine.init();

    const first = engine.search({ fen: START, chess960: false, depth: 99 });
    await Promise.resolve();
    const second = engine.search({ fen: BLACK_TO_MOVE, chess960: false, depth: 99 });
    const third = engine.search({ fen: START, chess960: false, depth: 99 });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    engine.stop();

    const results = await Promise.all([first, second, third]);
    expect(results.every((r) => r.cancelled)).toBe(true); // stop() cancelled the survivor too
    // The superseded middle search never reached the engine.
    expect(sent.filter((c) => c.startsWith("position"))).toEqual([`position fen ${START}`, `position fen ${START}`]);
  });

  it("rejects pending work and cancels searches when the transport reports an error", async () => {
    const { transport, fail } = fakeTransport(() => {}); // never answers
    const engine = new Engine(transport);
    const init = engine.init();
    fail("boom");
    await expect(init).rejects.toThrow("boom");
    await expect(engine.search({ fen: START, chess960: false, depth: 5 })).rejects.toThrow("boom");
  });

  it("dispose terminates the worker and resolves an in-flight search as cancelled", async () => {
    const { transport, sent } = fakeTransport((c, emit) => {
      if (c === "uci") emit("uciok");
      if (c === "isready") emit("readyok");
    });
    const engine = new Engine(transport);
    await engine.init();
    const running = engine.search({ fen: START, chess960: false, depth: 99 });
    await Promise.resolve();
    engine.dispose();
    expect((await running).cancelled).toBe(true);
    expect(sent).toContain("<terminate>");
    expect((await engine.search({ fen: START, chess960: false, depth: 5 })).cancelled).toBe(true);
  });
});
