import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/fishCrossTag/" : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5185,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store",
    },
    hmr: {
      host: "127.0.0.1",
      port: 5185,
      protocol: "ws",
    },
  },
});
