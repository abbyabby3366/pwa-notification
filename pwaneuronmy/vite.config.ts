import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/__pwa/admin-assets/",
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
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
    port: 5174,
    host: true,
    proxy: {
      "/__pwa/api": {
        target: "http://127.0.0.1:3002",
        changeOrigin: true,
      },
    },
  },
});
