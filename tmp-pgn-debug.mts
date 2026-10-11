import { buildApp } from './server/src/app.ts';
import { openDb, closeDb } from './server/src/db/connection.ts';
import { registerUser } from './server/src/testing/helpers.ts';

const pgn = `[Event "Import test"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

openDb(':memory:');
const app = await buildApp();
const alice = await registerUser(app, 'alice');
const res = await app.inject({ method: 'POST', url: '/api/games/import', cookies: { sessionId: alice }, payload: { pgn } });
console.log(res.statusCode);
console.log(res.body);
await app.close();
closeDb();
