import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, __dirname.endsWith("dist") ? "../public" : "public");

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "pwaneuronmy", timestamp: new Date().toISOString() });
});

app.use(express.static(PUBLIC_DIR));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`[pwaneuronmy] Plain upstream app listening on http://0.0.0.0:${port}`);
});
