import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The mount point is baked into asset URLs, so BASE_PATH must match the server's at runtime.
const base = `${(process.env.BASE_PATH ?? "").replace(/\/+$/, "")}/`;
const apiPort = process.env.PORT ?? "3000";

export default defineConfig({
  root: "client",
  base,
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: { [`${base}api`]: { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
});
