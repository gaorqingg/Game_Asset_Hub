import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../server/db/database.js";
import {
  joinPublicUrl,
  normalizeAssetPath,
  projectAssetBaseUrl,
  projectCatalogBaseUrl,
  projectPublicRoot,
  sourceProjects,
  type SourceProject,
} from "../server/config.js";

type JsonMap = Record<string, unknown>;

interface NormalizedRole {
  sourceId: string;
  displayName: string;
  fallbackName: string;
  model: string | null;
  career: string | null;
  rarity: string | null;
  category: string | null;
  source: string | null;
  searchText: string;
  dataQuality: string[];
  raw: JsonMap;
  images: { kind: string; path: string; sourcePath?: string }[];
  skills: NormalizedSkill[];
}

interface NormalizedSkill {
  sourceId: string;
  slot: string | null;
  slotLabel: string | null;
  name: string;
  iconPath: string | null;
  summary: string;
  description: string;
  searchText: string;
  raw: JsonMap;
}

interface NormalizedSpineAsset {
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
  raw: JsonMap;
  animations: { name: string; duration: number | null; frameRate: number | null; isDefault: boolean }[];
}

interface NormalizedEffectAsset {
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

interface NormalizedRoleAction {
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
  searchText: string;
  raw: JsonMap;
  actorCues: NormalizedActorCue[];
  motionCues: NormalizedMotionCue[];
  hitCues: NormalizedHitCue[];
  effectCues: NormalizedEffectCue[];
}

interface NormalizedActorCue {
  cueIndex: number;
  timeMs: number;
  actorSide: "caster" | "target";
  animationName: string;
  sourceAnimCode: string | null;
  loop: boolean;
  speed: number;
  returnAnimation: string | null;
  raw: JsonMap;
}

interface NormalizedMotionCue {
  cueIndex: number;
  timeMs: number;
  subject: "caster" | "target";
  motionType: string;
  targetCode: string | null;
  offsetX: number;
  offsetY: number;
  durationMs: number;
  easing: string | null;
  flip: boolean;
  raw: JsonMap;
}

interface NormalizedHitCue {
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

interface NormalizedEffectCue {
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

interface BattleProfile {
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

interface ActionImportResult {
  actions: NormalizedRoleAction[];
  effectAssets: NormalizedEffectAsset[];
  battleProfile: BattleProfile | null;
}

function readJson(filePath: string): JsonMap {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonMap;
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

function label(value: unknown): string {
  const record = asRecord(value);
  return text(record.label) || text(record.name) || text(record.code);
}

function safeAssetId(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "asset";
}

function uniqueAssetId(projectId: string, candidate: string, seen: Set<string>): string {
  const base = safeAssetId(candidate);
  let next = base;
  let index = 2;
  while (seen.has(next)) {
    next = `${base}_${index}`;
    index += 1;
  }
  seen.add(next);
  return next;
}

function looksCorrupt(value: string): boolean {
  return /[�锛€鐏绋灞熷垪鍝佽川]/.test(value) || /\?/.test(value);
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
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function boolValue(value: unknown, fallback = false): boolean {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function secondsToMs(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.round(result * 1000)) : null;
}

function timeMs(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeImagePath(projectId: string, imagePath: string): string {
  return imagePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^catalog\//, "");
}

function normalizeRole(project: SourceProject, roleInput: unknown): NormalizedRole {
  const role = asRecord(roleInput);
  const profile = asRecord(role.profile);
  const images = asRecord(role.images);
  const sourceId = firstText(role.id, profile.rawId, role.model, role.name);
  const fallbackName = firstText(role.model, role.id, profile.rawId, sourceId);
  const displayName = firstText(role.displayName, role.name, profile.name, role.model, sourceId) || sourceId;
  const category = firstText(label(role.category), label(profile.property), label(profile.nature), label(role.source));
  const career = firstText(label(profile.career), label(role.source), label(role.category));
  const rarity = firstText(label(profile.rareness), label(profile.rarity), label(role.hierarchy), label(role.quality), label(profile.star));
  const source = firstText(label(role.source), text(profile.sourceTable), text(role.sourceTable));
  const quality = new Set<string>();
  if (!displayName || displayName === sourceId) quality.add("fallback-name");
  if (looksCorrupt(displayName) || looksCorrupt(rarity) || looksCorrupt(career)) quality.add("source-text");

  const roleImages = Object.entries(images)
    .filter(([kind, value]) => typeof value === "string" && kind !== "source")
    .map(([kind, value]) => ({
      kind,
      path: normalizeImagePath(project.id, String(value)),
      sourcePath: text(asRecord(images.source)?.[kind]),
    }));

  const skills = asArray(role.skills).map((skillInput, index) => {
    const skill = asRecord(skillInput);
    const sourceIdValue = firstText(skill.id, `${sourceId}-${index + 1}`);
    const slot = firstText(skill.slot, skill.type);
    const slotLabel = firstText(skill.slotLabel, slot);
    const name = firstText(skill.name, sourceIdValue);
    const iconPath = firstText(skill.icon, skill.iconSource);
    const summary = firstText(skill.summary, skill.directionsText);
    const description = firstText(skill.description, skill.directionsText, skill.directionsHtml);
    return {
      sourceId: sourceIdValue,
      slot,
      slotLabel,
      name,
      iconPath: iconPath ? normalizeImagePath(project.id, iconPath) : null,
      summary,
      description,
      searchText: [name, slotLabel, summary, description, sourceIdValue].join(" "),
      raw: skill,
    };
  });

  const searchText = [
    sourceId,
    displayName,
    fallbackName,
    text(role.model),
    career,
    rarity,
    category,
    source,
    text(profile.title),
    text(profile.location),
    text(profile.story),
    text(profile.introduction),
    ...skills.map((skill) => skill.searchText),
  ].join(" ");

  return {
    sourceId,
    displayName,
    fallbackName,
    model: text(role.model) || null,
    career: career || null,
    rarity: rarity || null,
    category: category || null,
    source: source || null,
    searchText,
    dataQuality: [...quality],
    raw: role,
    images: roleImages,
    skills,
  };
}

function normalizePages(asset: JsonMap, basePath: string | null): string[] {
  const pages = asArray(asset.pages).map((page) => normalizeAssetPath(String(page))).filter(Boolean);
  if (!basePath) return pages;
  const baseDir = normalizeAssetPath(basePath).split("/").slice(0, -1).join("/");
  return pages.map((page) => {
    if (page.includes("/")) return normalizeAssetPath(page);
    return [baseDir, page].filter(Boolean).join("/");
  });
}

function roleIdFor3017(character: JsonMap): string | null {
  return firstText(character.cardId, character.unitId, character.figureId) || null;
}

function normalizeSpineAssets(project: SourceProject, manifest: JsonMap, roleBySource: Map<string, NormalizedRole>): NormalizedSpineAsset[] {
  const assets: NormalizedSpineAsset[] = [];
  const seenIds = new Set<string>();
  const actionById = new Map<string, JsonMap>();
  for (const actionInput of asArray(manifest.actions)) {
    const action = asRecord(actionInput);
    const id = firstText(action.id, action.actionId, action.skillId);
    if (id) actionById.set(id, action);
  }

  if (project.id === "3017") {
    for (const characterInput of asArray(manifest.characters)) {
      const character = asRecord(characterInput);
      const asset = asRecord(character.battleAsset || character.asset || character.displayAsset);
      const sourceAssetId = firstText(character.id, asset.id, character.battleResource, asset.skeleton);
      if (!sourceAssetId || !Object.keys(asset).length) continue;
      const roleSourceId = roleIdFor3017(character);
      const assetId = uniqueAssetId(project.id, sourceAssetId, seenIds);
      const jsonPath = text(asset.json) ? normalizeAssetPath(text(asset.json)) : null;
      const skeletonPath = text(asset.skeleton) ? normalizeAssetPath(text(asset.skeleton)) : null;
      const atlasPath = text(asset.atlas) ? normalizeAssetPath(text(asset.atlas)) : null;
      const animations = asArray(character.actions)
        .map((actionId) => {
          const action = actionById.get(String(actionId));
          return firstText(action?.animation, action?.name, String(actionId).split(":").pop(), actionId);
        })
        .filter(Boolean);
      assets.push({
        assetId,
        sourceAssetId,
        roleSourceId,
        runtime: project.runtime,
        name: firstText(character.name, asset.stem, asset.id, sourceAssetId),
        skeletonPath,
        jsonPath,
        atlasPath,
        pages: normalizePages(asset, atlasPath || jsonPath || skeletonPath),
        version: firstText(asset.version) || null,
        raw: character,
        animations: animations.length
          ? animations.map((animation) => ({ name: animation.split(":").pop() || animation, duration: null, frameRate: 24, isDefault: false }))
          : [{ name: "idle", duration: null, frameRate: 24, isDefault: true }],
      });
    }
    return assets;
  }

  const characters = asRecord(manifest.characters);
  for (const [key, value] of Object.entries(characters)) {
    const entry = asRecord(value);
    const sourceAssetId = firstText(entry.id, key, entry.name, entry.json, entry.skel, entry.skeleton);
    const assetId = uniqueAssetId(project.id, sourceAssetId, seenIds);
    const matchedRole = roleBySource.get(key) || roleBySource.get(firstText(entry.roleId, entry.id, entry.name));
    const roleSourceId = matchedRole?.sourceId || firstText(entry.roleId, entry.id, entry.name, key);
    const jsonPath = text(entry.json) ? normalizeAssetPath(text(entry.json)) : null;
    const skeletonPath = firstText(entry.skel, entry.skeleton);
    const atlasPath = text(entry.atlas) ? normalizeAssetPath(text(entry.atlas)) : null;
    const durations = asRecord(entry.animationDurations);
    const animationNames = asArray(entry.animations).map(String);
    const fallbackAnimations = project.id === "3021"
      ? ["Stand01", "Attack01", "Skill01", "Skill02", "Special01", "Special02", "Hit01"]
      : ["C_idle"];
    assets.push({
      assetId,
      sourceAssetId,
      roleSourceId,
      runtime: project.runtime,
      name: firstText(entry.name, key),
      skeletonPath: skeletonPath ? normalizeAssetPath(skeletonPath) : null,
      jsonPath,
      atlasPath,
      pages: normalizePages(entry, atlasPath || jsonPath || skeletonPath),
      version: firstText(entry.version) || null,
      raw: entry,
      animations: (animationNames.length ? animationNames : fallbackAnimations).map((name) => ({
        name,
        duration: typeof durations[name] === "number" ? Number(durations[name]) : null,
        frameRate: 24,
        isDefault: /^C?_?idle$|stand/i.test(name),
      })),
    });
  }

  return assets;
}

function buildAssetByRole(spineAssets: NormalizedSpineAsset[]): Map<string, NormalizedSpineAsset> {
  const result = new Map<string, NormalizedSpineAsset>();
  for (const asset of spineAssets) {
    if (asset.roleSourceId && !result.has(asset.roleSourceId)) result.set(asset.roleSourceId, asset);
    if (!result.has(asset.sourceAssetId)) result.set(asset.sourceAssetId, asset);
    if (!result.has(asset.name)) result.set(asset.name, asset);
  }
  return result;
}

function effectAssetIdFrom3029(item: JsonMap): string {
  return firstText(item.stem, item.name, item.effectId);
}

function normalize3029EffectAssets(project: SourceProject, manifest: JsonMap): NormalizedEffectAsset[] {
  const effects = asRecord(manifest.effects);
  return Object.entries(effects).map(([key, value]) => {
    const effect = asRecord(value);
    const jsonPath = text(effect.json) ? normalizeAssetPath(text(effect.json)) : null;
    const skeletonPath = firstText(effect.skel, effect.skeleton);
    const atlasPath = text(effect.atlas) ? normalizeAssetPath(text(effect.atlas)) : null;
    const animations = asArray(effect.animations).map(String).filter(Boolean);
    return {
      effectAssetId: firstText(effect.id, key),
      effectName: firstText(effect.name, effect.id, key),
      runtime: project.runtime,
      skeletonPath: skeletonPath ? normalizeAssetPath(skeletonPath) : null,
      jsonPath,
      atlasPath,
      pages: normalizePages(effect, atlasPath || jsonPath || skeletonPath),
      animations,
      defaultAnimation: animations[0] || null,
      bounds: asRecord(effect.animationBounds || effect.bounds),
      raw: effect,
    };
  });
}

function normalize3021EffectAssets(project: SourceProject, manifest: JsonMap): NormalizedEffectAsset[] {
  const effects = asRecord(manifest.effects);
  const config = asRecord(manifest.config);
  const effNodePath = path.join(path.dirname(project.spineManifestJson), firstText(config.eff_node, "config/eff_node.json"));
  const effNode = fs.existsSync(effNodePath) ? readJson(effNodePath) : {};
  return Object.entries(effects).map(([key, value]) => {
    const effect = asRecord(value);
    const node = asRecord(asRecord(effNode)[key]);
    const skeletonPath = firstText(effect.skel, effect.skeleton, effect.json);
    const jsonPath = text(effect.json) && !skeletonPath.endsWith(".skel") ? normalizeAssetPath(text(effect.json)) : null;
    const atlasPath = text(effect.atlas) ? normalizeAssetPath(text(effect.atlas)) : null;
    const defaultAnimation = firstText(node.action_param, "Skill01");
    return {
      effectAssetId: firstText(effect.name, key),
      effectName: firstText(effect.name, key),
      runtime: project.runtime,
      skeletonPath: skeletonPath ? normalizeAssetPath(skeletonPath) : null,
      jsonPath,
      atlasPath,
      pages: normalizePages(effect, atlasPath || jsonPath || skeletonPath),
      animations: defaultAnimation ? [defaultAnimation] : [],
      defaultAnimation: defaultAnimation || null,
      bounds: {},
      raw: { ...effect, effNode: node },
    };
  });
}

const SPINE_TYPE_TO_ANIMATION: Record<string, string> = {
  "3": "Hit01",
  "18": "Stand01",
  "20": "Skill01",
  "21": "Skill02",
  "32": "Attack01",
  "34": "Jump_forward01",
  "35": "Special01",
  "36": "Special02",
};

const PVP_3021_MAIN_FORMATION: Record<"enemy" | "self", Record<string, [number, number]>> = {
  enemy: {
    "1": [222, -365],
    "2": [192, -220],
    "3": [168, -75],
    "4": [310, -300],
    "5": [290, -155],
    "6": [268, -10],
  },
  self: {
    "1": [-222, -365],
    "2": [-192, -220],
    "3": [-168, -75],
    "4": [-310, -300],
    "5": [-290, -155],
    "6": [-268, -10],
  },
};

const PVP_3021_MODEL_SCALE = 0.6;
const PVP_3021_RELEASE_INDEX = "1";
const PVP_3021_VICTIM_INDEX = "1";

function pvp3021Point(side: "enemy" | "self", index: string) {
  return PVP_3021_MAIN_FORMATION[side][index] || PVP_3021_MAIN_FORMATION[side][PVP_3021_RELEASE_INDEX];
}

function average3021Points(points: [number, number][]): [number, number] {
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function pvp3021FormationOriginY() {
  return (pvp3021Point("self", PVP_3021_RELEASE_INDEX)[1] + pvp3021Point("enemy", PVP_3021_VICTIM_INDEX)[1]) / 2;
}

function map3021PvpPoint(point: [number, number], battleCoordScale = 1) {
  return {
    x: point[0] * battleCoordScale,
    y: (pvp3021FormationOriginY() - point[1]) * battleCoordScale,
  };
}

function pvp3021SelfCampCenter() {
  return average3021Points([pvp3021Point("self", "1"), pvp3021Point("self", "6")]);
}

function pvp3021EnemyCampCenter() {
  const selfCenterY = (pvp3021Point("self", "1")[1] + pvp3021Point("self", "6")[1]) / 2;
  return [
    (pvp3021Point("enemy", "1")[0] + pvp3021Point("enemy", "6")[0]) / 2,
    selfCenterY,
  ] as [number, number];
}

function pvp3021OurCenter() {
  const self = pvp3021Point("self", "2");
  const enemy = pvp3021Point("enemy", "2");
  const centerY = (pvp3021Point("self", "1")[1] + pvp3021Point("self", "6")[1]) / 2;
  return [(self[0] + enemy[0]) / 2, centerY] as [number, number];
}

function pvp3021OurFrontCenter() {
  const self = pvp3021Point("self", "2");
  const enemy = pvp3021Point("enemy", "2");
  const offset = (Math.abs(self[0]) + Math.abs(enemy[0])) / 4;
  return [self[0] + offset, self[1]] as [number, number];
}

function pvp3021OurBackCenter() {
  const self = pvp3021Point("self", "2");
  const enemy = pvp3021Point("enemy", "2");
  const offset = (Math.abs(self[0]) + Math.abs(enemy[0])) / 4;
  return [enemy[0] - offset, enemy[1]] as [number, number];
}

function pvp3021LineCenter() {
  return [pvp3021Point("enemy", "5")[0], pvp3021Point("self", "5")[1]] as [number, number];
}

function pvp3021RowLineCenter() {
  if (PVP_3021_VICTIM_INDEX === "1" || PVP_3021_VICTIM_INDEX === "4") {
    return average3021Points([pvp3021Point("enemy", "1"), pvp3021Point("enemy", "4")]);
  }
  if (PVP_3021_VICTIM_INDEX === "2" || PVP_3021_VICTIM_INDEX === "5") {
    return average3021Points([pvp3021Point("enemy", "2"), pvp3021Point("enemy", "5")]);
  }
  return average3021Points([pvp3021Point("enemy", "3"), pvp3021Point("enemy", "6")]);
}

function pvp3021RoutineAnchorPoint(targetCode: string | null): [number, number] {
  switch (targetCode) {
    case "1":
      return pvp3021Point("enemy", PVP_3021_VICTIM_INDEX);
    case "2":
      return pvp3021LineCenter();
    case "3":
      return pvp3021EnemyCampCenter();
    case "4":
      return pvp3021SelfCampCenter();
    case "5":
      return pvp3021OurCenter();
    case "6":
      return pvp3021OurFrontCenter();
    case "7":
      return pvp3021OurBackCenter();
    case "9":
    case "13":
      return pvp3021RowLineCenter();
    case "0":
    case "8":
    case "10":
    default:
      return pvp3021Point("self", PVP_3021_RELEASE_INDEX);
  }
}

function normalized3021RoutineOffsetY(targetCode: string | null) {
  const casterBase = pvp3021Point("self", PVP_3021_RELEASE_INDEX);
  const anchor = pvp3021RoutineAnchorPoint(targetCode);
  return casterBase[1] - anchor[1];
}

function pvp3021EffectAnchorPoint(targetCode: string | null): [number, number] {
  switch (targetCode) {
    case "1":
      return pvp3021Point("enemy", PVP_3021_VICTIM_INDEX);
    case "2":
      return pvp3021LineCenter();
    case "3":
      return pvp3021EnemyCampCenter();
    case "4":
      return pvp3021SelfCampCenter();
    case "5":
      return pvp3021Point("self", "2");
    case "6":
      return pvp3021Point("self", "5");
    case "7":
      return pvp3021Point("enemy", "2");
    case "8":
      return pvp3021Point("enemy", "5");
    case "9":
      return pvp3021OurCenter();
    case "13":
      return pvp3021RowLineCenter();
    case "0":
    case "10":
    default:
      return pvp3021Point("self", PVP_3021_RELEASE_INDEX);
  }
}

function normalized3021EffectOffsetY(targetCode: string | null) {
  const casterBase = pvp3021Point("self", PVP_3021_RELEASE_INDEX);
  const anchor = pvp3021EffectAnchorPoint(targetCode);
  return casterBase[1] - anchor[1];
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

function stage3021PointFromPvp(point: [number, number]) {
  return map3021PvpPoint(point);
}

function stage3021MotionDestination(cue: NormalizedMotionCue) {
  const anchorPvp = pvp3021RoutineAnchorPoint(cue.targetCode);
  const anchor = stage3021PointFromPvp(anchorPvp);
  return {
    x: anchor.x + cue.offsetX,
    y: anchor.y - cue.offsetY,
  };
}

function stage3021CasterPointAt(timeMsValue: number, motionCues: NormalizedMotionCue[]) {
  let current = stage3021PointFromPvp(pvp3021Point("self", PVP_3021_RELEASE_INDEX));
  const cues = [...motionCues]
    .filter((cue) => cue.subject === "caster" && cue.timeMs <= timeMsValue)
    .sort((a, b) => a.timeMs - b.timeMs || a.cueIndex - b.cueIndex);

  for (const cue of cues) {
    const start = current;
    const end = stage3021MotionDestination(cue);
    const duration = Math.max(1, cue.durationMs || 1);
    if (timeMsValue < cue.timeMs + duration) {
      const progress = cue.easing === "easeOutCubic" ? easeOutCubic((timeMsValue - cue.timeMs) / duration) : Math.max(0, Math.min(1, (timeMsValue - cue.timeMs) / duration));
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
    }
    current = end;
  }

  return current;
}

function normalized3021ActorEffectOffsetY(targetCode: string | null, rawOffsetY: number, timeMsValue: number, motionCues: NormalizedMotionCue[]) {
  const anchor = targetCode === "10"
    ? stage3021CasterPointAt(timeMsValue, motionCues)
    : stage3021PointFromPvp(pvp3021Point("enemy", PVP_3021_VICTIM_INDEX));
  const transformedStageY = anchor.y - rawOffsetY;
  return anchor.y - transformedStageY;
}

function is3021ActorEffectTarget(targetCode: string | null) {
  return targetCode === "1" || targetCode === "10";
}

function build3021AnchorRules(): JsonMap {
  return {
    source: "web-spine-demo/src/main.js",
    designWidth: 750,
    defaultResolution: { width: 750, height: 1334 },
    battleCoordScale: {
      default: 1,
      formula: "Math.min(1, Math.max(0.48, rendererWidth / 750))",
    },
    modelScale: {
      base: PVP_3021_MODEL_SCALE,
      formula: "0.6 * role.modelScale",
    },
    releaseIndex: Number(PVP_3021_RELEASE_INDEX),
    victimIndex: Number(PVP_3021_VICTIM_INDEX),
    formation: PVP_3021_MAIN_FORMATION,
    routineTargetOverrides: {
      "8": "heroHome",
    },
    targetSemantics: {
      "1": "enemySlot",
      "2": "lineCenter",
      "3": "enemyCampCenter",
      "4": "selfCampCenter",
      "5": "routine:ourCenter,effect:selfPosition2",
      "6": "routine:ourFrontCenter,effect:selfPosition5",
      "7": "routine:ourBackCenter,effect:enemyPosition2",
      "8": "routine:heroHome,effect:enemyPosition5",
      "9": "routine:rowLineCenter,effect:ourCenter",
      "10": "heroSlot",
      "13": "rowLineCenter",
    },
    offsetRule: "x = anchor.x + offsetX * battleCoordScale; y = anchor.y - offsetY * battleCoordScale",
    motionOffsetYNormalization: {
      appliesTo: "script.routine",
      formula: "db.offsetY = casterBasePvpY - routineAnchorPvpY",
      sourceOffsetY: "raw_json.offsetY",
      result: "external routine movement keeps caster Y stable; Spine animation may still move bones internally",
    },
    effectOffsetYNormalization: {
      appliesTo: "script.eff",
      actorAnchorFormula: "target 1/10: db.offsetY is derived from the placed target/caster stage point plus source offsetY",
      fieldAnchorFormula: "target 2/3/4/5/6/7/8/9/13: db.offsetY = casterBasePvpY - effectAnchorPvpY",
      sourceOffsetY: "raw_json.offsetY",
      result: "actor-anchor effects follow their actor anchor; field-anchor effects keep the caster center Y",
    },
  };
}

function normalize3029EventTime(events: unknown[], eventName: string, item: JsonMap, index: number, fallbackMs: number | null): { timeMs: number; source: string } {
  const effectId = firstText(item.effectId);
  const stem = firstText(item.stem, item.name);
  const animation = firstText(item.animation);
  const matched = events
    .map(asRecord)
    .filter((event) => text(event.name) === eventName)
    .find((event, eventIndex) => {
      const eventString = text(event.string);
      return firstText(event.int) === effectId
        || (!!eventString && !!stem && eventString === `${stem}:${animation}`)
        || eventIndex === index;
    });
  if (matched) return { timeMs: secondsToMs(matched.time) || 0, source: "spine_event" };
  return { timeMs: fallbackMs ?? 0, source: fallbackMs === null ? "fallback" : "timeline" };
}

function normalize3029EffectCue(
  cueIndex: number,
  actionId: string,
  effectRole: string,
  itemInput: unknown,
  timing: { timeMs: number; source: string },
): NormalizedEffectCue {
  const item = asRecord(itemInput);
  const placement = asRecord(item.placement);
  const pos = asRecord(placement.pos || item.pos);
  const target = firstText(placement.target, item.target, effectRole === "release" ? "0" : "1");
  const layer = firstText(placement.layer, item.layer, effectRole === "face" ? "screen" : "front");
  return {
    cueIndex,
    timeMs: timing.timeMs,
    timeSource: timing.source,
    effectRole,
    effectAssetId: effectAssetIdFrom3029(item),
    effectName: firstText(item.name, item.stem, item.effectId),
    effectAnimation: firstText(item.animation) || null,
    hitCueId: effectRole === "hit" ? numberValue(item.hitIndex, 0) : null,
    hitIndex: effectRole === "hit" ? numberValue(item.hitIndex, 0) : null,
    targetActorId: "default-enemy",
    targetCode: target,
    anchor: firstText(placement.anchor) || null,
    positionType: layer === "screen" ? "screen" : target === "0" || target === "10" ? "role" : "enemy",
    offsetX: numberValue(pos.x),
    offsetY: numberValue(pos.y),
    layer,
    scale: numberValue(placement.scale, 1),
    speed: 1,
    loop: false,
    zIndex: layer === "back" ? -1 : layer === "screen" ? 10 : 1,
    maskType: 0,
    directionMode: effectRole === "hit" ? "target" : "caster",
    raw: { actionId, ...item },
  };
}

function normalize3029Actions(project: SourceProject, manifest: JsonMap): ActionImportResult {
  const characters = asRecord(manifest.characters);
  const effects = normalize3029EffectAssets(project, manifest);
  const defaults = asRecord(manifest.defaults);
  const actions: NormalizedRoleAction[] = [];

  for (const actionInput of asArray(manifest.actions)) {
    const action = asRecord(actionInput);
    const roleSourceId = firstText(action.roleId);
    const actionId = firstText(action.id, `${roleSourceId}:${firstText(action.skillId, action.animation)}`);
    if (!roleSourceId || !actionId) continue;

    const roleAnimation = firstText(action.animation, "C_idle");
    const durationMs = secondsToMs(action.duration);
    const roleEventsByAnimation = asRecord(asRecord(asRecord(characters)[roleSourceId]).animationEvents);
    const roleEvents = asArray(roleEventsByAnimation[roleAnimation]);
    const timeline = asRecord(action.timeline);
    const releaseTimes = asArray(timeline.releaseTimes).map(timeMs);
    const hitTimes = asArray(timeline.hitTimes).map(timeMs);
    const faceTimes = asArray(timeline.faceTimes).map(timeMs);
    const actorCues: NormalizedActorCue[] = [{
      cueIndex: 0,
      timeMs: 0,
      actorSide: "caster",
      animationName: roleAnimation,
      sourceAnimCode: null,
      loop: false,
      speed: 1,
      returnAnimation: firstText(defaults.idleAnimation, "C_idle"),
      raw: { animation: roleAnimation },
    }];
    const motionCues: NormalizedMotionCue[] = [];
    const movement = asRecord(action.movement);
    if (Object.keys(movement).length) {
      const distance = asRecord(movement.attackDistance);
      motionCues.push({
        cueIndex: 0,
        timeMs: 0,
        subject: "caster",
        motionType: "approach",
        targetCode: "1",
        offsetX: numberValue(distance.x),
        offsetY: numberValue(distance.y),
        durationMs: numberValue(movement.approachMaxMs, 220),
        easing: "linear",
        flip: false,
        raw: movement,
      });
      motionCues.push({
        cueIndex: 1,
        timeMs: Math.max(0, (durationMs || 900) - numberValue(movement.returnMaxMs, 220)),
        subject: "caster",
        motionType: "return",
        targetCode: "origin",
        offsetX: 0,
        offsetY: 0,
        durationMs: numberValue(movement.returnMaxMs, 220),
        easing: "linear",
        flip: false,
        raw: movement,
      });
    }

    const effectCues: NormalizedEffectCue[] = [];
    let cueIndex = 0;
    for (const [kind, sourceEvent, items, fallbackTimes] of [
      ["release", "playSkillEffect", asArray(action.releaseEffects), releaseTimes],
      ["hit", "playHitEffect", asArray(action.hitEffects), hitTimes],
      ["face", "playFaceEffect", asArray(action.faceEffects), faceTimes],
    ] as const) {
      items.forEach((item, index) => {
        const fallback = fallbackTimes[index] ?? (kind === "release" ? 80 : kind === "face" ? 0 : null);
        effectCues.push(normalize3029EffectCue(cueIndex++, actionId, kind, item, normalize3029EventTime(roleEvents, sourceEvent, asRecord(item), index, fallback)));
      });
    }

    const hitEventTimes = roleEvents
      .map(asRecord)
      .filter((event) => text(event.name) === "hit")
      .map((event) => secondsToMs(event.time) || 0);
    const hitFallbackTimes = effectCues.filter((cue) => cue.effectRole === "hit").map((cue) => cue.timeMs);
    const hitTimesFinal = uniqueBy([...hitEventTimes, ...hitFallbackTimes].sort((a, b) => a - b).map((value, index) => ({ value, index })), (item) => String(item.value));
    const hitCues: NormalizedHitCue[] = hitTimesFinal.map((item, index) => ({
      cueIndex: index,
      timeMs: item.value,
      targetActorId: "default-enemy",
      targetCode: "1",
      hitIndex: index,
      hitCount: hitTimesFinal.length || numberValue(action.hitCount, 1),
      hitAnimation: "Hit01",
      hitDurationMs: 420,
      hitPauseMs: 0,
      timeSource: hitEventTimes.includes(item.value) ? "spine_event" : "fallback",
      raw: { actionId, timeMs: item.value },
    }));

    actions.push({
      roleSourceId,
      actionId,
      skillId: firstText(action.skillId) || null,
      slot: firstText(action.slot) || null,
      slotLabel: firstText(action.slotLabel) || null,
      actionName: firstText(action.name, roleAnimation, actionId),
      label: firstText(action.label, action.name, actionId),
      sourceKind: "manifest_action",
      roleAnimation,
      scriptName: null,
      durationMs,
      isPrimary: boolValue(action.primary),
      remark: actionRemark(action),
      searchText: [actionId, roleSourceId, action.skillId, action.slotLabel, action.name, action.label, roleAnimation, actionRemark(action)].join(" "),
      raw: action,
      actorCues,
      motionCues,
      hitCues,
      effectCues,
    });
  }

  const defaultEnemy = firstText(defaults.enemy, defaults.hero);
  return {
    actions,
    effectAssets: effects,
    battleProfile: {
      defaultEnemyRoleSourceId: defaultEnemy || null,
      defaultEnemyAssetId: defaultEnemy || null,
      battleCoordScale: 1,
      casterX: -250,
      casterY: 0,
      targetX: 250,
      targetY: 0,
      casterScale: 0.42,
      targetScale: 0.42,
      coordinateMode: "3029",
      idleAnimation: firstText(defaults.idleAnimation, "C_idle"),
      hitAnimation: "C_beatback_dead",
      anchorRules: {},
      raw: defaults,
    },
  };
}

function normalize3021Actions(project: SourceProject, manifest: JsonMap, roleBySource: Map<string, NormalizedRole>, assetByRole: Map<string, NormalizedSpineAsset>): ActionImportResult {
  const effects = normalize3021EffectAssets(project, manifest);
  const effectById = new Map(effects.map((effect) => [effect.effectAssetId, effect]));
  const config = asRecord(manifest.config);
  const effNodePath = path.join(path.dirname(project.spineManifestJson), firstText(config.eff_node, "config/eff_node.json"));
  const effNode = fs.existsSync(effNodePath) ? readJson(effNodePath) : {};
  const scriptRoot = path.join(path.dirname(project.spineManifestJson), "scripts");
  const actions: NormalizedRoleAction[] = [];

  for (const roleInput of asArray(manifest.roles)) {
    const role = asRecord(roleInput);
    const model = firstText(role.model);
    const matchedRole = roleBySource.get(firstText(role.id)) || roleBySource.get(model);
    const roleSourceId = matchedRole?.sourceId || firstText(role.id, model);
    if (!roleSourceId) continue;
    for (const actionInput of asArray(role.actions)) {
      const action = asRecord(actionInput);
      const scriptName = firstText(action.script);
      const actionId = `${roleSourceId}:${firstText(action.skillId, scriptName)}`;
      if (!scriptName) continue;
      const scriptPath = path.join(scriptRoot, `${scriptName}.json`);
      const script = fs.existsSync(scriptPath) ? readJson(scriptPath) : {};
      const actorCues = asArray(script.spine).map((cueInput, cueIndex): NormalizedActorCue => {
        const cue = asRecord(cueInput);
        const sourceCode = firstText(cue.spineType);
        return {
          cueIndex,
          timeMs: timeMs(cue.time),
          actorSide: "caster",
          animationName: SPINE_TYPE_TO_ANIMATION[sourceCode] || firstText(cue.animation, cue.action, "Skill01"),
          sourceAnimCode: sourceCode || null,
          loop: boolValue(cue.isLoop),
          speed: numberValue(cue.timeScale, 1),
          returnAnimation: "Stand01",
          raw: cue,
        };
      });
      if (!actorCues.length) {
        actorCues.push({
          cueIndex: 0,
          timeMs: 0,
          actorSide: "caster",
          animationName: "Skill01",
          sourceAnimCode: null,
          loop: false,
          speed: 1,
          returnAnimation: "Stand01",
          raw: {},
        });
      }

      const motionCues = asArray(script.routine).map((cueInput, cueIndex): NormalizedMotionCue => {
        const cue = asRecord(cueInput);
        const targetCode = firstText(cue.target) || null;
        const normalizedOffsetY = normalized3021RoutineOffsetY(targetCode);
        return {
          cueIndex,
          timeMs: timeMs(cue.time),
          subject: "caster",
          motionType: "routine",
          targetCode,
          offsetX: numberValue(cue.offsetX),
          offsetY: normalizedOffsetY,
          durationMs: Math.max(60, timeMs(cue.flyTime) || 100),
          easing: "easeOutCubic",
          flip: boolValue(cue.flip),
          raw: {
            ...cue,
            normalizedOffsetY,
            offsetYNormalization: "casterBasePvpY - routineAnchorPvpY",
          },
        };
      });

      const hitCues = asArray(script.hit).map((cueInput, cueIndex): NormalizedHitCue => {
        const cue = asRecord(cueInput);
        return {
          cueIndex,
          timeMs: timeMs(cue.time),
          targetActorId: "default-enemy",
          targetCode: "1",
          hitIndex: cueIndex,
          hitCount: asArray(script.hit).length,
          hitAnimation: "Hit01",
          hitDurationMs: 420,
          hitPauseMs: timeMs(cue.delay),
          timeSource: "script_json",
          raw: cue,
        };
      });

      const effectCues = asArray(script.eff).map((cueInput, cueIndex): NormalizedEffectCue => {
        const cue = asRecord(cueInput);
        const effectName = firstText(cue.name, cue.name2);
        const node = asRecord(asRecord(effNode)[effectName]);
        const effectAsset = effectById.get(effectName);
        const targetCode = firstText(cue.target, "1");
        const rawOffsetY = numberValue(cue.offsetY);
        const isActorAnchorEffect = is3021ActorEffectTarget(targetCode);
        const normalizedOffsetY = isActorAnchorEffect
          ? normalized3021ActorEffectOffsetY(targetCode, rawOffsetY, timeMs(cue.time), motionCues)
          : normalized3021EffectOffsetY(targetCode);
        const effectPositionMode = isActorAnchorEffect ? "actor-anchor-converted" : "field-anchor-normalized-y";
        return {
          cueIndex,
          timeMs: timeMs(cue.time),
          timeSource: "script_json",
          effectRole: targetCode === "4" || targetCode === "10" ? "release" : "hit",
          effectAssetId: effectName,
          effectName,
          effectAnimation: firstText(node.action_param, effectAsset?.defaultAnimation, "Skill01") || null,
          hitCueId: null,
          hitIndex: null,
          targetActorId: "default-enemy",
          targetCode,
          anchor: targetCode === "4" || targetCode === "10" ? "caster-foot" : "target-body",
          positionType: targetCode === "4" || targetCode === "10" ? "role" : "enemy",
          offsetX: numberValue(cue.offsetX),
          offsetY: normalizedOffsetY,
          layer: boolValue(cue.isRoleUp, true) ? "front" : "back",
          scale: numberValue(cue.scale, 1) * numberValue(node.eff_scale, 100) / 100,
          speed: numberValue(cue.timeScale, 1) * numberValue(node.speed_scale, 100) / 100,
          loop: boolValue(node.loop),
          zIndex: numberValue(cue.effDeep),
          maskType: numberValue(cue.maskType),
          directionMode: targetCode === "4" || targetCode === "10" ? "caster" : "target",
          raw: {
            ...cue,
            effectPositionMode,
            normalizedOffsetY,
            offsetYNormalization: isActorAnchorEffect
              ? "actorStageY - transformedEffectStageY"
              : "casterBasePvpY - effectAnchorPvpY",
          },
        };
      });

      const lastCue = Math.max(
        ...actorCues.map((cue) => cue.timeMs),
        ...motionCues.map((cue) => cue.timeMs + cue.durationMs),
        ...hitCues.map((cue) => cue.timeMs + (cue.hitDurationMs || 0)),
        ...effectCues.map((cue) => cue.timeMs + 1200),
        1000,
      );

      actions.push({
        roleSourceId,
        actionId,
        skillId: firstText(action.skillId) || null,
        slot: firstText(action.slot) || null,
        slotLabel: firstText(action.slotLabel) || null,
        actionName: firstText(action.name, action.label, scriptName),
        label: firstText(action.label, action.name, scriptName),
        sourceKind: "script_json",
        roleAnimation: actorCues[0]?.animationName || null,
        scriptName,
        durationMs: lastCue + 500,
        isPrimary: boolValue(action.primary),
        remark: actionRemark(action),
        searchText: [roleSourceId, model, action.skillId, action.slotLabel, action.name, action.label, scriptName, actionRemark(action)].join(" "),
        raw: { ...action, roleModel: model },
        actorCues,
        motionCues,
        hitCues,
        effectCues,
      });
    }
  }

  const defaultEnemyModel = firstText(asArray(manifest.defaultEnemies)[0]);
  const defaultEnemyAsset = assetByRole.get(defaultEnemyModel);
  const casterHome = map3021PvpPoint(pvp3021Point("self", PVP_3021_RELEASE_INDEX));
  const targetHome = map3021PvpPoint(pvp3021Point("enemy", PVP_3021_VICTIM_INDEX));
  return {
    actions,
    effectAssets: effects,
    battleProfile: {
      defaultEnemyRoleSourceId: defaultEnemyAsset?.roleSourceId || defaultEnemyModel || null,
      defaultEnemyAssetId: defaultEnemyAsset?.assetId || defaultEnemyModel || null,
      battleCoordScale: 1,
      casterX: casterHome.x,
      casterY: casterHome.y,
      targetX: targetHome.x,
      targetY: targetHome.y,
      casterScale: PVP_3021_MODEL_SCALE,
      targetScale: PVP_3021_MODEL_SCALE,
      coordinateMode: "3021",
      idleAnimation: "Stand01",
      hitAnimation: "Hit01",
      anchorRules: build3021AnchorRules(),
      raw: { defaultHero: manifest.defaultHero, defaultEnemies: manifest.defaultEnemies },
    },
  };
}

function normalizeActionEffects(project: SourceProject, manifest: JsonMap, roleBySource: Map<string, NormalizedRole>, spineAssets: NormalizedSpineAsset[]): ActionImportResult {
  if (project.id === "3029") return normalize3029Actions(project, manifest);
  if (project.id === "3021") return normalize3021Actions(project, manifest, roleBySource, buildAssetByRole(spineAssets));
  return { actions: [], effectAssets: [], battleProfile: null };
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

function copyCatalogImages(project: SourceProject): void {
  const sourceImages = path.join(project.catalogPublicRoot, "images");
  const targetImages = path.join(projectPublicRoot, project.id, "catalog", "images");
  if (!fs.existsSync(sourceImages)) return;
  fs.mkdirSync(path.dirname(targetImages), { recursive: true });
  fs.cpSync(sourceImages, targetImages, { recursive: true, force: true });
}

function insertProject(db: DatabaseSync, project: SourceProject, stats: { roleCount: number; spineRoleCount: number; animationCount: number; iconPath: string | null }) {
  const now = new Date().toISOString();
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
    rootPath: project.rootPath,
    createdAt: project.createdAt,
    tagsJson: JSON.stringify(project.tags),
    iconPath: stats.iconPath,
    runtime: project.runtime,
    assetBaseUrl: projectAssetBaseUrl(project.id),
    catalogBaseUrl: projectCatalogBaseUrl(project.id),
    sourceCatalogJson: project.catalogJson,
    sourceSpineManifest: project.spineManifestJson,
    roleCount: stats.roleCount,
    spineRoleCount: stats.spineRoleCount,
    animationCount: stats.animationCount,
    updatedAt: now,
  });
}

function insertRole(db: DatabaseSync, project: SourceProject, role: NormalizedRole, spineStats: { hasSpine: boolean; animationCount: number }) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO roles (
      project_id, source_id, display_name, fallback_name, model, career, rarity,
      category, source, search_text, data_quality, has_spine, animation_count,
      raw_json, updated_at
    ) VALUES (
      @projectId, @sourceId, @displayName, @fallbackName, @model, @career, @rarity,
      @category, @source, @searchText, @dataQuality, @hasSpine, @animationCount,
      @rawJson, @updatedAt
    )`,
  ).run({
    projectId: project.id,
    sourceId: role.sourceId,
    displayName: role.displayName,
    fallbackName: role.fallbackName,
    model: role.model,
    career: role.career,
    rarity: role.rarity,
    category: role.category,
    source: role.source,
    searchText: role.searchText,
    dataQuality: JSON.stringify(role.dataQuality),
    hasSpine: spineStats.hasSpine ? 1 : 0,
    animationCount: spineStats.animationCount,
    rawJson: JSON.stringify(role.raw),
    updatedAt: now,
  });

  const roleRowId = Number(result.lastInsertRowid);
  db.prepare(
    `INSERT INTO roles_fts (
      rowid, project_id, source_id, display_name, fallback_name, career,
      rarity, category, source, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(roleRowId, project.id, role.sourceId, role.displayName, role.fallbackName, role.career || "", role.rarity || "", role.category || "", role.source || "", role.searchText);

  for (const image of role.images) {
    db.prepare(
      `INSERT OR REPLACE INTO role_images (project_id, role_source_id, kind, path, source_path)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(project.id, role.sourceId, image.kind, image.path, image.sourcePath || null);
  }

  for (const skill of role.skills) {
    const skillResult = db.prepare(
      `INSERT INTO skills (
        project_id, role_source_id, source_id, slot, slot_label, name, icon_path,
        summary, description, search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      role.sourceId,
      skill.sourceId,
      skill.slot,
      skill.slotLabel,
      skill.name,
      skill.iconPath,
      skill.summary,
      skill.description,
      skill.searchText,
      JSON.stringify(skill.raw),
    );
    db.prepare(
      `INSERT INTO skills_fts (
        rowid, project_id, role_source_id, source_id, name, slot_label,
        summary, description, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(Number(skillResult.lastInsertRowid), project.id, role.sourceId, skill.sourceId, skill.name, skill.slotLabel || "", skill.summary, skill.description, skill.searchText);
  }
}

function addAssetPath(db: DatabaseSync, project: SourceProject, asset: NormalizedSpineAsset, kind: string, assetPath: string | null) {
  if (!assetPath) return;
  const normalized = normalizeAssetPath(assetPath);
  if (!normalized) return;
  db.prepare(
    `INSERT OR IGNORE INTO asset_paths (project_id, asset_id, role_source_id, kind, path, url, exists_on_disk)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    asset.assetId,
    asset.roleSourceId,
    kind,
    normalized,
    joinPublicUrl(projectAssetBaseUrl(project.id), normalized),
    fs.existsSync(path.join(project.spineAssetsRoot, normalized)) ? 1 : 0,
  );
}

function insertSpineAsset(db: DatabaseSync, project: SourceProject, asset: NormalizedSpineAsset) {
  db.prepare(
    `INSERT INTO spine_assets (
      project_id, asset_id, source_asset_id, role_source_id, runtime, name,
      skeleton_path, json_path, atlas_path, pages_json, version, source_manifest, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
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
    project.spineManifestJson,
    JSON.stringify(asset.raw),
  );

  addAssetPath(db, project, asset, "skeleton", asset.skeletonPath);
  addAssetPath(db, project, asset, "json", asset.jsonPath);
  addAssetPath(db, project, asset, "atlas", asset.atlasPath);
  for (const page of asset.pages) addAssetPath(db, project, asset, "page", page);

  for (const animation of asset.animations) {
    const result = db.prepare(
      `INSERT INTO animations (project_id, asset_id, role_source_id, name, duration, frame_rate, is_default, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      asset.assetId,
      asset.roleSourceId,
      animation.name,
      animation.duration,
      animation.frameRate,
      animation.isDefault ? 1 : 0,
      [asset.name, asset.sourceAssetId, animation.name].join(" "),
    );
    db.prepare(
      `INSERT INTO animations_fts (rowid, project_id, asset_id, role_source_id, name, search_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(Number(result.lastInsertRowid), project.id, asset.assetId, asset.roleSourceId || "", animation.name, [asset.name, asset.sourceAssetId, animation.name].join(" "));
  }
}

function addEffectAssetPath(db: DatabaseSync, project: SourceProject, asset: NormalizedEffectAsset, kind: string, assetPath: string | null) {
  if (!assetPath) return;
  const normalized = normalizeAssetPath(assetPath);
  if (!normalized) return;
  db.prepare(
    `INSERT OR IGNORE INTO asset_paths (project_id, asset_id, role_source_id, kind, path, url, exists_on_disk)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    asset.effectAssetId,
    null,
    kind,
    normalized,
    joinPublicUrl(projectAssetBaseUrl(project.id), normalized),
    fs.existsSync(path.join(project.spineAssetsRoot, normalized)) ? 1 : 0,
  );
}

function insertEffectAsset(db: DatabaseSync, project: SourceProject, asset: NormalizedEffectAsset) {
  db.prepare(
    `INSERT INTO effect_assets (
      project_id, effect_asset_id, effect_name, runtime, skeleton_path, json_path,
      atlas_path, pages_json, animations_json, default_animation, bounds_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
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
  addEffectAssetPath(db, project, asset, "effect-skeleton", asset.skeletonPath);
  addEffectAssetPath(db, project, asset, "effect-json", asset.jsonPath);
  addEffectAssetPath(db, project, asset, "effect-atlas", asset.atlasPath);
  for (const page of asset.pages) addEffectAssetPath(db, project, asset, "effect-page", page);
}

function insertBattleProfile(db: DatabaseSync, project: SourceProject, profile: BattleProfile | null) {
  if (!profile) return;
  db.prepare(
    `INSERT INTO project_battle_profiles (
      project_id, default_enemy_role_source_id, default_enemy_asset_id, battle_coord_scale,
      caster_x, caster_y, target_x, target_y, caster_scale, target_scale,
      coordinate_mode, idle_animation, hit_animation, anchor_rules_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
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

function insertRoleAction(db: DatabaseSync, project: SourceProject, action: NormalizedRoleAction) {
  db.prepare(
    `INSERT INTO role_actions (
      project_id, role_source_id, action_id, skill_id, slot, slot_label, action_name,
      label, source_kind, role_animation, script_name, duration_ms, is_primary,
      remark, search_text, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
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
    action.searchText,
    JSON.stringify(action.raw),
  );

  for (const cue of action.actorCues) {
    db.prepare(
      `INSERT INTO action_actor_cues (
        project_id, action_id, cue_index, time_ms, actor_side, animation_name,
        source_anim_code, loop, speed, return_animation, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      action.actionId,
      cue.cueIndex,
      cue.timeMs,
      cue.actorSide,
      cue.animationName,
      cue.sourceAnimCode,
      cue.loop ? 1 : 0,
      cue.speed,
      cue.returnAnimation,
      JSON.stringify(cue.raw),
    );
  }

  for (const cue of action.motionCues) {
    db.prepare(
      `INSERT INTO action_motion_cues (
        project_id, action_id, cue_index, time_ms, subject, motion_type, target_code,
        offset_x, offset_y, duration_ms, easing, flip, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      action.actionId,
      cue.cueIndex,
      cue.timeMs,
      cue.subject,
      cue.motionType,
      cue.targetCode,
      cue.offsetX,
      cue.offsetY,
      cue.durationMs,
      cue.easing,
      cue.flip ? 1 : 0,
      JSON.stringify(cue.raw),
    );
  }

  for (const cue of action.hitCues) {
    db.prepare(
      `INSERT INTO action_hit_cues (
        project_id, action_id, cue_index, time_ms, target_actor_id, target_code,
        hit_index, hit_count, hit_animation, hit_duration_ms, hit_pause_ms,
        time_source, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      action.actionId,
      cue.cueIndex,
      cue.timeMs,
      cue.targetActorId,
      cue.targetCode,
      cue.hitIndex,
      cue.hitCount,
      cue.hitAnimation,
      cue.hitDurationMs,
      cue.hitPauseMs,
      cue.timeSource,
      JSON.stringify(cue.raw),
    );
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
      project.id,
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

function importProject(db: DatabaseSync, project: SourceProject) {
  const catalog = readJson(project.catalogJson);
  const manifest = readJson(project.spineManifestJson);
  const roles = asArray(catalog.roles).map((role) => normalizeRole(project, role)).filter((role) => role.sourceId);
  const roleBySource = new Map(roles.map((role) => [role.sourceId, role]));
  for (const role of roles) {
    if (role.model) roleBySource.set(role.model, role);
  }
  const spineAssets = normalizeSpineAssets(project, manifest, roleBySource);
  const actionEffects = normalizeActionEffects(project, manifest, roleBySource, spineAssets);
  const spineStatsByRole = new Map<string, { hasSpine: boolean; animationCount: number }>();
  for (const asset of spineAssets) {
    if (!asset.roleSourceId) continue;
    const current = spineStatsByRole.get(asset.roleSourceId) || { hasSpine: false, animationCount: 0 };
    current.hasSpine = true;
    current.animationCount += asset.animations.length;
    spineStatsByRole.set(asset.roleSourceId, current);
  }

  copyCatalogImages(project);
  deleteProjectData(db, project.id);
  const iconPath = roles
    .flatMap((role) => role.images)
    .find((image) => ["avatar", "card", "whole", "standby"].includes(image.kind))?.path || null;
  insertProject(db, project, {
    roleCount: roles.length,
    spineRoleCount: new Set(spineAssets.map((asset) => asset.roleSourceId).filter(Boolean)).size,
    animationCount: spineAssets.reduce((sum, asset) => sum + asset.animations.length, 0),
    iconPath,
  });
  for (const role of roles) {
    insertRole(db, project, role, spineStatsByRole.get(role.sourceId) || { hasSpine: false, animationCount: 0 });
  }
  for (const asset of spineAssets) insertSpineAsset(db, project, asset);
  for (const effectAsset of actionEffects.effectAssets) insertEffectAsset(db, project, effectAsset);
  insertBattleProfile(db, project, actionEffects.battleProfile);
  for (const action of actionEffects.actions) insertRoleAction(db, project, action);

  return {
    projectId: project.id,
    roles: roles.length,
    spineAssets: spineAssets.length,
    spineRoles: new Set(spineAssets.map((asset) => asset.roleSourceId).filter(Boolean)).size,
    animations: spineAssets.reduce((sum, asset) => sum + asset.animations.length, 0),
    actions: actionEffects.actions.length,
    effectAssets: actionEffects.effectAssets.length,
    effectCues: actionEffects.actions.reduce((sum, action) => sum + action.effectCues.length, 0),
    catalogImagesBase: joinPublicUrl(projectCatalogBaseUrl(project.id), "images"),
  };
}

function main() {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO import_runs (started_at, status) VALUES (?, ?)").run(startedAt, "running");
  const runId = Number(run.lastInsertRowid);

  try {
    db.exec("BEGIN IMMEDIATE");
    const stats = sourceProjects.map((project) => importProject(db, project));
    db.exec("COMMIT");
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ?, stats_json = ? WHERE id = ?").run(
      new Date().toISOString(),
      "success",
      "Imported projects",
      JSON.stringify(stats),
      runId,
    );
    console.table(stats);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already be closed if the failure happened after COMMIT.
    }
    db.prepare("UPDATE import_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?").run(
      new Date().toISOString(),
      "failed",
      error instanceof Error ? error.message : String(error),
      runId,
    );
    throw error;
  }
}

main();
