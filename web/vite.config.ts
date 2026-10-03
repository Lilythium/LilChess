import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { ProxyOptions } from "vite";

// The server's Origin check (CSRF + WebSocket) compares Origin's host to the Host header
// when BASE_URL is unset, so the proxy must forward the browser's Host unchanged.
const keepHost: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  const forward = (proxyReq: { setHeader(name: string, value: string): void }, req: { headers: { host?: string } }) => {
    if (req.headers.host) proxyReq.setHeader("host", req.headers.host);
  };
  proxy.on("proxyReq", forward);
  proxy.on("proxyReqWs", forward);
};

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    allowedHosts: ["lilithlaptop"],
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: false, configure: keepHost },
      "/ws": { target: "ws://localhost:3000", ws: true, changeOrigin: false, configure: keepHost },
    },
  },
});