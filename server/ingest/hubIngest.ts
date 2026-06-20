import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { defaultWwwRoot, joinPublicUrl, projectAssetBaseUrl, projectCatalogBaseUrl } from "../config.js";

type JsonMap = Record<string, unknown>;

export class HubIngestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details: unknown[] = [],
  ) {
    super(message);
  }
}

interface HubIngestProject {
  id: string;
  name: string;
  runtime: string;
  sourceRoot: string;
  createdAt: string;
  tags: string[];
  iconPath: string | null;
  assetBaseUrl: string;
  catalogBaseUrl: string;
}

interface HubIngestRoleImage {
  kind: string;
  path: string;
  sourcePath: string | null;
}

interface HubIngestSkill {
  sourceId: string;
  slot: string | null;
  slotLabel: string | null;
  name: string;
  iconPath: string | null;
  summary: string;
  description: string;
  raw: JsonMap;
}

interface HubIngestRole {
  sourceId: string;
  displayName: string;
  fallbackName: string;
  model: string | null;
  career: string | null;
  rarity: string | null;
  category: string | null;
  source: string | null;
  images: HubIngestRoleImage[];
  skills: HubIngestSkill[];
  raw: JsonMap;
}

interface HubIngestAnimation {
  name: string;
  duration: number | null;
  frameRate: number | null;
  isDefault: boolean;
}

interface HubIngestSpineAsset {
  assetId: string;
  sourceAssetId: string;
  roleSourceId: string | null;
  runtime: string;
  name: string;
  skeletonPath: string | null;
  jsonPath: string | null;
  atlasPath: string | null;
  pages: string[];
  version: string | null;
  animations: HubIngestAnimation[];
  raw: JsonMap;
}

interface HubIngestEffectAsset {
  effectAssetId: string;
  effectName: string;
  runtime: string;
  skeletonPath: string | null;
  jsonPath: string | null;
  atlasPath: string | null;
  pages: string[];
  animations: string[];
  defaultAnimation: string | null;
  bounds: JsonMap;
  raw: JsonMap;
}

interface HubIngestActorCue {
  cueIndex: number;
  timeMs: number;
  actorSide: string;
  animationName: string;
  sourceAnimCode: string | null;
  loop: boolean;
  speed: number;
  returnAnimation: string | null;
  raw: JsonMap;
}

interface HubIngestMotionCue {
  cueIndex: number;
  timeMs: number;
  subject: string;
  motionType: string;
  targetCode: string | null;
  offsetX: number;
  offsetY: number;
  durationMs: number;
  easing: string | null;
  flip: boolean;
  raw: JsonMap;
}

interface HubIngestHitCue {
  cueIndex: number;
  timeMs: number;
  targetActorId: string;
  targetCode: string | null;
  hitIndex: number;
  hitCount: number;
  hitAnimation: string;
  hitDurationMs: number | null;
  hitPauseMs: number;
  timeSource: string;
  raw: JsonMap;
}

interface HubIngestEffectCue {
  cueIndex: number;
  timeMs: number;
  timeSource: string;
  effectRole: string;
  effectAssetId: string;
  effectName: string;
  effectAnimation: string | null;
  hitCueId: number | null;
  hitIndex: number | null;
  targetActorId: string;
  targetCode: string | null;
  anchor: string | null;
  positionType: string;
  offsetX: number;
  offsetY: number;
  layer: string;
  scale: number;
  speed: number;
  loop: boolean;
  zIndex: number;
  maskType: number;
  directionMode: string;
  raw: JsonMap;
}

interface HubIngestAction {
  roleSourceId: string;
  actionId: string;
  skillId: string | null;
  slot: string | null;
  slotLabel: string | null;
  actionName: string;
  label: string;
  sourceKind: string;
  roleAnimation: string | null;
  scriptName: string | null;
  durationMs: number | null;
  isPrimary: boolean;
  remark: string | null;
  raw: JsonMap;
  actorCues: HubIngestActorCue[];
  motionCues: HubIngestMotionCue[];
  hitCues: HubIngestHitCue[];
  effectCues: HubIngestEffectCue[];
}

interface HubIngestBattleProfile {
  defaultEnemyRoleSourceId: string | null;
  defaultEnemyAssetId: string | null;
  battleCoordScale: number;
  casterX: number;
  casterY: number;
  targetX: number;
  targetY: number;
  casterScale: number;
  targetScale: number;
  coordinateMode: string;
  idleAnimation: string;
  hitAnimation: string;
  anchorRules: JsonMap;
  raw: JsonMap;
}

interface NormalizedHubIngest {
  project: HubIngestProject;
  roles: HubIngestRole[];
  spineAssets: HubIngestSpineAsset[];
  effectAssets: HubIngestEffectAsset[];
  actions: HubIngestAction[];
  battleProfile: HubIngestBattleProfile | null;
  raw: JsonMap;
  warnings: string[];
}

interface MissingFileStats {
  asset: {
    checked: number;
    missing: number;
    samples: string[];
  };
  catalog: {
    checked: number;
    missing: number;
    samples: string[];
  };
}

export interface HubIngestResult {
  projectId: string;
  importedAt: string;
  stats: {
    roles: number;
    roleImages: number;
    skills: number;
    spineAssets: number;
    spineRoles: number;
    animations: number;
    cutinSpineAssets: number;
    cutinSpineRoles: number;
    cutinAnimations: number;
    cutinAssetPaths: number;
    assetPaths: number;
    effectAssets: number;
    roleActions: number;
    actorCues: number;
    motionCues: number;
    hitCues: number;
    effectCues: number;
  };
  missingFiles: MissingFileStats;
  warnings: string[];
}

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result ? result : null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}

function actionRemark(action: JsonMap): string | null {
  return firstText(action.remark, action.remarks, action.note, action.notes, action.comment, action.comments) || null;
}

function numberValue(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function intValue(value: unknown, fallback = 0): number {
  return Math.round(numberValue(value, fallback));
}

function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function jsonText(value: unknown, fallback: unknown): string {
  return JSON.stringify(value === undefined ? fallback : value);
}

function rawJson(record: JsonMap): JsonMap {
  const raw = asRecord(record.raw);
  return Object.keys(raw).length ? raw : record;
}

function containsOldProxy(value: string): boolean {
  return value.includes("/external-assets/") || value.includes("/hub/projects/");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeRelativePath(value: unknown, label: string, errors: string[]): string | null {
  const raw = text(value);
  if (!raw) return null;
  const slashNormalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (isHttpUrl(raw) || containsOldProxy(raw)) {
    errors.push(`${label} must be a relative path, got ${raw}`);
    return null;
  }
  if (/^[A-Za-z]:\//.test(slashNormalized) || raw.startsWith("\\\\")) {
    errors.push(`${label} must not be an absolute path, got ${raw}`);
    return null;
  }
  if (slashNormalized.split("/").includes("..")) {
    errors.push(`${label} must not contain '..', got ${raw}`);
    return null;
  }
  return slashNormalized;
}

function filePath(root: string, projectId: string, segment: "assets" | "catalog", relativePath: string): string {
  return path.join(root, projectId, segment, ...relativePath.split("/"));
}

const CUTIN_SPINE_PREFIX = "spine/cutins/";

function hasCutinPrefix(assetPath: string | null): boolean {
  return Boolean(assetPath && assetPath.toLowerCase().startsWith(CUTIN_SPINE_PREFIX));
}

function isCutinSpineAsset(asset: HubIngestSpineAsset): boolean {
  return hasCutinPrefix(asset.skeletonPath)
    || hasCutinPrefix(asset.jsonPath)
    || hasCutinPrefix(asset.atlasPath)
    || asset.pages.some((page) => hasCutinPrefix(page));
}

function spineAssetPathCount(asset: HubIngestSpineAsset | HubIngestEffectAsset): number {
  return [asset.skeletonPath, asset.jsonPath, asset.atlasPath].filter(Boolean).length + asset.pages.length;
}

function normalizeProject(input: JsonMap, routeProjectId: string, warnings: string[], errors: string[]): HubIngestProject {
  const id = text(input.id);
  if (!id) errors.push("project.id is required");
  if (id && id !== routeProjectId) {
    throw new HubIngestError(`project id mismatch: route=${routeProjectId}, body=${id}`, 409, [{ routeProjectId, bodyProjectId: id }]);
  }
  const name = text(input.name) || id;
  if (!name) errors.push("project.name is required");
  const runtime = text(input.runtime);
  if (!runtime) errors.push("project.runtime is required");
  const assetBaseUrl = text(input.assetBaseUrl) || projectAssetBaseUrl(routeProjectId);
  const catalogBaseUrl = text(input.catalogBaseUrl) || projectCatalogBaseUrl(routeProjectId);
  if (!isHttpUrl(assetBaseUrl)) errors.push(`project.assetBaseUrl must be http(s), got ${assetBaseUrl}`);
  if (!isHttpUrl(catalogBaseUrl)) errors.push(`project.catalogBaseUrl must be http(s), got ${catalogBaseUrl}`);
  const iconPath = normalizeRelativePath(input.iconPath, "project.iconPath", errors);
  const tags = asArray(input.tags).map(String).filter(Boolean);
  if (!tags.length) warnings.push("project.tags is empty");
  return {
    id: id || routeProjectId,
    name,
    runtime,
    sourceRoot: text(input.sourceRoot),
    createdAt: text(input.createdAt) || new Date().toISOString(),
    tags,
    iconPath,
    assetBaseUrl,
    catalogBaseUrl,
  };
}

function normalizeRoles(input: unknown, errors: string[]): HubIngestRole[] {
  return asArray(input).map((roleInput, index) => {
    const role = asRecord(roleInput);
    const sourceId = text(role.sourceId || role.id);
    if (!sourceId) errors.push(`roles[${index}].sourceId is required`);
    const images = asArray(role.images).map((imageInput, imageIndex) => {
      const image = asRecord(imageInput);
      return {
        kind: text(image.kind) || `image-${imageIndex}`,
        path: normalizeRelativePath(image.path, `roles[${index}].images[${imageIndex}].path`, errors) || "",
        sourcePath: nullableText(image.sourcePath),
      };
    }).filter((image) => image.path);
    const skills = asArray(role.skills).map((skillInput, skillIndex) => {
      const skill = asRecord(skillInput);
      const skillId = text(skill.sourceId || skill.id) || `${sourceId || index}-${skillIndex + 1}`;
      return {
        sourceId: skillId,
        slot: nullableText(skill.slot),
        slotLabel: nullableText(skill.slotLabel),
        name: text(skill.name) || skillId,
        iconPath: normalizeRelativePath(skill.iconPath, `roles[${index}].skills[${skillIndex}].iconPath`, errors),
        summary: text(skill.summary),
        description: text(skill.description),
        raw: rawJson(skill),
      };
    });
    return {
      sourceId,
      displayName: text(role.displayName || role.name) || sourceId,
      fallbackName: text(role.fallbackName || role.model) || sourceId,
      model: nullableText(role.model),
      career: nullableText(role.career),
      rarity: nullableText(role.rarity),
      category: nullableText(role.category),
      source: nullableText(role.source),
      images,
      skills,
      raw: rawJson(role),
    };
  }).filter((role) => role.sourceId);
}

function normalizeAnimations(input: unknown): HubIngestAnimation[] {
  return asArray(input).map((animationInput) => {
    const animation = asRecord(animationInput);
    const name = text(animation.name || animationInput);
    return {
      name,
      duration: nullableNumber(animation.duration),
      frameRate: nullableNumber(animation.frameRate),
      isDefault: boolValue(animation.isDefault),
    };
  }).filter((animation) => animation.name);
}

function normalizeSpineAssets(input: unknown, projectRuntime: string, errors: string[]): HubIngestSpineAsset[] {
  return asArray(input).map((assetInput, index) => {
    const asset = asRecord(assetInput);
    const assetId = text(asset.assetId || asset.id || asset.sourceAssetId);
    if (!assetId) errors.push(`spineAssets[${index}].assetId is required`);
    const skeletonPath = normalizeRelativePath(asset.skeletonPath, `spineAssets[${index}].skeletonPath`, errors);
    const jsonPath = normalizeRelativePath(asset.jsonPath, `spineAssets[${index}].jsonPath`, errors);
    return {
      assetId,
      sourceAssetId: text(asset.sourceAssetId) || assetId,
      roleSourceId: nullableText(asset.roleSourceId),
      runtime: text(asset.runtime) || projectRuntime,
      name: text(asset.name) || assetId,
      skeletonPath,
      jsonPath,
      atlasPath: normalizeRelativePath(asset.atlasPath, `spineAssets[${index}].atlasPath`, errors),
      pages: asArray(asset.pages)
        .map((page, pageIndex) => normalizeRelativePath(page, `spineAssets[${index}].pages[${pageIndex}]`, errors))
        .filter((page): page is string => Boolean(page)),
      version: nullableText(asset.version),
      animations: normalizeAnimations(asset.animations),
      raw: rawJson(asset),
    };
  }).filter((asset) => asset.assetId);
}

function normalizeEffectAssets(input: unknown, projectRuntime: string, errors: string[]): HubIngestEffectAsset[] {
  return asArray(input).map((assetInput, index) => {
    const asset = asRecord(assetInput);
    const effectAssetId = text(asset.effectAssetId || asset.id || asset.effectName);
    if (!effectAssetId) errors.push(`effectAssets[${index}].effectAssetId is required`);
    return {
      effectAssetId,
      effectName: text(asset.effectName || asset.name) || effectAssetId,
      runtime: text(asset.runtime) || projectRuntime,
      skeletonPath: normalizeRelativePath(asset.skeletonPath, `effectAssets[${index}].skeletonPath`, errors),
      jsonPath: normalizeRelativePath(asset.jsonPath, `effectAssets[${index}].jsonPath`, errors),
      atlasPath: normalizeRelativePath(asset.atlasPath, `effectAssets[${index}].atlasPath`, errors),
      pages: asArray(asset.pages)
        .map((page, pageIndex) => normalizeRelativePath(page, `effectAssets[${index}].pages[${pageIndex}]`, errors))
        .filter((page): page is string => Boolean(page)),
      animations: asArray(asset.animations).map(String).filter(Boolean),
      defaultAnimation: nullableText(asset.defaultAnimation),
      bounds: asRecord(asset.bounds),
      raw: rawJson(asset),
    };
  }).filter((asset) => asset.effectAssetId);
}

function normalizeActions(input: unknown, battleProfile: HubIngestBattleProfile | null, errors: string[]): HubIngestAction[] {
  return asArray(input).map((actionInput, actionIndex) => {
    const action = asRecord(actionInput);
    const roleSourceId = text(action.roleSourceId);
    const actionId = text(action.actionId || action.id);
    if (!roleSourceId) errors.push(`actions[${actionIndex}].roleSourceId is required`);
    if (!actionId) errors.push(`actions[${actionIndex}].actionId is required`);
    const actorCues = asArray(action.actorCues).map((cueInput, cueIndex) => {
      const cue = asRecord(cueInput);
      return {
        cueIndex: intValue(cue.cueIndex, cueIndex),
        timeMs: intValue(cue.timeMs),
        actorSide: text(cue.actorSide) || "caster",
        animationName: text(cue.animationName) || "Skill01",
        sourceAnimCode: nullableText(cue.sourceAnimCode),
        loop: boolValue(cue.loop),
        speed: numberValue(cue.speed, 1),
        returnAnimation: nullableText(cue.returnAnimation),
        raw: rawJson(cue),
      };
    });
    const motionCues = asArray(action.motionCues).map((cueInput, cueIndex) => {
      const cue = asRecord(cueInput);
      return {
        cueIndex: intValue(cue.cueIndex, cueIndex),
        timeMs: intValue(cue.timeMs),
        subject: text(cue.subject) || "caster",
        motionType: text(cue.motionType) || "custom",
        targetCode: nullableText(cue.targetCode),
        offsetX: numberValue(cue.offsetX),
        offsetY: numberValue(cue.offsetY),
        durationMs: intValue(cue.durationMs),
        easing: nullableText(cue.easing),
        flip: boolValue(cue.flip),
        raw: rawJson(cue),
      };
    });
    const hitCueCount = asArray(action.hitCues).length;
    const hitCues = asArray(action.hitCues).map((cueInput, cueIndex) => {
      const cue = asRecord(cueInput);
      return {
        cueIndex: intValue(cue.cueIndex, cueIndex),
        timeMs: intValue(cue.timeMs),
        targetActorId: text(cue.targetActorId) || "default-enemy",
        targetCode: nullableText(cue.targetCode),
        hitIndex: intValue(cue.hitIndex, cueIndex),
        hitCount: intValue(cue.hitCount, Math.max(1, hitCueCount)),
        hitAnimation: text(cue.hitAnimation) || battleProfile?.hitAnimation || "Hit01",
        hitDurationMs: nullableNumber(cue.hitDurationMs),
        hitPauseMs: intValue(cue.hitPauseMs),
        timeSource: text(cue.timeSource) || "hub_ingest",
        raw: rawJson(cue),
      };
    });
    const effectCues = asArray(action.effectCues).map((cueInput, cueIndex) => {
      const cue = asRecord(cueInput);
      const effectAssetId = text(cue.effectAssetId || cue.effectName);
      if (!effectAssetId) errors.push(`actions[${actionIndex}].effectCues[${cueIndex}].effectAssetId is required`);
      return {
        cueIndex: intValue(cue.cueIndex, cueIndex),
        timeMs: intValue(cue.timeMs),
        timeSource: text(cue.timeSource) || "hub_ingest",
        effectRole: text(cue.effectRole) || "effect",
        effectAssetId,
        effectName: text(cue.effectName) || effectAssetId,
        effectAnimation: nullableText(cue.effectAnimation),
        hitCueId: nullableNumber(cue.hitCueId),
        hitIndex: nullableNumber(cue.hitIndex),
        targetActorId: text(cue.targetActorId) || "default-enemy",
        targetCode: nullableText(cue.targetCode),
        anchor: nullableText(cue.anchor),
        positionType: text(cue.positionType) || "enemy",
        offsetX: numberValue(cue.offsetX),
        offsetY: numberValue(cue.offsetY),
        layer: text(cue.layer) || "front",
        scale: numberValue(cue.scale, 1),
        speed: numberValue(cue.speed, 1),
        loop: boolValue(cue.loop),
        zIndex: intValue(cue.zIndex),
        maskType: intValue(cue.maskType),
        directionMode: text(cue.directionMode) || "target",
        raw: rawJson(cue),
      };
    }).filter((cue) => cue.effectAssetId);
    return {
      roleSourceId,
      actionId,
      skillId: nullableText(action.skillId),
      slot: nullableText(action.slot),
      slotLabel: nullableText(action.slotLabel),
      actionName: text(action.actionName || action.name) || actionId,
      label: text(action.label || action.actionName || action.name) || actionId,
      sourceKind: text(action.sourceKind) || "hub_ingest",
      roleAnimation: nullableText(action.roleAnimation),
      scriptName: nullableText(action.scriptName),
      durationMs: nullableNumber(action.durationMs),
      isPrimary: boolValue(action.isPrimary),
      remark: actionRemark(action),
      raw: rawJson(action),
      actorCues,
      motionCues,
      hitCues,
      effectCues,
    };
  }).filter((action) => action.roleSourceId && action.actionId);
}

function normalizeBattleProfile(input: unknown): HubIngestBattleProfile | null {
  if (!input) return null;
  const profile = asRecord(input);
  if (!Object.keys(profile).length) return null;
  return {
    defaultEnemyRoleSourceId: nullableText(profile.defaultEnemyRoleSourceId),
    defaultEnemyAssetId: nullableText(profile.defaultEnemyAssetId),
    battleCoordScale: numberValue(profile.battleCoordScale, 1),
    casterX: numberValue(profile.casterX, -260),
    casterY: numberValue(profile.casterY, 0),
    targetX: numberValue(profile.targetX, 260),
    targetY: numberValue(profile.targetY, 0),
    casterScale: numberValue(profile.casterScale, 0.45),
    targetScale: numberValue(profile.targetScale, 0.45),
    coordinateMode: text(profile.coordinateMode) || "custom",
    idleAnimation: text(profile.idleAnimation) || "idle",
    hitAnimation: text(profile.hitAnimation) || "Hit01",
    anchorRules: asRecord(profile.anchorRules),
    raw: rawJson(profile),
  };
}

function normalizePackage(input: unknown, routeProjectId: string): NormalizedHubIngest {
  const root = asRecord(input);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!Object.keys(root).length) {
    throw new HubIngestError("Request body must be a hub-ingest JSON object", 400);
  }
  const project = normalizeProject(asRecord(root.project), routeProjectId, warnings, errors);
  const battleProfile = normalizeBattleProfile(root.battleProfile);
  const roles = normalizeRoles(root.roles, errors);
  const spineAssets = normalizeSpineAssets(root.spineAssets, project.runtime, errors);
  const effectAssets = normalizeEffectAssets(root.effectAssets, project.runtime, errors);
  const actions = normalizeActions(root.actions, battleProfile, errors);
  if (errors.length) {
    throw new HubIngestError("Invalid hub-ingest package", 400, errors);
  }
  return {
    project,
    roles,
    spineAssets,
    effectAssets,
    actions,
    battleProfile,
    raw: root,
    warnings,
  };
}

function deleteProjectData(db: DatabaseSync, projectId: string): void {
  for (const table of ["roles_fts", "skills_fts", "animations_fts"]) {
    db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
  }
  for (const table of [
    "effect_overrides",
    "project_battle_profiles",
    "action_effect_cues",
    "action_hit_cues",
    "action_motion_cues",
    "action_actor_cues",
    "effect_assets",
    "role_actions",
    "asset_paths",
    "animations",
    "spine_assets",
    "skills",
    "role_images",
    "roles",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
  }
}

function roleSearchText(role: HubIngestRole): string {
  return [
    role.sourceId,
    role.displayName,
    role.fallbackName,
    role.model,
    role.career,
    role.rarity,
    role.category,
    role.source,
    ...role.skills.map((skill) => [skill.sourceId, skill.name, skill.slotLabel, skill.summary, skill.description].join(" ")),
  ].filter(Boolean).join(" ");
}

function skillSearchText(skill: HubIngestSkill): string {
  return [skill.sourceId, skill.name, skill.slotLabel, skill.summary, skill.description].filter(Boolean).join(" ");
}

function actionSearchText(action: HubIngestAction): string {
  return [
    action.actionId,
    action.roleSourceId,
    action.skillId,
    action.slot,
    action.slotLabel,
    action.actionName,
    action.label,
    action.roleAnimation,
    action.scriptName,
    action.remark,
  ].filter(Boolean).join(" ");
}

function insertProject(db: DatabaseSync, pkg: NormalizedHubIngest, stats: HubIngestResult["stats"], importedAt: string): void {
  const project = pkg.project;
  db.prepare(
    `INSERT INTO projects (
      id, name, root_path, created_at, tags_json, icon_path, runtime, asset_base_url,
      catalog_base_url, source_catalog_json, source_spine_manifest, role_count,
      spine_role_count, animation_count, updated_at
    ) VALUES (
      @id, @name, @rootPath, @createdAt, @tagsJson, @iconPath, @runtime, @assetBaseUrl,
      @catalogBaseUrl, @sourceCatalogJson, @sourceSpineManifest, @roleCount,
      @spineRoleCount, @animationCount, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      root_path = excluded.root_path,
      created_at = excluded.created_at,
      tags_json = excluded.tags_json,
      icon_path = excluded.icon_path,
      runtime = excluded.runtime,
      asset_base_url = excluded.asset_base_url,
      catalog_base_url = excluded.catalog_base_url,
      source_catalog_json = excluded.source_catalog_json,
      source_spine_manifest = excluded.source_spine_manifest,
      role_count = excluded.role_count,
      spine_role_count = excluded.spine_role_count,
      animation_count = excluded.animation_count,
      updated_at = excluded.updated_at`,
  ).run({
    id: project.id,
    name: project.name,
    rootPath: project.sourceRoot || `api://hub-ingest/${project.id}`,
    createdAt: project.createdAt,
    tagsJson: JSON.stringify(project.tags),
    iconPath: project.iconPath,
    runtime: project.runtime,
    assetBaseUrl: project.assetBaseUrl,
    catalogBaseUrl: project.catalogBaseUrl,
    sourceCatalogJson: `api://hub-ingest/${project.id}`,
    sourceSpineManifest: `api://hub-ingest/${project.id}`,
    roleCount: stats.roles,
    spineRoleCount: stats.spineRoles,
    animationCount: stats.animations,
    updatedAt: importedAt,
  });
}

function insertRoles(db: DatabaseSync, pkg: NormalizedHubIngest): void {
  const spineStatsByRole = new Map<string, { hasSpine: boolean; animationCount: number }>();
  for (const asset of pkg.spineAssets) {
    if (!asset.roleSourceId) continue;
    if (isCutinSpineAsset(asset)) continue;
    const current = spineStatsByRole.get(asset.roleSourceId) || { hasSpine: false, animationCount: 0 };
    current.hasSpine = true;
    current.animationCount += asset.animations.length;
    spineStatsByRole.set(asset.roleSourceId, current);
  }

  const now = new Date().toISOString();
  for (const role of pkg.roles) {
    const spineStats = spineStatsByRole.get(role.sourceId) || { hasSpine: false, animationCount: 0 };
    const searchText = roleSearchText(role);
    const result = db.prepare(
      `INSERT INTO roles (
        project_id, source_id, display_name, fallback_name, model, career, rarity,
        category, source, search_text, data_quality, has_spine, animation_count,
        raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pkg.project.id,
      role.sourceId,
      role.displayName,
      role.fallbackName,
      role.model,
      role.career,
      role.rarity,
      role.category,
      role.source,
      searchText,
      "[]",
      spineStats.hasSpine ? 1 : 0,
      spineStats.animationCount,
      JSON.stringify(role.raw),
      now,
    );
    const rowId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO roles_fts (
        rowid, project_id, source_id, display_name, fallback_name, career,
        rarity, category, source, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(rowId, pkg.project.id, role.sourceId, role.displayName, role.fallbackName, role.career || "", role.rarity || "", role.category || "", role.source || "", searchText);

    for (const image of role.images) {
      db.prepare(
        `INSERT INTO role_images (project_id, role_source_id, kind, path, source_path)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(pkg.project.id, role.sourceId, image.kind, image.path, image.sourcePath);
    }

    for (const skill of role.skills) {
      const skillText = skillSearchText(skill);
      const skillResult = db.prepare(
        `INSERT INTO skills (
          project_id, role_source_id, source_id, slot, slot_label, name, icon_path,
          summary, description, search_text, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pkg.project.id,
        role.sourceId,
        skill.sourceId,
        skill.slot,
        skill.slotLabel,
        skill.name,
        skill.iconPath,
        skill.summary,
        skill.description,
        skillText,
        JSON.stringify(skill.raw),
      );
      db.prepare(
        `INSERT INTO skills_fts (
          rowid, project_id, role_source_id, source_id, name, slot_label,
          summary, description, search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(Number(skillResult.lastInsertRowid), pkg.project.id, role.sourceId, skill.sourceId, skill.name, skill.slotLabel || "", skill.summary, skill.description, skillText);
    }
  }
}

function addAssetPath(db: DatabaseSync, pkg: NormalizedHubIngest, assetId: string, roleSourceId: string | null, kind: string, assetPath: string | null): number {
  if (!assetPath) return 0;
  const fullPath = filePath(defaultWwwRoot, pkg.project.id, "assets", assetPath);
  const exists = fs.existsSync(fullPath) ? 1 : 0;
  db.prepare(
    `INSERT OR IGNORE INTO asset_paths (project_id, asset_id, role_source_id, kind, path, url, exists_on_disk)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(pkg.project.id, assetId, roleSourceId, kind, assetPath, joinPublicUrl(pkg.project.assetBaseUrl, assetPath), exists);
  return 1;
}

function insertSpineAssets(db: DatabaseSync, pkg: NormalizedHubIngest): void {
  for (const asset of pkg.spineAssets) {
    const assetKindPrefix = isCutinSpineAsset(asset) ? "cutin-" : "";
    db.prepare(
      `INSERT INTO spine_assets (
        project_id, asset_id, source_asset_id, role_source_id, runtime, name,
        skeleton_path, json_path, atlas_path, pages_json, version, source_manifest, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pkg.project.id,
      asset.assetId,
      asset.sourceAssetId,
      asset.roleSourceId,
      asset.runtime,
      asset.name,
      asset.skeletonPath,
      asset.jsonPath,
      asset.atlasPath,
      JSON.stringify(asset.pages),
      asset.version,
      `api://hub-ingest/${pkg.project.id}`,
      JSON.stringify(asset.raw),
    );
    addAssetPath(db, pkg, asset.assetId, asset.roleSourceId, `${assetKindPrefix}skeleton`, asset.skeletonPath);
    addAssetPath(db, pkg, asset.assetId, asset.roleSourceId, `${assetKindPrefix}json`, asset.jsonPath);
    addAssetPath(db, pkg, asset.assetId, asset.roleSourceId, `${assetKindPrefix}atlas`, asset.atlasPath);
    for (const page of asset.pages) addAssetPath(db, pkg, asset.assetId, asset.roleSourceId, `${assetKindPrefix}page`, page);

    for (const animation of asset.animations) {
      const searchText = [asset.name, asset.sourceAssetId, animation.name].join(" ");
      const result = db.prepare(
        `INSERT INTO animations (project_id, asset_id, role_source_id, name, duration, frame_rate, is_default, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(pkg.project.id, asset.assetId, asset.roleSourceId, animation.name, animation.duration, animation.frameRate, animation.isDefault ? 1 : 0, searchText);
      db.prepare(
        `INSERT INTO animations_fts (rowid, project_id, asset_id, role_source_id, name, search_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(Number(result.lastInsertRowid), pkg.project.id, asset.assetId, asset.roleSourceId || "", animation.name, searchText);
    }
  }
}

function insertEffectAssets(db: DatabaseSync, pkg: NormalizedHubIngest): void {
  for (const asset of pkg.effectAssets) {
    db.prepare(
      `INSERT INTO effect_assets (
        project_id, effect_asset_id, effect_name, runtime, skeleton_path, json_path,
        atlas_path, pages_json, animations_json, default_animation, bounds_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pkg.project.id,
      asset.effectAssetId,
      asset.effectName,
      asset.runtime,
      asset.skeletonPath,
      asset.jsonPath,
      asset.atlasPath,
      JSON.stringify(asset.pages),
      JSON.stringify(asset.animations),
      asset.defaultAnimation,
      JSON.stringify(asset.bounds),
      JSON.stringify(asset.raw),
    );
    addAssetPath(db, pkg, asset.effectAssetId, null, "effect-skeleton", asset.skeletonPath);
    addAssetPath(db, pkg, asset.effectAssetId, null, "effect-json", asset.jsonPath);
    addAssetPath(db, pkg, asset.effectAssetId, null, "effect-atlas", asset.atlasPath);
    for (const page of asset.pages) addAssetPath(db, pkg, asset.effectAssetId, null, "effect-page", page);
  }
}

function insertBattleProfile(db: DatabaseSync, pkg: NormalizedHubIngest): void {
  const profile = pkg.battleProfile;
  if (!profile) return;
  db.prepare(
    `INSERT INTO project_battle_profiles (
      project_id, default_enemy_role_source_id, default_enemy_asset_id, battle_coord_scale,
      caster_x, caster_y, target_x, target_y, caster_scale, target_scale,
      coordinate_mode, idle_animation, hit_animation, anchor_rules_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pkg.project.id,
    profile.defaultEnemyRoleSourceId,
    profile.defaultEnemyAssetId,
    profile.battleCoordScale,
    profile.casterX,
    profile.casterY,
    profile.targetX,
    profile.targetY,
    profile.casterScale,
    profile.targetScale,
    profile.coordinateMode,
    profile.idleAnimation,
    profile.hitAnimation,
    JSON.stringify(profile.anchorRules),
    JSON.stringify(profile.raw),
  );
}

function insertActions(db: DatabaseSync, pkg: NormalizedHubIngest): void {
  for (const action of pkg.actions) {
    db.prepare(
      `INSERT INTO role_actions (
        project_id, role_source_id, action_id, skill_id, slot, slot_label, action_name,
        label, source_kind, role_animation, script_name, duration_ms, is_primary,
        remark, search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      pkg.project.id,
      action.roleSourceId,
      action.actionId,
      action.skillId,
      action.slot,
      action.slotLabel,
      action.actionName,
      action.label,
      action.sourceKind,
      action.roleAnimation,
      action.scriptName,
      action.durationMs,
      action.isPrimary ? 1 : 0,
      action.remark,
      actionSearchText(action),
      JSON.stringify(action.raw),
    );

    for (const cue of action.actorCues) {
      db.prepare(
        `INSERT INTO action_actor_cues (
          project_id, action_id, cue_index, time_ms, actor_side, animation_name,
          source_anim_code, loop, speed, return_animation, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(pkg.project.id, action.actionId, cue.cueIndex, cue.timeMs, cue.actorSide, cue.animationName, cue.sourceAnimCode, cue.loop ? 1 : 0, cue.speed, cue.returnAnimation, JSON.stringify(cue.raw));
    }

    for (const cue of action.motionCues) {
      db.prepare(
        `INSERT INTO action_motion_cues (
          project_id, action_id, cue_index, time_ms, subject, motion_type, target_code,
          offset_x, offset_y, duration_ms, easing, flip, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(pkg.project.id, action.actionId, cue.cueIndex, cue.timeMs, cue.subject, cue.motionType, cue.targetCode, cue.offsetX, cue.offsetY, cue.durationMs, cue.easing, cue.flip ? 1 : 0, JSON.stringify(cue.raw));
    }

    for (const cue of action.hitCues) {
      db.prepare(
        `INSERT INTO action_hit_cues (
          project_id, action_id, cue_index, time_ms, target_actor_id, target_code,
          hit_index, hit_count, hit_animation, hit_duration_ms, hit_pause_ms,
          time_source, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(pkg.project.id, action.actionId, cue.cueIndex, cue.timeMs, cue.targetActorId, cue.targetCode, cue.hitIndex, cue.hitCount, cue.hitAnimation, cue.hitDurationMs, cue.hitPauseMs, cue.timeSource, JSON.stringify(cue.raw));
    }

    for (const cue of action.effectCues) {
      db.prepare(
        `INSERT INTO action_effect_cues (
          project_id, action_id, cue_index, time_ms, time_source, effect_role,
          effect_asset_id, effect_name, effect_animation, hit_cue_id, hit_index,
          target_actor_id, target_code, anchor, position_type, offset_x, offset_y,
          layer, scale, speed, loop, z_index, mask_type, direction_mode, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pkg.project.id,
        action.actionId,
        cue.cueIndex,
        cue.timeMs,
        cue.timeSource,
        cue.effectRole,
        cue.effectAssetId,
        cue.effectName,
        cue.effectAnimation,
        cue.hitCueId,
        cue.hitIndex,
        cue.targetActorId,
        cue.targetCode,
        cue.anchor,
        cue.positionType,
        cue.offsetX,
        cue.offsetY,
        cue.layer,
        cue.scale,
        cue.speed,
        cue.loop ? 1 : 0,
        cue.zIndex,
        cue.maskType,
        cue.directionMode,
        JSON.stringify(cue.raw),
      );
    }
  }
}

function buildStats(pkg: NormalizedHubIngest): HubIngestResult["stats"] {
  const normalSpineAssets = pkg.spineAssets.filter((asset) => !isCutinSpineAsset(asset));
  const cutinSpineAssets = pkg.spineAssets.filter((asset) => isCutinSpineAsset(asset));
  const normalSpineAssetPaths = normalSpineAssets.reduce((sum, asset) => sum + spineAssetPathCount(asset), 0);
  const cutinSpineAssetPaths = cutinSpineAssets.reduce((sum, asset) => sum + spineAssetPathCount(asset), 0);
  const effectAssetPaths = pkg.effectAssets.reduce((sum, asset) => sum + spineAssetPathCount(asset), 0);
  return {
    roles: pkg.roles.length,
    roleImages: pkg.roles.reduce((sum, role) => sum + role.images.length, 0),
    skills: pkg.roles.reduce((sum, role) => sum + role.skills.length, 0),
    spineAssets: normalSpineAssets.length,
    spineRoles: new Set(normalSpineAssets.map((asset) => asset.roleSourceId).filter(Boolean)).size,
    animations: normalSpineAssets.reduce((sum, asset) => sum + asset.animations.length, 0),
    cutinSpineAssets: cutinSpineAssets.length,
    cutinSpineRoles: new Set(cutinSpineAssets.map((asset) => asset.roleSourceId).filter(Boolean)).size,
    cutinAnimations: cutinSpineAssets.reduce((sum, asset) => sum + asset.animations.length, 0),
    cutinAssetPaths: cutinSpineAssetPaths,
    assetPaths: normalSpineAssetPaths + cutinSpineAssetPaths + effectAssetPaths,
    effectAssets: pkg.effectAssets.length,
    roleActions: pkg.actions.length,
    actorCues: pkg.actions.reduce((sum, action) => sum + action.actorCues.length, 0),
    motionCues: pkg.actions.reduce((sum, action) => sum + action.motionCues.length, 0),
    hitCues: pkg.actions.reduce((sum, action) => sum + action.hitCues.length, 0),
    effectCues: pkg.actions.reduce((sum, action) => sum + action.effectCues.length, 0),
  };
}

function buildMissingStats(pkg: NormalizedHubIngest): MissingFileStats {
  const missingAssetSamples: string[] = [];
  let checkedAssets = 0;
  let missingAssets = 0;
  const checkAsset = (assetPath: string | null) => {
    if (!assetPath) return;
    checkedAssets += 1;
    const target = filePath(defaultWwwRoot, pkg.project.id, "assets", assetPath);
    if (!fs.existsSync(target)) {
      missingAssets += 1;
      if (missingAssetSamples.length < 20) missingAssetSamples.push(target);
    }
  };
  for (const asset of pkg.spineAssets) {
    checkAsset(asset.skeletonPath);
    checkAsset(asset.jsonPath);
    checkAsset(asset.atlasPath);
    for (const page of asset.pages) checkAsset(page);
  }
  for (const asset of pkg.effectAssets) {
    checkAsset(asset.skeletonPath);
    checkAsset(asset.jsonPath);
    checkAsset(asset.atlasPath);
    for (const page of asset.pages) checkAsset(page);
  }

  const missingCatalogSamples: string[] = [];
  let checkedCatalog = 0;
  let missingCatalog = 0;
  const checkCatalog = (catalogPath: string | null) => {
    if (!catalogPath) return;
    checkedCatalog += 1;
    const target = filePath(defaultWwwRoot, pkg.project.id, "catalog", catalogPath);
    if (!fs.existsSync(target)) {
      missingCatalog += 1;
      if (missingCatalogSamples.length < 20) missingCatalogSamples.push(target);
    }
  };
  checkCatalog(pkg.project.iconPath);
  for (const role of pkg.roles) {
    for (const image of role.images) checkCatalog(image.path);
    for (const skill of role.skills) checkCatalog(skill.iconPath);
  }

  return {
    asset: { checked: checkedAssets, missing: missingAssets, samples: missingAssetSamples },
    catalog: { checked: checkedCatalog, missing: missingCatalog, samples: missingCatalogSamples },
  };
}

export function replaceProjectFromHubIngest(db: DatabaseSync, routeProjectId: string, input: unknown): HubIngestResult {
  const pkg = normalizePackage(input, routeProjectId);
  const importedAt = new Date().toISOString();
  const stats = buildStats(pkg);
  const missingFiles = buildMissingStats(pkg);
  const warnings = [...pkg.warnings];
  if (missingFiles.asset.missing) warnings.push(`${missingFiles.asset.missing} asset files are missing under ${defaultWwwRoot}`);
  if (missingFiles.catalog.missing) warnings.push(`${missingFiles.catalog.missing} catalog files are missing under ${defaultWwwRoot}`);

  const run = db.prepare("INSERT INTO import_runs (started_at, status) VALUES (?, ?)").run(importedAt, "running");
  const runId = Number(run.lastInsertRowid);
  try {
    db.exec("BEGIN IMMEDIATE");
    deleteProjectData(db, pkg.project.id);
    insertProject(db, pkg, stats, importedAt);
    insertRoles(db, pkg);
    insertSpineAssets(db, pkg);
    insertEffectAssets(db, pkg);
    insertBattleProfile(db, pkg);
    insertActions(db, pkg);
    db.exec("COMMIT");
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ?, stats_json = ? WHERE id = ?").run(
      new Date().toISOString(),
      "success",
      "Imported project from hub-ingest API",
      JSON.stringify({ projectId: pkg.project.id, stats, missingFiles, warnings }),
      runId,
    );
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
  }

  return {
    projectId: pkg.project.id,
    importedAt,
    stats,
    missingFiles,
    warnings,
  };
}
