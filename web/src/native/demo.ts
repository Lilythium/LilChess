import { resolveDemoServer } from "../../../mobile/src/demoServer.js";

/** The built-in demo server, or null when this build was made without VITE_LILCHESS_DEMO_URL. */
export const demoServer = resolveDemoServer(import.meta.env.VITE_LILCHESS_DEMO_URL as string | undefined);
