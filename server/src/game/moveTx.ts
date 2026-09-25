import { getDb } from "../db/connection.js";
import { applyMove } from "@lilchess/shared";

export const submitMoveTx = (gameId: string, userId: number, submittedPly: number, uci: string) => {
  const db = getDb();
  
  // Wrap the logic in a transaction closure
  const tx = db.transaction(() => {
    // 1. Load the game and auth
    const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId) as any;
    if (!game) throw new Error("Game not found");
    
    // Idempotency constraint
    if (game.ply !== submittedPly) {
      throw new Error(`Ply mismatch: expected ${game.ply}, got ${submittedPly}`);
    }

    const turn = game.ply % 2 === 0 ? "white" : "black";
    if (turn === "white" && game.white_id !== userId) throw new Error("Not your turn");
    if (turn === "black" && game.black_id !== userId) throw new Error("Not your turn");

    // 2. Load the moves and build the GameState for the pure core
    const moveRows = db.prepare(`SELECT uci FROM moves WHERE game_id = ? ORDER BY ply ASC`).all(gameId) as { uci: string }[];
    
    const gameState = {
      status: game.status,
      turn,
	  initialFen: game.initial_fen,
      deadlineAt: game.deadline_at,
      whiteMs: game.white_ms,
      blackMs: game.black_ms,
      turnStartedAt: game.turn_started_at,
      moves: moveRows.map(m => m.uci),
      ply: game.ply,
      clock: { 
        mode: game.mode, 
        initialMs: game.initial_ms, 
        incrementMs: game.increment_ms, 
        daysPerMove: game.days_per_move 
      }
    };

    const now = Date.now();

    // 3. Run the pure game core
    const result = applyMove(gameState as any, uci, now);
    
    if (!result.ok) {
      throw new Error(result.error);
    }

    const newState = result.state;
    
    // 4. Persist the results
    db.prepare(`
      UPDATE games SET 
        status = ?, result = ?, termination = ?, ply = ?, 
        white_ms = ?, black_ms = ?, turn_started_at = ?, deadline_at = ?, 
        draw_offered_by = NULL, ended_at = ?
      WHERE id = ?
    `).run(
      newState.status, newState.result || null, newState.termination || null, newState.ply,
      newState.whiteMs, newState.blackMs, newState.turnStartedAt, newState.deadlineAt,
      newState.status === 'finished' ? now : null, gameId
    );

    db.prepare(`INSERT INTO moves (game_id, ply, uci, san) VALUES (?, ?, ?, ?)`).run(
      gameId, newState.ply, uci, uci
    );

    return newState;
  });

  // Execute the transaction
  return tx();
};

export const resignTx = (gameId: string, userId: number) => {
  const db = getDb();
  const tx = db.transaction(() => {
    const game = db.prepare(`SELECT * FROM games WHERE id = ? AND status = 'started'`).get(gameId) as any;
    if (!game) throw new Error("Active game not found");
    
    let result;
    if (game.white_id === userId) result = "0-1";
    else if (game.black_id === userId) result = "1-0";
    else throw new Error("Not a participant");

    db.prepare(`UPDATE games SET status = 'finished', result = ?, termination = 'resign', ended_at = ? WHERE id = ?`)
      .run(result, Date.now(), gameId);
  });
  return tx();
};

export const offerDrawTx = (gameId: string, userId: number) => {
  const db = getDb();
  db.prepare(`UPDATE games SET draw_offered_by = ? WHERE id = ? AND status = 'started' AND (white_id = ? OR black_id = ?)`).run(userId, gameId, userId, userId);
};

export const acceptDrawTx = (gameId: string, userId: number) => {
  const db = getDb();
  const tx = db.transaction(() => {
    const game = db.prepare(`SELECT draw_offered_by FROM games WHERE id = ? AND status = 'started'`).get(gameId) as any;
    
    if (!game || !game.draw_offered_by || game.draw_offered_by === userId) {
      throw new Error("No valid draw offer to accept");
    }

    db.prepare(`UPDATE games SET status = 'finished', result = '1/2-1/2', termination = 'draw_accepted', ended_at = ? WHERE id = ?`)
      .run(Date.now(), gameId);
  });
  return tx();
};

export const declineDrawTx = (gameId: string, userId: number) => {
  const db = getDb();
  const tx = db.transaction(() => {
    const game = db.prepare(`SELECT draw_offered_by FROM games WHERE id = ? AND status = 'started'`).get(gameId) as any;
    if (!game || !game.draw_offered_by) throw new Error("No active draw offer");
    if (game.draw_offered_by === userId) throw new Error("Cannot decline your own draw offer");

    db.prepare(`UPDATE games SET draw_offered_by = NULL WHERE id = ?`).run(gameId);
  });
  return tx();
};

export const abortGameTx = (gameId: string, userId: number) => {
  const db = getDb();
  const tx = db.transaction(() => {
    const game = db.prepare(`SELECT * FROM games WHERE id = ? AND status = 'started'`).get(gameId) as any;
    if (!game) throw new Error("Active game not found");
    if (game.ply >= 2) throw new Error("Cannot abort after move 2");
    if (game.white_id !== userId && game.black_id !== userId) throw new Error("Not a participant");

    db.prepare(`UPDATE games SET status = 'aborted', ended_at = ? WHERE id = ?`).run(Date.now(), gameId);
  });
  return tx();
};