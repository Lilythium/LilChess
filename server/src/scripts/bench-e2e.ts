/**
 * End-to-end move latency: a real server process, real sockets, real HTTP.
 *
 * The other benches call the repository functions in-process, so they cannot see the HTTP stack, the
 * WebSocket fan-out, JSON, authentication or the disk. This one starts the server as a child process on a
 * temporary file database and plays N concurrent games, each with two WebSocket clients (one per player).
 * It measures, per move, the time from "mover sends" to "opponent's socket receives the move event" - the
 * latency a player actually experiences on top of the network - once with moves sent over the WebSocket and
 * once with moves sent as HTTP POST /api/games/:id/move (what the web client did before).
 *
 *   npm run bench:e2e -w server -- --games 20 --plies 80 --think 150 --transport both
 *
 * Moves are paced by --think (milliseconds of "thinking" before each move) because a human cannot move every
 * millisecond, and the server's flood control would close a socket that did. The first --warmup plies of each
 * game are played but not measured (JIT warm-up, and the HTTP client opening its keep-alive connection).
 * Everything runs on loopback, so these numbers are the server-side and protocol cost only; real network
 * round trips come on top.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeUci, parseUci, squareRank } from "chessops/util";
import WebSocket from "ws";
import { createGame } from "@lilchess/shared";
import { generateSessionToken, hashSessionToken } from "../auth/crypto.js";
import { createSession } from "../auth/queries.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";

type Transport = "ws" | "http";

interface Options {
  games: number;
  plies: number;
  thinkMs: number;
  warmup: number; // plies at the start of each game that are played but not measured
  transports: Transport[];
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  const transport = get("transport", "both");
  if (!["ws", "http", "both"].includes(transport)) throw new Error("--transport must be ws, http or both");
  return {
    games: Number(get("games", "20")),
    plies: Number(get("plies", "80")),
    thinkMs: Number(get("think", "150")),
    warmup: Number(get("warmup", "6")),
    transports: transport === "both" ? ["ws", "http"] : [transport as Transport],
  };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

interface Seat {
  userId: number;
  token: string;
  ip: string; // distinct per player: the server rate-limits per client IP (read from X-Forwarded-For below)
}
interface GameSetup {
  id: string;
  white: Seat;
  black: Seat;
}

/** Writes users, sessions and fresh games straight into the database before the server starts. */
function seed(dbFile: string, games: number): GameSetup[] {
  openDb(dbFile);
  const setups: GameSetup[] = [];
  const insertUser = getDb().prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', 0)`,
  );
  const seat = (userId: number, game: number, color: number): Seat => {
    insertUser.run(userId, `e2e${userId}`);
    const token = generateSessionToken();
    createSession(hashSessionToken(token), userId, Date.now() + 24 * 3_600_000);
    return { userId, token, ip: `10.${Math.floor(game / 250)}.${game % 250}.${color + 1}` };
  };
  for (let g = 0; g < games; g++) {
    const white = seat(g * 2 + 1, g, 0);
    const black = seat(g * 2 + 2, g, 1);
    const id = `e2e${g.toString(16).padStart(5, "0")}`;
    insertGame(
      id,
      white.userId,
      black.userId,
      createGame({ clock: { mode: "live", initialMs: 3 * 3_600_000, incrementMs: 0 }, now: Date.now() }),
    );
    setups.push({ id, white, black });
  }
  closeDb();
  return setups;
}

async function startServer(dataDir: string, port: number): Promise<ChildProcess> {
  const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const child = spawn(process.execPath, ["--import", "tsx", join(serverRoot, "src", "index.ts")], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(port),
      LOG_LEVEL: "warn",
      TRUST_PROXY: "true", // lets each simulated player present its own client IP
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${stderr}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return child;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  child.kill();
  throw new Error(`server did not become healthy:\n${stderr}`);
}

function serverRssMB(child: ChildProcess): number | undefined {
  try {
    const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
    const kb = /VmRSS:\s+(\d+) kB/.exec(status)?.[1];
    return kb ? Number(kb) / 1024 : undefined;
  } catch {
    return undefined; // not Linux
  }
}

function randomLegalUci(pos: Chess, rnd: () => number): string | null {
  const all: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const isPawn = pos.board.get(from)?.role === "pawn";
    for (const to of dests) {
      const lastRank = squareRank(to) === 0 || squareRank(to) === 7;
      all.push(makeUci({ from, to, promotion: isPawn && lastRank ? "queen" : undefined }));
    }
  }
  return all.length ? all[Math.floor(rnd() * all.length)]! : null;
}

interface Stats {
  observerMs: number[]; // mover sends -> opponent's socket receives the move event
  selfMs: number[]; // mover sends -> mover's own socket receives the move event
  ackMs: number[]; // HTTP only: mover sends -> HTTP response
  errors: number;
  timeouts: number;
}

function connect(port: number, game: GameSetup, seat: Seat): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/games/${game.id}`, {
      headers: { cookie: `sessionId=${seat.token}`, "x-forwarded-for": seat.ip },
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`upgrade refused: ${res.statusCode}`)));
  });
}

async function playGame(
  port: number,
  game: GameSetup,
  index: number,
  transport: Transport,
  opts: Options,
  stats: Stats,
): Promise<void> {
  const seats = [game.white, game.black];
  const sockets = await Promise.all(seats.map((seat) => connect(port, game, seat)));
  // One resolver table per socket: resulting ply -> called with the receive time.
  const waiting = sockets.map(() => new Map<number, (t: number) => void>());
  sockets.forEach((ws, i) => {
    ws.on("message", (data) => {
      const at = performance.now();
      const msg = JSON.parse(data.toString()) as { type: string; ply?: number };
      if (msg.type === "move" && msg.ply !== undefined) waiting[i]!.get(msg.ply)?.(at);
      else if (msg.type === "error") stats.errors++;
    });
  });

  const receipt = (socketIndex: number, ply: number) =>
    new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3_000);
      waiting[socketIndex]!.set(ply, (t) => {
        clearTimeout(timer);
        resolve(t);
      });
    });

  const rnd = mulberry32(1_000 + index);
  const pos = Chess.default();

  for (let ply = 1; ply <= opts.plies; ply++) {
    await sleep(opts.thinkMs);
    const mover = (ply - 1) % 2;
    const uci = randomLegalUci(pos, rnd);
    if (!uci) break;

    const atObserver = receipt(1 - mover, ply);
    const atMover = receipt(mover, ply);
    atObserver.catch(() => {}); // surfaced below; avoids an unhandled rejection if the other one fails first
    atMover.catch(() => {});

    const sentAt = performance.now();
    const body = { ply: ply - 1, uci };
    if (transport === "ws") {
      sockets[mover]!.send(JSON.stringify({ type: "move", ...body }));
    } else {
      void fetch(`http://127.0.0.1:${port}/api/games/${game.id}/move`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `sessionId=${seats[mover]!.token}`,
          "x-forwarded-for": seats[mover]!.ip,
        },
        body: JSON.stringify(body),
      }).then(async (res) => {
        await res.arrayBuffer();
        if (!res.ok) stats.errors++;
        else if (ply > opts.warmup) stats.ackMs.push(performance.now() - sentAt);
      });
    }

    try {
      const [tObserver, tMover] = await Promise.all([atObserver, atMover]);
      if (ply > opts.warmup) {
        stats.observerMs.push(tObserver - sentAt);
        stats.selfMs.push(tMover - sentAt);
      }
    } catch {
      stats.timeouts++;
      break; // the game is out of step (or over); stop rather than send moves into the void
    }

    pos.play(parseUci(uci)!); // generated by randomLegalUci, so it always parses and is legal
  }

  for (const ws of sockets) ws.close();
}

interface Result {
  transport: Transport;
  moves: number;
  observer: [number, number, number];
  self: [number, number, number];
  ack?: [number, number, number];
  errors: number;
  timeouts: number;
  serverRssMB?: number;
}

async function runTransport(transport: Transport, opts: Options): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), `lilchess-e2e-${transport}-`));
  const port = await freePort();
  let server: ChildProcess | undefined;
  try {
    const games = seed(join(dir, "lilchess.db"), opts.games);
    server = await startServer(dir, port);

    const stats: Stats = { observerMs: [], selfMs: [], ackMs: [], errors: 0, timeouts: 0 };
    await Promise.all(games.map((game, i) => playGame(port, game, i, transport, opts, stats)));

    const triple = (v: number[]): [number, number, number] => [pct(v, 0.5), pct(v, 0.95), pct(v, 0.99)];
    return {
      transport,
      moves: stats.observerMs.length,
      observer: triple(stats.observerMs),
      self: triple(stats.selfMs),
      ack: transport === "http" ? triple(stats.ackMs) : undefined,
      errors: stats.errors,
      timeouts: stats.timeouts,
      serverRssMB: serverRssMB(server),
    };
  } finally {
    server?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `bench:e2e - ${opts.games} concurrent games x ${opts.plies} plies, ${opts.thinkMs} ms think time, real server process on loopback\n`,
  );

  const results: Result[] = [];
  for (const transport of opts.transports) {
    console.log(`Running transport=${transport}...`);
    results.push(await runTransport(transport, opts));
  }

  const f = (n: number) => n.toFixed(2);
  console.log("\n--- End-to-end move latency (ms) ---");
  console.table(
    results.map((r) => ({
      transport: r.transport,
      moves: r.moves,
      "opponent p50": f(r.observer[0]),
      "opponent p95": f(r.observer[1]),
      "opponent p99": f(r.observer[2]),
      "mover echo p50": f(r.self[0]),
      "http ack p50": r.ack ? f(r.ack[0]) : "-",
      errors: r.errors,
      timeouts: r.timeouts,
      "server RSS MB": r.serverRssMB ? r.serverRssMB.toFixed(0) : "-",
    })),
  );
  console.log("opponent = mover sends -> opponent's socket receives the move event.");
  if (results.some((r) => r.errors > 0 || r.timeouts > 0)) process.exitCode = 1;
}

void main();
