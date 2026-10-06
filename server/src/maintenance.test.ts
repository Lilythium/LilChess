import { createGame } from "@lilchess/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, openDb } from "./db/connection.js";
import { insertGame } from "./db/repositories/games.js";
import { purgeExpired } from "./maintenance.js";

const FAR = 9_999_999_999_999;

beforeEach(() => {
  openDb(":memory:");
  getDb().exec(`
    INSERT INTO users (id, username, password_hash, created_at, is_guest) VALUES
      (1,'alice','x',0,0), (2,'bob','x',0,0),
      (3,'guest_aaaaaa','!',0,1), (4,'guest_bbbbbb','!',0,1), (5,'guest_cccccc','!',0,1);
  `);
});
afterEach(() => closeDb());

describe("purgeExpired", () => {
  it("drops expired sessions and challenges only", () => {
    const db = getDb();
    db.exec(`
      INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('old',1,100), ('fresh',1,${FAR});
      INSERT INTO challenges (id, from_user, mode, initial_ms, increment_ms, created_at, expires_at)
        VALUES ('c_old',1,'live',60000,0,0,100), ('c_new',2,'live',60000,0,0,${FAR});
    `);
    expect(purgeExpired(1_000)).toMatchObject({ sessions: 1, challenges: 1 });
    expect(db.prepare(`SELECT token_hash FROM sessions`).all()).toEqual([{ token_hash: "fresh" }]);
    expect(db.prepare(`SELECT id FROM challenges`).all()).toEqual([{ id: "c_new" }]);
  });

  it("removes orphaned guests but keeps guests with a session or a game", () => {
    const db = getDb();
    db.exec(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('s3',3,${FAR})`); // guest 3: live session
    insertGame("g1", 1, 4, createGame({ clock: { mode: "live", initialMs: 60_000, incrementMs: 0 }, now: 0 })); // guest 4: has a game

    expect(purgeExpired().guests).toBe(1); // guest 5 only
    const left = db.prepare(`SELECT username FROM users ORDER BY id`).all().map((r) => (r as { username: string }).username);
    expect(left).toEqual(["alice", "bob", "guest_aaaaaa", "guest_bbbbbb"]);
  });

    it("drops expired password resets and month-old notification log rows", () => {
    const db = getDb();
    db.exec(`
      INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES ('old',1,0,100), ('fresh',1,0,${FAR});
      INSERT INTO notification_log (user_id, dedup_key, kind, created_at) VALUES (1,'a','your_turn',0), (1,'b','your_turn',${FAR});
    `);
    expect(purgeExpired()).toMatchObject({ resets: 1, notifications: 1 });
    expect(db.prepare(`SELECT token_hash FROM password_resets`).all()).toEqual([{ token_hash: "fresh" }]);
    expect(db.prepare(`SELECT dedup_key FROM notification_log`).all()).toEqual([{ dedup_key: "b" }]);
  });
});