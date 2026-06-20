import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeDb, getDb } from "../server/db/database.js";
import { defaultWwwRoot, joinPublicUrl, projectPublicRoot } from "../server/config.js";

type JsonMap = Record<string, unknown>;

interface CutinSample {
  stem: string;
  roleSourceId: string;
  sourceDir: string;
}

const projectId = "3007";
const sourceRoot = "H:/game_assets_rebuild/3007_huoying_xinshidai/_temp/11123201_changmen_tips_spine_project/deliverable_3_8_99";
const allRolesRoot = path.join(sourceRoot, "all_roles");
const samples: CutinSample[] = [
  {
    stem: "21123205_tips",
    roleSourceId: "11123201",
    sourceDir: sourceRoot,
  },
  {
    stem: "liluoke_renjiedazhan_tips",
    roleSourceId: "11004501",
    sourceDir: path.join(allRolesRoot, "liluoke_renjiedazhan_tips"),
  },
  {
    stem: "jingye_renjiedazhan_tips",
    roleSourceId: "11007401",
    sourceDir: path.join(allRolesRoot, "jingye_renjiedazhan_tips"),
  },
  {
    stem: "dingci_renjiedazhan_tips",
    roleSourceId: "11009301",
    sourceDir: path.join(allRolesRoot, "dingci_renjiedazhan_tips"),
  },
];

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

function readJson(filePath: string): JsonMap {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonMap;
}

function assetIdFor(stem: string) {
  return `cutin_${stem}`;
}

function relativeAssetPath(stem: string, fileName: string) {
  return ["spine", "cutins", stem, fileName].join("/");
}

function copyRuntimeFile(sourceDir: string, stem: string, extension: "json" | "atlas" | "png") {
  const fileName = `${stem}.${extension}`;
  const source = path.join(sourceDir, fileName);
  if (!fs.existsSync(source)) throw new Error(`Missing cutin source file: ${source}`);

  const relativePath = relativeAssetPath(stem, fileName);
  for (const root of [projectPublicRoot, defaultWwwRoot]) {
    const target = path.join(root, projectId, "assets", ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return relativePath;
}

function deleteExistingSamples(db: DatabaseSync, assetIds: string[]) {
  if (!assetIds.length) return;
  const placeholders = assetIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM animations_fts
     WHERE rowid IN (
       SELECT id FROM animations WHERE project_id = ? AND asset_id IN (${placeholders})
     )`,
  ).run(projectId, ...assetIds);
  db.prepare(`DELETE FROM asset_paths WHERE project_id = ? AND asset_id IN (${placeholders})`).run(projectId, ...assetIds);
  db.prepare(`DELETE FROM animations WHERE project_id = ? AND asset_id IN (${placeholders})`).run(projectId, ...assetIds);
  db.prepare(`DELETE FROM spine_assets WHERE project_id = ? AND asset_id IN (${placeholders})`).run(projectId, ...assetIds);
}

function insertAssetPath(db: DatabaseSync, assetBaseUrl: string, assetId: string, roleSourceId: string, kind: string, assetPath: string) {
  const fullPath = path.join(defaultWwwRoot, projectId, "assets", ...assetPath.split("/"));
  db.prepare(
    `INSERT OR REPLACE INTO asset_paths (
      project_id, asset_id, role_source_id, kind, path, url, exists_on_disk
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, assetId, roleSourceId, kind, assetPath, joinPublicUrl(assetBaseUrl, assetPath), fs.existsSync(fullPath) ? 1 : 0);
}

function insertSample(db: DatabaseSync, assetBaseUrl: string, sample: CutinSample) {
  const assetId = assetIdFor(sample.stem);
  const jsonPath = copyRuntimeFile(sample.sourceDir, sample.stem, "json");
  const atlasPath = copyRuntimeFile(sample.sourceDir, sample.stem, "atlas");
  const pagePath = copyRuntimeFile(sample.sourceDir, sample.stem, "png");
  const json = readJson(path.join(sample.sourceDir, `${sample.stem}.json`));
  const skeleton = asRecord(json.skeleton);
  const animations = Object.keys(asRecord(json.animations));
  if (!animations.length) throw new Error(`Cutin JSON has no animations: ${sample.stem}`);

  db.prepare(
    `INSERT INTO spine_assets (
      project_id, asset_id, source_asset_id, role_source_id, runtime, name,
      skeleton_path, json_path, atlas_path, pages_json, version, source_manifest, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId,
    assetId,
    sample.stem,
    sample.roleSourceId,
    "pixi-spine-3.8",
    sample.stem,
    null,
    jsonPath,
    atlasPath,
    JSON.stringify([pagePath]),
    skeleton.spine ? String(skeleton.spine) : "3.8.99",
    "scripts/importCutinSamples.ts",
    JSON.stringify({
      kind: "cutin",
      sourceDir: sample.sourceDir,
      importedRuntimeFiles: [jsonPath, atlasPath, pagePath],
    }),
  );

  insertAssetPath(db, assetBaseUrl, assetId, sample.roleSourceId, "cutin-json", jsonPath);
  insertAssetPath(db, assetBaseUrl, assetId, sample.roleSourceId, "cutin-atlas", atlasPath);
  insertAssetPath(db, assetBaseUrl, assetId, sample.roleSourceId, "cutin-page", pagePath);

  const role = db
    .prepare("SELECT display_name, fallback_name, model FROM roles WHERE project_id = ? AND source_id = ?")
    .get(projectId, sample.roleSourceId) as JsonMap | undefined;
  const roleName = [role?.display_name, role?.fallback_name, role?.model].filter(Boolean).join(" ");

  animations.forEach((animationName, index) => {
    const searchText = [sample.stem, assetId, sample.roleSourceId, roleName, animationName, "cutin", "特写"].join(" ");
    const result = db.prepare(
      `INSERT INTO animations (
        project_id, asset_id, role_source_id, name, duration, frame_rate, is_default, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(projectId, assetId, sample.roleSourceId, animationName, null, 30, index === 0 ? 1 : 0, searchText);
    db.prepare(
      `INSERT INTO animations_fts (
        rowid, project_id, asset_id, role_source_id, name, search_text
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(Number(result.lastInsertRowid), projectId, assetId, sample.roleSourceId, animationName, searchText);
  });

  return {
    assetId,
    roleSourceId: sample.roleSourceId,
    stem: sample.stem,
    animations,
  };
}

function main() {
  const db = getDb();
  const project = db.prepare("SELECT asset_base_url FROM projects WHERE id = ?").get(projectId) as JsonMap | undefined;
  if (!project) throw new Error(`Project ${projectId} is missing; import the 3007 catalog first.`);
  const assetBaseUrl = String(project.asset_base_url || `http://192.168.0.9/${projectId}/assets`);
  const assetIds = samples.map((sample) => assetIdFor(sample.stem));

  const importedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO import_runs (started_at, status, message) VALUES (?, ?, ?)").run(importedAt, "running", "Import 3007 cutin samples");
  const runId = Number(run.lastInsertRowid);

  try {
    db.exec("BEGIN IMMEDIATE");
    deleteExistingSamples(db, assetIds);
    const imported = samples.map((sample) => insertSample(db, assetBaseUrl, sample));
    db.exec("COMMIT");
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ?, stats_json = ? WHERE id = ?").run(
      new Date().toISOString(),
      "success",
      "Imported 3007 cutin samples",
      JSON.stringify({ projectId, imported }),
      runId,
    );
    console.log(JSON.stringify({ projectId, imported }, null, 2));
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction may already be closed.
    }
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?").run(
      new Date().toISOString(),
      "failed",
      error instanceof Error ? error.message : String(error),
      runId,
    );
    throw error;
  } finally {
    closeDb();
  }
}

main();
