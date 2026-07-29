import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A port of its own next to the game client's 10666, forwarding to The Devil's
// Tables on 4100 rather than to the game server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 10667,
    proxy: {
      "/api": "http://localhost:4100"
    }
  }
});
