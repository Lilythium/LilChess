import { randomBytes } from "node:crypto";
import { createGame, type ClockConfig, type Variant } from "@lilchess/shared";
import { getDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";

export class TournamentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TournamentError";
  }
}

export interface TournamentConfig {
  name: string;
  mode: "live" | "correspondence";
  initialMs?: number;
  incrementMs?: number;
  daysPerMove?: number;
  variant: Variant;
  maxPlayers: number;
}

export function createTournament(creatorId: number, config: TournamentConfig): string {
  const db = getDb();
  const id = randomBytes(8).toString("hex");
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO tournaments (
        id, created_by, name, mode, initial_ms, increment_ms, days_per_move,
        variant, max_players, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, creatorId, config.name, config.mode,
      config.initialMs ?? null, config.incrementMs ?? null, config.daysPerMove ?? null,
      config.variant, config.maxPlayers, now,
    );
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES (?, ?, ?)`)
      .run(id, creatorId, now);
  })();
  return id;
}

export function listTournaments(viewerId: number) {
  const db = getDb();
  return db.prepare(`
    SELECT t.id, t.name, t.status, t.format, t.mode, t.variant, t.max_players AS maxPlayers,
           t.created_at AS createdAt, COUNT(DISTINCT p.user_id) AS participantCount,
           COUNT(DISTINCT tg.game_id) AS gameCount,
           MAX(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS joined,
           CASE WHEN t.mode = 'live' AND t.status = 'running' THEN (
             SELECT tg.game_id FROM tournament_games tg JOIN games g ON g.id = tg.game_id
             WHERE tg.tournament_id = t.id AND g.status = 'started'
               AND (g.white_id = ? OR g.black_id = ?)
             ORDER BY tg.round_number, tg.game_id LIMIT 1
           ) END AS nextGameId
    FROM tournaments t
    LEFT JOIN tournament_participants p ON p.tournament_id = t.id
    LEFT JOIN tournament_games tg ON tg.tournament_id = t.id
    GROUP BY t.id
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'running' THEN 1 ELSE 2 END, t.created_at DESC
    LIMIT 100
  `).all(viewerId, viewerId, viewerId);
}

export function joinTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  db.transaction(() => {
    const tournament = db.prepare(`SELECT status, max_players FROM tournaments WHERE id = ?`)
      .get(tournamentId) as { status: string; max_players: number } | undefined;
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    if (tournament.status !== "open") throw new TournamentError("Registration is closed", 409);
    const joined = db.prepare(`SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
      .get(tournamentId, userId);
    if (joined) throw new TournamentError("Already registered", 409);
    const count = db.prepare(`SELECT COUNT(*) AS count FROM tournament_participants WHERE tournament_id = ?`)
      .get(tournamentId) as { count: number };
    if (count.count >= tournament.max_players) throw new TournamentError("Tournament is full", 409);
    db.prepare(`INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES (?, ?, ?)`)
      .run(tournamentId, userId, Date.now());
  }).immediate();
}

export function withdrawTournament(tournamentId: string, userId: number): void {
  const db = getDb();
  const tournament = db.prepare(`SELECT status FROM tournaments WHERE id = ?`).get(tournamentId) as
    { status: string } | undefined;
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (tournament.status !== "open") throw new TournamentError("Registration is closed", 409);
  const result = db.prepare(`DELETE FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`)
    .run(tournamentId, userId);
  if (result.changes === 0) throw new TournamentError("Not registered", 404);
}

function roundRobinRounds(players: number[]): [number, number, number][] {
  const slots: (number | null)[] = [...players];
  if (slots.length % 2) slots.push(null);
  const rounds: [number, number, number][] = [];
  const roundCount = slots.length - 1;

  for (let round = 0; round < roundCount; round++) {
    for (let pair = 0; pair < slots.length / 2; pair++) {
      const left = slots[pair];
      const right = slots[slots.length - 1 - pair];
      if (left != null && right != null) {
        const white = (round + pair) % 2 === 0 ? left : right;
        const black = white === left ? right : left;
        rounds.push([round + 1, white, black]);
      }
    }
    const fixed = slots[0]!;
    const rotating = slots.slice(1);
    rotating.unshift(rotating.pop()!);
    slots.splice(0, slots.length, fixed, ...rotating);
  }
  return rounds;
}

export function startTournament(tournamentId: string, organizerId: number): number {
  const db = getDb();
  const transaction = db.transaction(() => {
    const tournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId) as
      | { created_by: number; status: string; mode: "live" | "correspondence"; initial_ms: number | null;
          increment_ms: number | null; days_per_move: number | null; variant: Variant }
      | undefined;
    if (!tournament) throw new TournamentError("Tournament not found", 404);
    if (tournament.created_by !== organizerId) throw new TournamentError("Only the organizer can start this tournament", 403);
    if (tournament.status !== "open") throw new TournamentError("Tournament is not open", 409);

    const participants = db.prepare(`SELECT user_id FROM tournament_participants WHERE tournament_id = ? ORDER BY joined_at, user_id`)
      .all(tournamentId) as { user_id: number }[];
    if (participants.length < 2) throw new TournamentError("At least two players are required", 409);

    const clock: ClockConfig = tournament.mode === "live"
      ? { mode: "live", initialMs: tournament.initial_ms!, incrementMs: tournament.increment_ms ?? 0 }
      : { mode: "correspondence", daysPerMove: tournament.days_per_move! };
    const now = Date.now();
    db.prepare(`UPDATE tournaments SET status = 'running', started_at = ? WHERE id = ?`).run(now, tournamentId);

    let number = 0;
    for (const [round, white, black] of roundRobinRounds(participants.map((p) => p.user_id))) {
      const gameId = randomBytes(5).toString("hex");
      insertGame(gameId, white, black, createGame({ clock, now, variant: tournament.variant }));
      db.prepare(`INSERT INTO tournament_games (tournament_id, game_id, round_number) VALUES (?, ?, ?)`)
        .run(tournamentId, gameId, round);
      number++;
    }
    return number;
  });
  return transaction.immediate();
}

export function cancelTournament(tournamentId: string, organizerId: number): void {
  const result = getDb().prepare(`
    UPDATE tournaments SET status = 'cancelled'
    WHERE id = ? AND created_by = ? AND status = 'open'
  `).run(tournamentId, organizerId);
  if (result.changes) return;
  const tournament = getDb().prepare(`SELECT created_by, status FROM tournaments WHERE id = ?`).get(tournamentId) as
    { created_by: number; status: string } | undefined;
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  if (tournament.created_by !== organizerId) throw new TournamentError("Only the organizer can cancel this tournament", 403);
  throw new TournamentError("Only open tournaments can be cancelled", 409);
}

export function getTournament(tournamentId: string, viewerId: number) {
  const db = getDb();
  let tournament = db.prepare(`SELECT t.*, u.username AS organizer FROM tournaments t JOIN users u ON u.id = t.created_by WHERE t.id = ?`)
    .get(tournamentId) as Record<string, any> | undefined;
  if (!tournament) return undefined;

  if (tournament.status === "running") {
    const unfinished = db.prepare(`
      SELECT 1 FROM tournament_games tg JOIN games g ON g.id = tg.game_id
      WHERE tg.tournament_id = ? AND g.status = 'started' LIMIT 1
    `).get(tournamentId);
    if (!unfinished) {
      db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ? AND status = 'running'`).run(tournamentId);
      tournament = { ...tournament, status: "completed" };
    }
  }

  const participants = db.prepare(`
    SELECT u.id, u.username, p.joined_at AS joinedAt
    FROM tournament_participants p JOIN users u ON u.id = p.user_id
    WHERE p.tournament_id = ?
  `).all(tournamentId) as { id: number; username: string; joinedAt: number }[];
  const games = db.prepare(`
    SELECT tg.round_number AS round, g.id, g.status, g.result, g.termination, g.ended_at AS endedAt,
           g.white_id AS whiteId, wu.username AS whiteName, g.black_id AS blackId, bu.username AS blackName
    FROM tournament_games tg JOIN games g ON g.id = tg.game_id
    JOIN users wu ON wu.id = g.white_id JOIN users bu ON bu.id = g.black_id
    WHERE tg.tournament_id = ? ORDER BY tg.round_number, g.created_at, g.id
  `).all(tournamentId) as { round: number; id: string; status: string; result: string | null;
    whiteId: number; whiteName: string; blackId: number; blackName: string }[];

  const standings = participants.map((participant) => {
    const played = games.filter((game) => game.status !== "started" &&
      (game.whiteId === participant.id || game.blackId === participant.id));
    const points = played.reduce((total, game) => {
      if (game.result === "1/2-1/2") return total + 0.5;
      if ((game.result === "1-0" && game.whiteId === participant.id) ||
          (game.result === "0-1" && game.blackId === participant.id)) return total + 1;
      return total;
    }, 0);
    const wins = played.filter((game) =>
      (game.result === "1-0" && game.whiteId === participant.id) ||
      (game.result === "0-1" && game.blackId === participant.id)).length;
    return { ...participant, points, wins, gamesPlayed: played.length };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins || a.username.localeCompare(b.username));

  return {
    tournament: {
      id: tournament.id, name: tournament.name, status: tournament.status, format: tournament.format,
      mode: tournament.mode, initialMs: tournament.initial_ms, incrementMs: tournament.increment_ms,
      daysPerMove: tournament.days_per_move, variant: tournament.variant, maxPlayers: tournament.max_players,
      organizer: tournament.organizer, createdAt: tournament.created_at, startedAt: tournament.started_at,
      joined: participants.some((p) => p.id === viewerId), isOrganizer: tournament.created_by === viewerId,
    },
    participants,
    standings,
    games,
  };
}