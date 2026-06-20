import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { getDb } from "./db/database.js";
import { hubPublicRoot, projectById, repoRoot, sourceProjects } from "./config.js";
import { AssetRepository } from "./repositories/assets.js";
import { registerApiRoutes } from "./routes/api.js";

const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

async function start() {
  const app = express();
  const httpServer = createHttpServer(app);
  const db = getDb();
  const repository = new AssetRepository(db);

  app.use(express.json({ limit: "50mb" }));
  registerApiRoutes(app, repository, db);

  for (const project of sourceProjects) {
    app.use(
      `/external-assets/${encodeURIComponent(project.id)}/assets`,
      express.static(project.spineAssetsRoot, {
        index: false,
        fallthrough: true,
        maxAge: isProduction ? "1h" : 0,
      }),
    );
  }

  app.use("/hub", express.static(hubPublicRoot, { index: false, fallthrough: true }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      database: "sqlite",
      projects: sourceProjects.map((project) => ({
        id: project.id,
        exists: fs.existsSync(project.rootPath),
        assetsRoot: project.spineAssetsRoot,
      })),
    });
  });

  if (isProduction) {
    const distRoot = path.join(repoRoot, "dist");
    app.use(express.static(distRoot));
    app.get("*", (_request, response) => response.sendFile(path.join(distRoot, "index.html")));
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(port, host, () => {
    const known = sourceProjects.map((project) => projectById(project.id)?.name).filter(Boolean).join(" / ");
    console.log(`Game Asset Hub running at http://${host}:${port}`);
    console.log(`Projects: ${known}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
