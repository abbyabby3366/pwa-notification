import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
  plugins: [
    {
      name: "admin-route-rewrite",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/admin" || req.url === "/admin/") {
            req.url = "/admin.html";
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
