import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb, closeDb } from "./db/connection.js";
import { authRoutes } from "./auth/routes.js"; // Import the routes we just made

const DATA_DIR = process.env.DATA_DIR ?? "./data";
openDb(`${DATA_DIR}/lilchess.db`);

const app = Fastify({ logger: true });


// The cookie plugin must be registered before the routes that use it
app.register(cookie);


app.register(authRoutes);

app.get("/api/health", async () => ({ ok: true }));

app.addHook("onClose", async () => {
  closeDb();
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});