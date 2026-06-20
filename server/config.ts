import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProjectRuntime = "pixi-spine-3.8" | "pixi-spine-4.0" | "pixi-spine-4.1" | "spine-webgl-3.6";

export interface SourceProject {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  tags: string[];
  runtime: ProjectRuntime;
  catalogJson: string;
  catalogPublicRoot: string;
  spineManifestJson: string;
  spineAssetsRoot: string;
  defaultIcon?: string;
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(serverDir, "..");
export const dataDir = path.join(repoRoot, "data");
export const databasePath = path.join(dataDir, "asset-hub.sqlite");
export const hubPublicRoot = path.join(repoRoot, "public", "hub");
export const projectPublicRoot = path.join(hubPublicRoot, "projects");
export const defaultPublicOrigin = process.env.ASSET_HUB_PUBLIC_ORIGIN || "http://192.168.0.9";
export const defaultWwwRoot = process.env.ASSET_HUB_WWWROOT || "\\\\192.168.0.9\\wwwroot";

const projectRoot = (name: string) => path.resolve("H:/game_assets_rebuild", name);

export const sourceProjects: SourceProject[] = [
  {
    id: "3029",
    name: "火影忍者 OL",
    rootPath: projectRoot("3029_huoying_OL"),
    createdAt: "2026-05-13T17:11:38+08:00",
    tags: ["角色", "动画", "Spine 3.8", "页游"],
    runtime: "pixi-spine-3.8",
    catalogJson: path.join(projectRoot("3029_huoying_OL"), "web-character-catalog/public/catalog/roles.json"),
    catalogPublicRoot: path.join(projectRoot("3029_huoying_OL"), "web-character-catalog/public/catalog"),
    spineManifestJson: path.join(projectRoot("3029_huoying_OL"), "web-spine-demo/public/assets/manifest.json"),
    spineAssetsRoot: path.join(projectRoot("3029_huoying_OL"), "web-spine-demo/public/assets"),
  },
  {
    id: "3017",
    name: "火影忍界传说",
    rootPath: projectRoot("3017_huoying_renjiechuanshuo"),
    createdAt: "2026-05-27T10:01:36+08:00",
    tags: ["角色", "动画", "Spine 3.6", "手游"],
    runtime: "spine-webgl-3.6",
    catalogJson: path.join(projectRoot("3017_huoying_renjiechuanshuo"), "web-character-catalog/public/catalog/roles.json"),
    catalogPublicRoot: path.join(projectRoot("3017_huoying_renjiechuanshuo"), "web-character-catalog/public/catalog"),
    spineManifestJson: path.join(projectRoot("3017_huoying_renjiechuanshuo"), "web-spine-demo/public/assets/manifest.json"),
    spineAssetsRoot: path.join(projectRoot("3017_huoying_renjiechuanshuo"), "web-spine-demo/public/assets"),
  },
  {
    id: "3021",
    name: "火影木叶高手",
    rootPath: projectRoot("3021_huoying_muyegaoshou"),
    createdAt: "2026-05-11T16:22:37+08:00",
    tags: ["角色", "动画", "Spine 3.8", "手游"],
    runtime: "pixi-spine-3.8",
    catalogJson: path.join(projectRoot("3021_huoying_muyegaoshou"), "web-character-catalog/public/catalog/roles.json"),
    catalogPublicRoot: path.join(projectRoot("3021_huoying_muyegaoshou"), "web-character-catalog/public/catalog"),
    spineManifestJson: path.join(projectRoot("3021_huoying_muyegaoshou"), "web-spine-demo/public/assets/manifest.json"),
    spineAssetsRoot: path.join(projectRoot("3021_huoying_muyegaoshou"), "web-spine-demo/public/assets"),
  },
];

export function projectById(projectId: string): SourceProject | undefined {
  return sourceProjects.find((project) => project.id === projectId);
}

export function normalizeAssetPath(assetPath: string | null | undefined): string {
  return String(assetPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^assets\//, "");
}

function projectEnvPrefix(projectId: string): string {
  return projectId.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

export function joinPublicUrl(baseUrl: string, assetPath: string | null | undefined): string {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const normalized = String(assetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized ? `${base}/${normalized}` : base;
}

export function projectAssetBaseUrl(projectId: string): string {
  const override = process.env[`PROJECT_${projectEnvPrefix(projectId)}_ASSET_BASE_URL`];
  return override || joinPublicUrl(defaultPublicOrigin, `${encodeURIComponent(projectId)}/assets`);
}

export function projectCatalogBaseUrl(projectId: string): string {
  const override = process.env[`PROJECT_${projectEnvPrefix(projectId)}_CATALOG_BASE_URL`];
  return override || joinPublicUrl(defaultPublicOrigin, `${encodeURIComponent(projectId)}/catalog`);
}

export function externalAssetUrl(projectId: string, assetPath: string | null | undefined): string {
  const normalized = normalizeAssetPath(assetPath);
  return normalized ? joinPublicUrl(projectAssetBaseUrl(projectId), normalized) : "";
}

export function hubImageUrl(projectId: string, imagePath: string | null | undefined): string {
  const normalized = String(imagePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized ? joinPublicUrl(projectCatalogBaseUrl(projectId), normalized) : "";
}
