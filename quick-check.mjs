import WebSocket from "ws";

const gameId = process.argv[2];
const cookieWhite = process.argv[3];
const cookieBlack = process.argv[4];

function connect(cookieString, label) {
  const ws = new WebSocket(`ws://localhost:3000/ws/games/${gameId}`, {
    headers: {
      Cookie: cookieString
    }
  });
  
  ws.on("open", () => console.log(`${label} connected`));
  ws.on("message", (m) => console.log(`${label} received:`, m.toString()));
  ws.on("error", (err) => console.error(`${label} error:`, err.message));
  ws.on("close", (code, reason) => console.log(`${label} closed code:`, code, "reason:", reason.toString()));
  
  return ws;
}

const white = connect(cookieWhite, "white");
const black = connect(cookieBlack, "black");

setTimeout(() => {
  console.log("Sending move...");
  white.send(JSON.stringify({ type: "move", ply: 0, uci: "e2e4" }));
}, 1000);