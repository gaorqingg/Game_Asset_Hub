import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import * as spine38 from "@pixi-spine/runtime-3.8";
import { closeDb, getDb } from "../server/db/database.js";
import { defaultWwwRoot, joinPublicUrl, projectPublicRoot } from "../server/config.js";

type JsonMap = Record<string, unknown>;

interface RoleTarget {
  roleId: string;
  expectedAnimations: number;
  manifestName?: string;
}

interface AnimationInfo {
  name: string;
  duration: number | null;
  frameRate: number;
  isDefault: boolean;
}

interface CharacterSpineSource {
  roleId: string;
  assetId: string;
  displayName: string;
  sourceDir: string;
  jsonFile: string;
  atlasFile: string;
  pageFiles: string[];
  jsonPath: string;
  atlasPath: string;
  pages: string[];
  version: string;
  animations: AnimationInfo[];
}

interface ImportOptions {
  manifestPath: string | null;
  mode: string;
  workspacePrefix: string;
  skipExistingNormal: boolean;
}

const projectId = "3007";
const sourceRoot = "H:/game_assets_rebuild/3007_huoying_xinshidai";
const spineOutputRoot = path.join(sourceRoot, "spine-character-exporter/output");
const importWorkspaceRoot = path.join(sourceRoot, "_temp/asset-hub-ingest");
const scriptName = "scripts/import3007GeneratedCharacterSpine.ts";
const forbiddenLegacyFrameRoot = "restored" + "_frames";

const roleTargets: RoleTarget[] = [
  { roleId: "11002101", expectedAnimations: 62 },
  { roleId: "11010201", expectedAnimations: 15 },
  { roleId: "11015201", expectedAnimations: 15 },
  { roleId: "11003301", expectedAnimations: 12 },
  { roleId: "11003101", expectedAnimations: 21 },
];

function parseArgs(argv: string[]): ImportOptions {
  const options: ImportOptions = {
    manifestPath: null,
    mode: "generated-character-spine",
    workspacePrefix: "3007-generated-character-spine",
    skipExistingNormal: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = argv[index + 1];
      index += 1;
    } else if (arg === "--mode") {
      options.mode = argv[index + 1] || options.mode;
      index += 1;
    } else if (arg === "--workspace-prefix") {
      options.workspacePrefix = argv[index + 1] || options.workspacePrefix;
      index += 1;
    } else if (arg === "--skip-existing-normal") {
      options.skipExistingNormal = true;
    }
  }
  if (options.manifestPath) {
    options.mode = options.mode === "generated-character-spine" ? "remaining-character-spine" : options.mode;
  }
  return options;
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

function readJson(filePath: string): JsonMap {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonMap;
}

function loadRoleTargets(options: ImportOptions): { targets: RoleTarget[]; manifest: JsonMap | null; spineRoot: string } {
  if (!options.manifestPath) return { targets: roleTargets, manifest: null, spineRoot: spineOutputRoot };
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = readJson(manifestPath);
  const manifestRoles = Array.isArray(manifest.roles) ? manifest.roles : [];
  const targets = manifestRoles.map((item) => {
    const record = asRecord(item);
    const roleId = String(record.role || record.roleId || "").trim();
    const expectedAnimations = Number(record.animations || record.animationCount || 0);
    const manifestName = record.name ? String(record.name) : undefined;
    if (!roleId) throw new Error(`Export manifest has a role without an id: ${manifestPath}`);
    if (!Number.isFinite(expectedAnimations) || expectedAnimations <= 0) {
      throw new Error(`Export manifest role ${roleId} has invalid animation count: ${expectedAnimations}`);
    }
    return { roleId, expectedAnimations, manifestName };
  });
  if (!targets.length) throw new Error(`Export manifest has no successful roles: ${manifestPath}`);
  const manifestOutRoot = typeof manifest.outRoot === "string" ? manifest.outRoot : spineOutputRoot;
  return { targets, manifest, spineRoot: manifestOutRoot };
}

class DummyAttachmentLoader implements spine38.AttachmentLoader {
  newRegionAttachment(_skin: spine38.Skin, name: string, _path: string): spine38.RegionAttachment {
    return new spine38.RegionAttachment(name);
  }

  newMeshAttachment(_skin: spine38.Skin, name: string, _path: string): spine38.MeshAttachment {
    return new spine38.MeshAttachment(name);
  }

  newBoundingBoxAttachment(_skin: spine38.Skin, name: string): spine38.BoundingBoxAttachment {
    return new spine38.BoundingBoxAttachment(name);
  }

  newPathAttachment(_skin: spine38.Skin, name: string): spine38.PathAttachment {
    return new spine38.PathAttachment(name);
  }

  newPointAttachment(_skin: spine38.Skin, name: string): spine38.PointAttachment {
    return new spine38.PointAttachment(name);
  }

  newClippingAttachment(_skin: spine38.Skin, name: string): spine38.ClippingAttachment {
    return new spine38.ClippingAttachment(name);
  }
}

function validateRuntimeJson(json: JsonMap, jsonFile: string, expectedAnimations: number): void {
  try {
    const parser = new spine38.SkeletonJson(new DummyAttachmentLoader());
    const skeletonData = parser.readSkeletonData(json);
    if (skeletonData.animations.length !== expectedAnimations) {
      throw new Error(`expected ${expectedAnimations} animations, got ${skeletonData.animations.length}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pixi Spine 3.8 cannot parse ${jsonFile}: ${message}`);
  }
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
  return ["spine", "characters", assetId, fileName].join("/");
}

function animationDuration(animation: unknown): number | null {
  let maxTime = 0;
  let found = false;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as JsonMap;
    if (typeof record.time === "number") {
      maxTime = Math.max(maxTime, record.time);
      found = true;
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(animation);
  return found ? Number(maxTime.toFixed(5)) : null;
}

function normalAssetWhere(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `lower(coalesce(${prefix}json_path, '')) NOT LIKE 'spine/cutins/%' AND lower(coalesce(${prefix}skeleton_path, '')) NOT LIKE 'spine/cutins/%'`;
}

function existingNormalRoleIds(db: DatabaseSync): Set<string> {
  const rows = db.prepare(
    `SELECT DISTINCT role_source_id
     FROM spine_assets
     WHERE project_id = ?
       AND coalesce(role_source_id, '') != ''
       AND ${normalAssetWhere()}`,
  ).all(projectId) as Array<{ role_source_id: string }>;
  return new Set(rows.map((row) => row.role_source_id));
}

function loadSources(db: DatabaseSync, targets: RoleTarget[], sourceRootDir: string, options: ImportOptions): { assets: CharacterSpineSource[]; skippedExisting: RoleTarget[] } {
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error(`Project ${projectId} is missing; import the 3007 catalog first.`);

  const existingNormal = options.skipExistingNormal ? existingNormalRoleIds(db) : new Set<string>();
  const skippedExisting = targets.filter((target) => existingNormal.has(target.roleId));
  const selectedTargets = targets.filter((target) => !existingNormal.has(target.roleId));
  if (!selectedTargets.length) throw new Error("No target roles remain after filtering existing normal Spine assets.");

  const roleLookup = db.prepare("SELECT display_name FROM roles WHERE project_id = ? AND source_id = ?");
  const assets = selectedTargets.map((target) => {
    const role = roleLookup.get(projectId, target.roleId) as { display_name?: string } | undefined;
    if (!role) throw new Error(`Role ${target.roleId} is missing from project ${projectId}.`);

    const sourceDir = path.join(sourceRootDir, target.roleId);
    const jsonFile = path.join(sourceDir, `${target.roleId}.json`);
    const atlasFile = path.join(sourceDir, `${target.roleId}.atlas`);
    if (!fs.existsSync(jsonFile)) throw new Error(`Missing Spine JSON: ${jsonFile}`);
    if (!fs.existsSync(atlasFile)) throw new Error(`Missing Spine atlas: ${atlasFile}`);

    const jsonText = fs.readFileSync(jsonFile, "utf8");
    if (jsonText.toLowerCase().includes(forbiddenLegacyFrameRoot)) {
      throw new Error(`JSON references legacy frame root: ${jsonFile}`);
    }
    if (/[A-Z]:\\/.test(jsonText)) throw new Error(`JSON contains a local Windows path: ${jsonFile}`);

    const json = JSON.parse(jsonText) as JsonMap;
    const skeleton = asRecord(json.skeleton);
    const version = skeleton.spine ? String(skeleton.spine) : "";
    if (version !== "3.8.99") throw new Error(`Expected Spine 3.8.99, got ${version || "<empty>"}: ${jsonFile}`);

    const animationsMap = asRecord(json.animations);
    const animationNames = Object.keys(animationsMap);
    if (animationNames.length !== target.expectedAnimations) {
      throw new Error(`Expected ${target.expectedAnimations} animations for ${target.roleId}, got ${animationNames.length}.`);
    }
    validateRuntimeJson(json, jsonFile, target.expectedAnimations);
    const defaultAnimation = animationNames.includes("C_idle") ? "C_idle" : animationNames[0];
    const animations = animationNames.map((name) => ({
      name,
      duration: animationDuration(animationsMap[name]),
      frameRate: 30,
      isDefault: name === defaultAnimation,
    }));

    const pageNames = parseAtlasPages(atlasFile);
    if (!pageNames.length) throw new Error(`Atlas has no page entries: ${atlasFile}`);
    const pageFiles = pageNames.map((pageName) => {
      const pageFile = path.join(sourceDir, path.basename(pageName));
      if (!fs.existsSync(pageFile)) throw new Error(`Missing atlas page: ${pageFile}`);
      return pageFile;
    });

    return {
      roleId: target.roleId,
      assetId: target.roleId,
      displayName: String(role.display_name || target.roleId),
      sourceDir,
      jsonFile,
      atlasFile,
      pageFiles,
      jsonPath: relativeAssetPath(target.roleId, `${target.roleId}.json`),
      atlasPath: relativeAssetPath(target.roleId, `${target.roleId}.atlas`),
      pages: pageNames.map((pageName) => relativeAssetPath(target.roleId, path.basename(pageName))),
      version,
      animations,
    };
  });
  return { assets, skippedExisting };
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

function publishAssets(assets: CharacterSpineSource[]) {
  return assets.map((asset) => {
    const files: string[] = [];
    files.push(copyPublishedFile(asset.jsonFile, asset.jsonPath).relativePath);
    files.push(copyPublishedFile(asset.atlasFile, asset.atlasPath).relativePath);
    asset.pages.forEach((page, index) => {
      files.push(copyPublishedFile(asset.pageFiles[index], page).relativePath);
    });
    return { assetId: asset.assetId, roleSourceId: asset.roleId, files };
  });
}

function sqlQuotePath(filePath: string): string {
  return `'${filePath.replace(/'/g, "''")}'`;
}

function backupDatabase(db: DatabaseSync, workspace: string): string {
  const backupPath = path.join(workspace, "asset-hub-before-3007-generated-character-spine.sqlite");
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  db.exec(`VACUUM INTO ${sqlQuotePath(backupPath)}`);
  return backupPath;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function deleteExistingAssets(db: DatabaseSync, assetIds: string[]): string[] {
  const ids = [...new Set(assetIds)];
  const list = placeholders(ids);
  const rows = db.prepare(`SELECT asset_id FROM spine_assets WHERE project_id = ? AND asset_id IN (${list})`).all(projectId, ...ids) as Array<{ asset_id: string }>;
  db.prepare(
    `DELETE FROM animations_fts
     WHERE rowid IN (
       SELECT id FROM animations WHERE project_id = ? AND asset_id IN (${list})
     )`,
  ).run(projectId, ...ids);
  db.prepare(`DELETE FROM asset_paths WHERE project_id = ? AND asset_id IN (${list})`).run(projectId, ...ids);
  db.prepare(`DELETE FROM animations WHERE project_id = ? AND asset_id IN (${list})`).run(projectId, ...ids);
  db.prepare(`DELETE FROM spine_assets WHERE project_id = ? AND asset_id IN (${list})`).run(projectId, ...ids);
  return rows.map((row) => row.asset_id);
}

function insertAssetPath(db: DatabaseSync, assetBaseUrl: string, asset: CharacterSpineSource, kind: string, assetPath: string) {
  const fullPath = path.join(defaultWwwRoot, projectId, "assets", ...assetPath.split("/"));
  db.prepare(
    `INSERT OR REPLACE INTO asset_paths (
      project_id, asset_id, role_source_id, kind, path, url, exists_on_disk
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, asset.assetId, asset.roleId, kind, assetPath, joinPublicUrl(assetBaseUrl, assetPath), fs.existsSync(fullPath) ? 1 : 0);
}

function insertAssets(db: DatabaseSync, assetBaseUrl: string, assets: CharacterSpineSource[]) {
  for (const asset of assets) {
    db.prepare(
      `INSERT INTO spine_assets (
        project_id, asset_id, source_asset_id, role_source_id, runtime, name,
        skeleton_path, json_path, atlas_path, pages_json, version, source_manifest, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      asset.assetId,
      asset.roleId,
      asset.roleId,
      "pixi-spine-3.8",
      asset.displayName,
      null,
      asset.jsonPath,
      asset.atlasPath,
      JSON.stringify(asset.pages),
      asset.version,
      scriptName,
      JSON.stringify({
        kind: "generated-character-spine",
        sourceDir: asset.sourceDir,
        sourceRoot,
      }),
    );

    insertAssetPath(db, assetBaseUrl, asset, "json", asset.jsonPath);
    insertAssetPath(db, assetBaseUrl, asset, "atlas", asset.atlasPath);
    for (const page of asset.pages) insertAssetPath(db, assetBaseUrl, asset, "page", page);

    for (const animation of asset.animations) {
      const searchText = [asset.displayName, asset.assetId, asset.roleId, animation.name, "generated", "character", "spine"].join(" ");
      const result = db.prepare(
        `INSERT INTO animations (
          project_id, asset_id, role_source_id, name, duration, frame_rate, is_default, search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(projectId, asset.assetId, asset.roleId, animation.name, animation.duration, animation.frameRate, animation.isDefault ? 1 : 0, searchText);
      db.prepare(
        `INSERT INTO animations_fts (
          rowid, project_id, asset_id, role_source_id, name, search_text
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(Number(result.lastInsertRowid), projectId, asset.assetId, asset.roleId, animation.name, searchText);
    }
  }
}

function updateSummaries(db: DatabaseSync, roleIds: string[]) {
  const now = new Date().toISOString();
  const normalAssetSql = normalAssetWhere("s");

  for (const roleId of roleIds) {
    const stats = db.prepare(
      `SELECT
         COUNT(DISTINCT s.asset_id) AS asset_count,
         COUNT(a.id) AS animation_count
       FROM spine_assets s
       LEFT JOIN animations a ON a.project_id = s.project_id AND a.asset_id = s.asset_id
       WHERE s.project_id = ?
         AND s.role_source_id = ?
         AND ${normalAssetSql}`,
    ).get(projectId, roleId) as { asset_count: number; animation_count: number };
    db.prepare(
      `UPDATE roles
       SET has_spine = ?, animation_count = ?, updated_at = ?
       WHERE project_id = ? AND source_id = ?`,
    ).run(Number(stats.asset_count || 0) > 0 ? 1 : 0, Number(stats.animation_count || 0), now, projectId, roleId);
  }

  const projectStats = db.prepare(
    `SELECT
       COUNT(DISTINCT s.role_source_id) AS spine_role_count,
       COUNT(a.id) AS animation_count
     FROM spine_assets s
     LEFT JOIN animations a ON a.project_id = s.project_id AND a.asset_id = s.asset_id
     WHERE s.project_id = ?
       AND coalesce(s.role_source_id, '') != ''
       AND ${normalAssetSql}`,
  ).get(projectId) as { spine_role_count: number; animation_count: number };
  db.prepare(
    `UPDATE projects
     SET spine_role_count = ?, animation_count = ?, updated_at = ?
     WHERE id = ?`,
  ).run(Number(projectStats.spine_role_count || 0), Number(projectStats.animation_count || 0), now, projectId);
}

function countOne(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { count: number } | undefined;
  return Number(row?.count || 0);
}

function countTargetRows(db: DatabaseSync, table: string, assetIds: string[], extraWhere = ""): number {
  if (!assetIds.length) return 0;
  const list = placeholders(assetIds);
  const where = extraWhere ? ` AND ${extraWhere}` : "";
  const row = db.prepare(`SELECT count(*) AS count FROM ${table} WHERE project_id = ? AND asset_id IN (${list})${where}`).get(projectId, ...assetIds) as { count: number } | undefined;
  return Number(row?.count || 0);
}

function writeAuditFiles(
  workspace: string,
  assets: CharacterSpineSource[],
  published: Array<{ assetId: string; roleSourceId: string; files: string[] }>,
  dbReport: JsonMap,
  options: ImportOptions,
  manifest: JsonMap | null,
  skippedExisting: RoleTarget[],
) {
  const hubIngest = {
    project: {
      id: projectId,
      name: "火影忍者新世代",
      runtime: "spine-webgl-3.6",
      sourceRoot,
      assetBaseUrl: `http://192.168.0.9/${projectId}/assets`,
      catalogBaseUrl: `http://192.168.0.9/${projectId}/catalog`,
    },
    roles: [],
    spineAssets: assets.map((asset) => ({
      assetId: asset.assetId,
      sourceAssetId: asset.roleId,
      roleSourceId: asset.roleId,
      runtime: "pixi-spine-3.8",
      name: asset.displayName,
      skeletonPath: null,
      jsonPath: asset.jsonPath,
      atlasPath: asset.atlasPath,
      pages: asset.pages,
      version: asset.version,
      animations: asset.animations,
      raw: { kind: "generated-character-spine", sourceDir: asset.sourceDir },
    })),
    effectAssets: [],
    actions: [],
    battleProfile: null,
    sources: {
      spineOutputRoot,
      script: scriptName,
      manifestPath: options.manifestPath,
    },
  };
  fs.writeFileSync(path.join(workspace, "hub-ingest.json"), JSON.stringify(hubIngest, null, 2), "utf8");
  fs.writeFileSync(path.join(workspace, "publish-report.json"), JSON.stringify({ projectId, published }, null, 2), "utf8");
  fs.writeFileSync(path.join(workspace, "db-report.json"), JSON.stringify(dbReport, null, 2), "utf8");
  fs.writeFileSync(
    path.join(workspace, "input-report.json"),
    JSON.stringify({ projectId, mode: options.mode, manifest, skippedExisting }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspace, "validation-notes.md"),
    [
      "# 3007 generated character Spine import",
      "",
      "Validation commands:",
      "",
      "```powershell",
      "python C:\\Users\\gaorq\\.codex\\skills\\asset-hub-project-ingest\\scripts\\validate_hub_project.py --db H:\\game_assets_rebuild\\Game_Asset_Hub\\data\\asset-hub.sqlite --project-id 3007 --wwwroot \\\\192.168.0.9\\wwwroot --origin http://192.168.0.9",
      "rg \"restored\" H:\\game_assets_rebuild\\3007_huoying_xinshidai\\spine-character-exporter H:\\game_assets_rebuild\\Game_Asset_Hub\\scripts\\import3007GeneratedCharacterSpine.ts",
      "Invoke-RestMethod http://127.0.0.1:5173/api/projects/3007/animations",
      "```",
      "",
    ].join("\n"),
    "utf8",
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { targets, manifest, spineRoot } = loadRoleTargets(options);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const workspace = path.join(importWorkspaceRoot, `${options.workspacePrefix}-${timestamp}`);
  fs.mkdirSync(workspace, { recursive: true });

  const db = getDb();
  const startedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO import_runs (started_at, status, message) VALUES (?, ?, ?)").run(startedAt, "running", `Import 3007 ${options.mode} assets`);
  const runId = Number(run.lastInsertRowid);

  try {
    const project = db.prepare("SELECT asset_base_url FROM projects WHERE id = ?").get(projectId) as JsonMap | undefined;
    if (!project) throw new Error(`Project ${projectId} is missing; import the 3007 catalog first.`);
    const assetBaseUrl = String(project.asset_base_url || `http://192.168.0.9/${projectId}/assets`);
    const { assets, skippedExisting } = loadSources(db, targets, spineRoot, options);
    const published = publishAssets(assets);
    const backupPath = backupDatabase(db, workspace);

    db.exec("BEGIN IMMEDIATE");
    const deletedAssetIds = deleteExistingAssets(db, assets.map((asset) => asset.assetId));
    insertAssets(db, assetBaseUrl, assets);
    updateSummaries(db, assets.map((asset) => asset.roleId));
    db.exec("COMMIT");

    const targetAssetIds = assets.map((asset) => asset.assetId);
    const dbReport = {
      projectId,
      mode: options.mode,
      workspace,
      backupPath,
      input: {
        sourceRoot,
        spineOutputRoot: spineRoot,
        manifestPath: options.manifestPath,
        targetCount: targets.length,
        skippedExisting: skippedExisting.map((target) => target.roleId),
        roles: assets.map((asset) => ({
          roleId: asset.roleId,
          displayName: asset.displayName,
          animations: asset.animations.length,
          pages: asset.pages,
        })),
      },
      deletedAssetIds,
      counts: {
        targetAssets: countTargetRows(db, "spine_assets", targetAssetIds),
        targetAnimations: countTargetRows(db, "animations", targetAssetIds),
        targetAssetPaths: countTargetRows(db, "asset_paths", targetAssetIds),
        cutinAssets: countOne(db, "SELECT count(*) AS count FROM spine_assets WHERE project_id = '3007' AND lower(coalesce(json_path, '')) LIKE 'spine/cutins/%'"),
        missingTargetPaths: countTargetRows(db, "asset_paths", targetAssetIds, "exists_on_disk != 1"),
      },
    };

    writeAuditFiles(workspace, assets, published, dbReport, options, manifest, skippedExisting);
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ?, stats_json = ? WHERE id = ?").run(
      new Date().toISOString(),
      "success",
      `Imported 3007 ${options.mode} assets`,
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
