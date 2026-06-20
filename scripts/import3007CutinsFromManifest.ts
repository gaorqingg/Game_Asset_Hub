import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeDb, getDb } from "../server/db/database.js";
import { defaultWwwRoot, joinPublicUrl, projectPublicRoot } from "../server/config.js";

type JsonMap = Record<string, unknown>;

interface ManifestRow {
  Index: string;
  Status: string;
  Skeleton: string;
  OutputName: string;
  SkeletonGuid: string;
  Prefabs: string;
  Animations: string;
  OutputDir: string;
  Json: string;
  Atlas: string;
  PngPages: string;
  Error: string;
}

interface CutinSource {
  index: number;
  stem: string;
  assetId: string;
  roleSourceId: string;
  sourceDir: string;
  prefabRoleSourceId: string;
  animationsFromManifest: string[];
  jsonAnimations: string[];
  version: string;
  jsonPath: string;
  atlasPath: string;
  pages: string[];
}

const projectId = "3007";
const sourceRoot = "H:/game_assets_rebuild/3007_huoying_xinshidai";
const allRolesRoot = path.join(
  sourceRoot,
  "_temp/11123201_changmen_tips_spine_project/deliverable_3_8_99/all_roles",
);
const manifestPath = path.join(allRolesRoot, "all_roles_manifest.csv");
const expectedCutinCount = 164;
const importWorkspaceRoot = path.join(sourceRoot, "_temp/asset-hub-ingest");

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.length));
}

function readManifest(filePath: string): ManifestRow[] {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = csvParse(text);
  const header = rows.shift();
  if (!header) throw new Error(`Empty manifest: ${filePath}`);
  return rows.map((values) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record as unknown as ManifestRow;
  });
}

function safeAssetPart(value: string): string {
  const safe = value.replace(/\\/g, "/").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) throw new Error(`Cannot create safe asset id for: ${value}`);
  return safe;
}

function assetIdFor(stem: string): string {
  return `cutin_${safeAssetPart(stem)}`;
}

function inferRoleSourceId(row: ManifestRow, existingRoles: Set<string>): { roleSourceId: string; prefabRoleSourceId: string } {
  const prefabMatch = row.Prefabs.match(/(?:^|;)(\d{8})_skill\d+_tips\.prefab(?:;|$)/);
  const prefabRoleSourceId = prefabMatch?.[1] || "";
  if (prefabRoleSourceId && existingRoles.has(prefabRoleSourceId)) {
    return { roleSourceId: prefabRoleSourceId, prefabRoleSourceId };
  }

  const outputMatch = row.OutputName.match(/^(\d{8})/);
  if (outputMatch && existingRoles.has(outputMatch[1])) {
    return { roleSourceId: outputMatch[1], prefabRoleSourceId };
  }

  const skeletonMatch = row.Skeleton.match(/^(\d{8})/);
  if (skeletonMatch && existingRoles.has(skeletonMatch[1])) {
    return { roleSourceId: skeletonMatch[1], prefabRoleSourceId };
  }

  throw new Error(`Cannot bind cutin to role: index=${row.Index}, output=${row.OutputName}, prefabs=${row.Prefabs}`);
}

function readJson(filePath: string): JsonMap {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonMap;
}

function parseAtlasPages(atlasPath: string): string[] {
  const lines = fs.readFileSync(atlasPath, "utf8").split(/\r?\n/);
  const pages: string[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i].trim();
    const next = lines[i + 1].trim();
    if (line && !lines[i].startsWith(" ") && !lines[i].startsWith("\t") && next.startsWith("size:")) {
      if (!pages.includes(line)) pages.push(line);
    }
  }
  return pages;
}

function relativeAssetPath(assetId: string, fileName: string): string {
  return ["spine", "cutins", assetId, fileName].join("/");
}

function copyPublishedFile(source: string, relativePath: string): { relativePath: string; targets: string[] } {
  const targets: string[] = [];
  for (const root of [projectPublicRoot, defaultWwwRoot]) {
    const target = path.join(root, projectId, "assets", ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    targets.push(target);
  }
  return { relativePath, targets };
}

function loadCutinSources(db: DatabaseSync): { cutins: CutinSource[]; failedRows: ManifestRow[] } {
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  const rows = readManifest(manifestPath);
  const available = rows.filter((row) => row.Status === "Success" || row.Status === "SkippedExisting");
  if (available.length !== expectedCutinCount) {
    throw new Error(`Expected ${expectedCutinCount} available cutins, got ${available.length}`);
  }

  const existingRoles = new Set<string>(
    (db.prepare("SELECT source_id FROM roles WHERE project_id = ?").all(projectId) as Array<{ source_id: string }>).map((row) => String(row.source_id)),
  );
  const failedRows = rows.filter((row) => row.Status === "Failed");

  const cutins = available.map((row) => {
    const stem = safeAssetPart(row.OutputName);
    const assetId = assetIdFor(stem);
    const sourceDir = row.OutputDir;
    const jsonFile = path.join(sourceDir, `${stem}.json`);
    const atlasFile = path.join(sourceDir, `${stem}.atlas`);
    if (!fs.existsSync(jsonFile)) throw new Error(`Missing JSON: ${jsonFile}`);
    if (!fs.existsSync(atlasFile)) throw new Error(`Missing atlas: ${atlasFile}`);

    const jsonText = fs.readFileSync(jsonFile, "utf8");
    if (!/"spine"\s*:\s*"3\.8\.99"/.test(jsonText)) throw new Error(`JSON is not Spine 3.8.99: ${jsonFile}`);
    if (/H:\\|X:\\|_temp/.test(jsonText)) throw new Error(`JSON contains local path: ${jsonFile}`);

    const json = JSON.parse(jsonText) as JsonMap;
    const skeleton = asRecord(json.skeleton);
    const animations = Object.keys(asRecord(json.animations));
    if (!animations.length) throw new Error(`Cutin JSON has no animations: ${stem}`);

    const pageNames = parseAtlasPages(atlasFile);
    if (!pageNames.length) throw new Error(`Atlas has no pages: ${atlasFile}`);
    const pages = pageNames.map((pageName) => {
      const source = path.join(sourceDir, path.basename(pageName));
      if (!fs.existsSync(source)) throw new Error(`Missing atlas page: ${source}`);
      return path.basename(pageName);
    });
    const manifestAnimations = row.Animations.split(";").map((value) => value.trim()).filter(Boolean);
    const { roleSourceId, prefabRoleSourceId } = inferRoleSourceId(row, existingRoles);

    return {
      index: Number(row.Index),
      stem,
      assetId,
      roleSourceId,
      prefabRoleSourceId,
      sourceDir,
      animationsFromManifest: manifestAnimations,
      jsonAnimations: animations,
      version: skeleton.spine ? String(skeleton.spine) : "3.8.99",
      jsonPath: relativeAssetPath(assetId, `${stem}.json`),
      atlasPath: relativeAssetPath(assetId, `${stem}.atlas`),
      pages: pages.map((page) => relativeAssetPath(assetId, page)),
    };
  });

  const assetIds = new Set<string>();
  for (const cutin of cutins) {
    if (assetIds.has(cutin.assetId)) throw new Error(`Duplicate cutin assetId: ${cutin.assetId}`);
    assetIds.add(cutin.assetId);
  }
  return { cutins, failedRows };
}

function publishCutins(cutins: CutinSource[]) {
  const published: Array<{ assetId: string; files: string[] }> = [];
  for (const cutin of cutins) {
    const files: string[] = [];
    files.push(copyPublishedFile(path.join(cutin.sourceDir, `${cutin.stem}.json`), cutin.jsonPath).relativePath);
    files.push(copyPublishedFile(path.join(cutin.sourceDir, `${cutin.stem}.atlas`), cutin.atlasPath).relativePath);
    for (const pagePath of cutin.pages) {
      files.push(copyPublishedFile(path.join(cutin.sourceDir, path.basename(pagePath)), pagePath).relativePath);
    }
    published.push({ assetId: cutin.assetId, files });
  }
  return published;
}

function sqlQuotePath(filePath: string): string {
  return `'${filePath.replace(/'/g, "''")}'`;
}

function backupDatabase(db: DatabaseSync, workspace: string): string {
  const backupPath = path.join(workspace, "asset-hub-before-3007-cutin-replace.sqlite");
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  db.exec(`VACUUM INTO ${sqlQuotePath(backupPath)}`);
  return backupPath;
}

function deleteExistingCutins(db: DatabaseSync): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT asset_id
     FROM spine_assets
     WHERE project_id = ?
       AND (
         lower(coalesce(json_path, '')) LIKE 'spine/cutins/%'
         OR lower(coalesce(skeleton_path, '')) LIKE 'spine/cutins/%'
         OR asset_id LIKE 'cutin_%'
       )`,
  ).all(projectId) as Array<{ asset_id: string }>;
  const assetIds = rows.map((row) => row.asset_id);
  if (!assetIds.length) return [];
  const placeholders = assetIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM animations_fts
     WHERE rowid IN (
       SELECT id FROM animations WHERE project_id = ? AND asset_id IN (${placeholders})
     )`,
  ).run(projectId, ...assetIds);
  db.prepare(
    `DELETE FROM asset_paths
     WHERE project_id = ?
       AND (
         asset_id IN (${placeholders})
         OR kind LIKE 'cutin-%'
         OR lower(path) LIKE 'spine/cutins/%'
       )`,
  ).run(projectId, ...assetIds);
  db.prepare(`DELETE FROM animations WHERE project_id = ? AND asset_id IN (${placeholders})`).run(projectId, ...assetIds);
  db.prepare(`DELETE FROM spine_assets WHERE project_id = ? AND asset_id IN (${placeholders})`).run(projectId, ...assetIds);
  return assetIds;
}

function insertAssetPath(db: DatabaseSync, assetBaseUrl: string, cutin: CutinSource, kind: string, assetPath: string) {
  const fullPath = path.join(defaultWwwRoot, projectId, "assets", ...assetPath.split("/"));
  db.prepare(
    `INSERT OR REPLACE INTO asset_paths (
      project_id, asset_id, role_source_id, kind, path, url, exists_on_disk
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, cutin.assetId, cutin.roleSourceId, kind, assetPath, joinPublicUrl(assetBaseUrl, assetPath), fs.existsSync(fullPath) ? 1 : 0);
}

function insertCutins(db: DatabaseSync, assetBaseUrl: string, cutins: CutinSource[]) {
  const roleLookup = db.prepare("SELECT display_name, fallback_name, model FROM roles WHERE project_id = ? AND source_id = ?");
  for (const cutin of cutins) {
    db.prepare(
      `INSERT INTO spine_assets (
        project_id, asset_id, source_asset_id, role_source_id, runtime, name,
        skeleton_path, json_path, atlas_path, pages_json, version, source_manifest, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      cutin.assetId,
      cutin.stem,
      cutin.roleSourceId,
      "pixi-spine-3.8",
      cutin.stem,
      null,
      cutin.jsonPath,
      cutin.atlasPath,
      JSON.stringify(cutin.pages),
      cutin.version,
      "scripts/import3007CutinsFromManifest.ts",
      JSON.stringify({
        kind: "cutin",
        index: cutin.index,
        sourceDir: cutin.sourceDir,
        prefabRoleSourceId: cutin.prefabRoleSourceId,
        manifestAnimations: cutin.animationsFromManifest,
      }),
    );

    insertAssetPath(db, assetBaseUrl, cutin, "cutin-json", cutin.jsonPath);
    insertAssetPath(db, assetBaseUrl, cutin, "cutin-atlas", cutin.atlasPath);
    for (const page of cutin.pages) insertAssetPath(db, assetBaseUrl, cutin, "cutin-page", page);

    const role = roleLookup.get(projectId, cutin.roleSourceId) as JsonMap | undefined;
    const roleName = [role?.display_name, role?.fallback_name, role?.model].filter(Boolean).join(" ");
    const preferredDefault = cutin.animationsFromManifest.find((name) => cutin.jsonAnimations.includes(name));
    const defaultAnimation = preferredDefault || cutin.jsonAnimations[0];

    for (const animationName of cutin.jsonAnimations) {
      const searchText = [cutin.stem, cutin.assetId, cutin.roleSourceId, roleName, animationName, "cutin", "closeup"].join(" ");
      const result = db.prepare(
        `INSERT INTO animations (
          project_id, asset_id, role_source_id, name, duration, frame_rate, is_default, search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(projectId, cutin.assetId, cutin.roleSourceId, animationName, null, 24, animationName === defaultAnimation ? 1 : 0, searchText);
      db.prepare(
        `INSERT INTO animations_fts (
          rowid, project_id, asset_id, role_source_id, name, search_text
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(Number(result.lastInsertRowid), projectId, cutin.assetId, cutin.roleSourceId, animationName, searchText);
    }
  }
}

function writeAuditFiles(workspace: string, cutins: CutinSource[], failedRows: ManifestRow[], published: Array<{ assetId: string; files: string[] }>, dbReport: JsonMap) {
  const hubIngest = {
    project: {
      id: projectId,
      name: "Naruto New Era",
      runtime: "spine-webgl-3.6",
      sourceRoot,
      assetBaseUrl: `http://192.168.0.9/${projectId}/assets`,
      catalogBaseUrl: `http://192.168.0.9/${projectId}/catalog`,
    },
    roles: [],
    spineAssets: cutins.map((cutin) => ({
      assetId: cutin.assetId,
      sourceAssetId: cutin.stem,
      roleSourceId: cutin.roleSourceId,
      runtime: "pixi-spine-3.8",
      name: cutin.stem,
      skeletonPath: null,
      jsonPath: cutin.jsonPath,
      atlasPath: cutin.atlasPath,
      pages: cutin.pages,
      version: cutin.version,
      animations: cutin.jsonAnimations.map((name) => ({
        name,
        duration: null,
        frameRate: 24,
        isDefault: name === (cutin.animationsFromManifest.find((animationName) => cutin.jsonAnimations.includes(animationName)) || cutin.jsonAnimations[0]),
      })),
      raw: { kind: "cutin", sourceDir: cutin.sourceDir, index: cutin.index },
    })),
    effectAssets: [],
    actions: [],
    battleProfile: null,
    sources: {
      manifestPath,
      allRolesRoot,
    },
  };
  fs.writeFileSync(path.join(workspace, "hub-ingest.json"), JSON.stringify(hubIngest, null, 2), "utf8");
  fs.writeFileSync(path.join(workspace, "publish-report.json"), JSON.stringify({ projectId, published }, null, 2), "utf8");
  fs.writeFileSync(path.join(workspace, "db-report.json"), JSON.stringify(dbReport, null, 2), "utf8");
  const failedCsv = ["Index,OutputName,SkeletonGuid,Prefabs,Animations,Error"];
  for (const row of failedRows) {
    failedCsv.push([row.Index, row.OutputName, row.SkeletonGuid, row.Prefabs, row.Animations, row.Error].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
  }
  fs.writeFileSync(path.join(workspace, "failed-source-cutins.csv"), `${failedCsv.join("\n")}\n`, "utf8");
}

function countOne(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { count: number } | undefined;
  return Number(row?.count || 0);
}

function main() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const workspace = path.join(importWorkspaceRoot, `3007-cutins-${timestamp}`);
  fs.mkdirSync(workspace, { recursive: true });

  const db = getDb();
  const project = db.prepare("SELECT asset_base_url FROM projects WHERE id = ?").get(projectId) as JsonMap | undefined;
  if (!project) throw new Error(`Project ${projectId} is missing; import the 3007 catalog first.`);
  const assetBaseUrl = String(project.asset_base_url || `http://192.168.0.9/${projectId}/assets`);

  const importedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO import_runs (started_at, status, message) VALUES (?, ?, ?)").run(importedAt, "running", "Replace 3007 cutin assets from manifest");
  const runId = Number(run.lastInsertRowid);

  try {
    const { cutins, failedRows } = loadCutinSources(db);
    const published = publishCutins(cutins);
    const backupPath = backupDatabase(db, workspace);

    db.exec("BEGIN IMMEDIATE");
    const deletedAssetIds = deleteExistingCutins(db);
    insertCutins(db, assetBaseUrl, cutins);
    db.exec("COMMIT");

    const dbReport = {
      projectId,
      workspace,
      backupPath,
      sourceManifest: manifestPath,
      input: {
        availableCutins: cutins.length,
        failedSourceCutins: failedRows.length,
      },
      deletedAssetIds,
      counts: {
        roles: countOne(db, "SELECT count(*) AS count FROM roles WHERE project_id = '3007'"),
        cutinAssets: countOne(db, "SELECT count(*) AS count FROM spine_assets WHERE project_id = '3007' AND lower(coalesce(json_path, '')) LIKE 'spine/cutins/%'"),
        cutinAssetPaths: countOne(db, "SELECT count(*) AS count FROM asset_paths WHERE project_id = '3007' AND kind LIKE 'cutin-%'"),
        missingCutinPaths: countOne(db, "SELECT count(*) AS count FROM asset_paths WHERE project_id = '3007' AND kind LIKE 'cutin-%' AND exists_on_disk != 1"),
      },
      sampleAssetIds: cutins.slice(0, 10).map((cutin) => cutin.assetId),
    };

    writeAuditFiles(workspace, cutins, failedRows, published, dbReport);
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ?, stats_json = ? WHERE id = ?").run(
      new Date().toISOString(),
      "success",
      "Replaced 3007 cutin assets from manifest",
      JSON.stringify(dbReport),
      runId,
    );
    console.log(JSON.stringify(dbReport, null, 2));
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction may not have started or may already be closed.
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
