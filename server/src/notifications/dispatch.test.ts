import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, type ClockConfig, type GameState } from "@lilchess/shared";

vi.mock("./mailer.js", () => ({
  emailEnabled: () => true,
  sendMail: vi.fn().mockResolvedValue(true),
}));

import { config } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { insertGame } from "../db/repositories/games.js";
import { notifyChallengeAccepted, notifyChallengeReceived, notifyGameOver, notifyTournamentStarting, notifyYourTurn } from "./dispatch.js";
import { sendMail } from "./mailer.js";
import { setPrefs } from "./queries.js";

const CORR: ClockConfig = { mode: "correspondence", daysPerMove: 3 };
const LIVE: ClockConfig = { mode: "live", initialMs: 60_000, incrementMs: 0 };
const sent = vi.mocked(sendMail);

const seed = (id: string, clock: ClockConfig, white = 1, black = 2) =>
  insertGame(id, white, black, createGame({ clock, now: Date.now() }));

const afterWhite = (clock: ClockConfig = CORR): GameState => ({
  ...createGame({ clock, now: 0 }), moves: ["e2e4"], ply: 1, turn: "black",
});
const resigned = (clock: ClockConfig = CORR): GameState => ({
  ...afterWhite(clock), status: "finished", result: "1-0", termination: "resignation",
});

beforeEach(() => {
  config.baseOrigin = "https://chess.test";
  openDb(":memory:");
  getDb().exec(`
    INSERT INTO users (id, username, password_hash, created_at, email, unsubscribe_token) VALUES
      (1,'alice','x',0,'alice@example.com','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      (2,'bob','x',0,'bob@example.com','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      (3,'carol','x',0,NULL,NULL);
  `);
  sent.mockClear();
});
afterEach(() => {
  closeDb();
  config.baseOrigin = undefined;
});

describe("your turn", () => {
  it("emails the player now on move, with a game link and an unsubscribe link", () => {
    seed("g1", CORR);
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(sent).toHaveBeenCalledTimes(1);
    const mail = sent.mock.calls[0]![0];
    expect(mail.to).toBe("bob@example.com");
    expect(mail.subject).toContain("Alice");
    expect(mail.text).toContain("e4");
    expect(mail.text).toContain("https://chess.test/#/game/g1");
    expect(mail.text).toContain("https://chess.test/#/unsubscribe/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(mail.headers?.["List-Unsubscribe"]).toContain("/#/unsubscribe/");
  });

  it("sends each move once, but a different move at the same ply (after a takeback) again", () => {
    seed("g1", CORR);
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");
    expect(sent).toHaveBeenCalledTimes(1);
    notifyYourTurn("g1", { ...afterWhite(), moves: ["d2d4"] }, "d2d4", "d4");
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for live games, finished games, opted-out users and users without an email", () => {
    seed("live", LIVE);
    notifyYourTurn("live", afterWhite(LIVE), "e2e4", "e4");

    seed("g1", CORR);
    notifyYourTurn("g1", resigned(), "e2e4", "e4");

    setPrefs(2, { your_turn: false });
    notifyYourTurn("g1", afterWhite(), "e2e4", "e4");

    seed("g2", CORR, 1, 3); // carol (black, on move) has no email
    notifyYourTurn("g2", afterWhite(), "e2e4", "e4");

    expect(sent).not.toHaveBeenCalled();
  });
});

describe("game completed", () => {
  it("tells only the player who didn't make the last move", () => {
    seed("g1", CORR);
    notifyGameOver("g1", resigned(), 1); // alice acted
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0].to).toBe("bob@example.com");
    expect(sent.mock.calls[0]![0].text).toContain("lost by resignation");
  });

  it("tells both after a timeout, and never twice", () => {
    seed("g1", CORR);
    notifyGameOver("g1", resigned(), null);
    notifyGameOver("g1", resigned(), null);
    expect(sent.mock.calls.map((c) => c[0].to).sort()).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("ignores live games and games still in progress", () => {
    seed("live", LIVE);
    notifyGameOver("live", resigned(LIVE), null);
    seed("g1", CORR);
    notifyGameOver("g1", afterWhite(), null);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("challenges", () => {
  it("emails each targeted challenge once, without suppressing later challenges", () => {
    const o = { challengeId: "challenge-1", fromName: "alice", toId: 2, clock: CORR };
    notifyChallengeReceived(o);
    notifyChallengeReceived(o);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toMatchObject({ to: "bob@example.com" });
    expect(sent.mock.calls[0]![0].subject).toContain("3 days per move");

    notifyChallengeReceived({ ...o, challengeId: "challenge-2" });
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("tells the challenger when a correspondence challenge is accepted", () => {
    seed("g1", CORR); // alice is white: she created the challenge, bob accepted
    notifyChallengeAccepted("g1", 2);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0].to).toBe("alice@example.com");
    expect(sent.mock.calls[0]![0].text).toContain("your move");
  });

  it("does not email about accepted live challenges", () => {
    seed("g1", LIVE);
    notifyChallengeAccepted("g1", 2);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("tournament starting", () => {
  it("emails registered participants with a tournament link once each", () => {
    getDb().prepare(`
      INSERT INTO tournaments (id, created_by, name, mode, initial_ms, increment_ms, variant, max_players, created_at)
      VALUES ('tournament01', 1, 'Friday Cup', 'live', 60000, 0, 'standard', 4, 0)
    `).run();
    getDb().prepare(`
      INSERT INTO tournament_participants (tournament_id, user_id, joined_at) VALUES
        ('tournament01', 1, 0), ('tournament01', 2, 0), ('tournament01', 3, 0)
    `).run();

    notifyTournamentStarting("tournament01");
    notifyTournamentStarting("tournament01");

    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent.mock.calls.map((call) => call[0].to).sort()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(sent.mock.calls[0]![0].text).toContain("https://chess.test/#/tournament/tournament01");
  });
});