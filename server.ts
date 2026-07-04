import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser with large limit for PDF base64 payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Setup dev and production servers
async function startServer() {
  // Dynamically imported (instead of a static top-level import) so this
  // module — which reads process.env.GEMINI_API_KEY/GITHUB_TOKEN at its own
  // module-evaluation time to build the Gemini client — only ever loads
  // AFTER dotenv.config() above has populated process.env. A static import
  // here would get hoisted and evaluated before dotenv.config() runs (ESM
  // import evaluation order), silently leaving those clients uninitialized.
  const { registerApiRoutes } = await import("./functions/src/apiRoutes");
  registerApiRoutes(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer();
