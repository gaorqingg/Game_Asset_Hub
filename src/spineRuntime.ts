import * as PIXI from "pixi.js";
import {
  BinaryInput,
  TextureAtlas,
  type IAnimationState,
  type IAnimationStateData,
  type ISkeleton,
  type ISkeletonData,
  type SpineBase,
} from "@pixi-spine/base";
import * as spine37 from "@pixi-spine/runtime-3.7";
import * as spine38 from "@pixi-spine/runtime-3.8";
import * as spine40 from "@pixi-spine/runtime-4.0";
import * as spine41 from "@pixi-spine/runtime-4.1";

export type SpineInstance = SpineBase<ISkeleton, ISkeletonData, IAnimationState, IAnimationStateData>;

export interface SpineLoadableAsset {
  jsonUrl: string | null;
  skeletonUrl: string | null;
  atlasUrl: string | null;
  pageUrls?: string[];
}

export interface SpineResource {
  sourceUrl: string;
  atlasUrl: string;
  spineVersion: string;
  runtimeVersion: RuntimeVersion;
  spineData: ISkeletonData;
  createSpine(): SpineInstance;
}

type RuntimeVersion = "3.7" | "3.8" | "4.0" | "4.1";

interface RuntimeApi {
  Spine: new (spineData: never) => SpineInstance;
  SkeletonJson: new (attachmentLoader: unknown) => { scale: number; readSkeletonData(json: unknown): ISkeletonData };
  SkeletonBinary: new (attachmentLoader: unknown) => { scale: number; readSkeletonData(binary: Uint8Array): ISkeletonData };
  AtlasAttachmentLoader: new (atlas: TextureAtlas) => unknown;
}

const RUNTIMES: Record<RuntimeVersion, RuntimeApi> = {
  "3.7": spine37 as unknown as RuntimeApi,
  "3.8": spine38 as unknown as RuntimeApi,
  "4.0": spine40 as unknown as RuntimeApi,
  "4.1": spine41 as unknown as RuntimeApi,
};

function browserBaseUrl() {
  return typeof window !== "undefined" && window.location?.href ? window.location.href : "http://localhost/";
}

function toUrl(value: string, base = browserBaseUrl()) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function urlPath(value: string) {
  const parsed = toUrl(value);
  return parsed ? parsed.pathname : value.split(/[?#]/)[0];
}

function extensionFromUrl(value: string) {
  const match = urlPath(value).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function decodePathPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedPath(value: string) {
  return decodePathPart(urlPath(value).replace(/\\/g, "/")).toLowerCase();
}

function fileName(value: string) {
  const path = normalizedPath(value);
  return path.slice(path.lastIndexOf("/") + 1);
}

function replaceExtension(url: string, extension: string) {
  const parsed = toUrl(url);
  if (parsed) {
    parsed.pathname = parsed.pathname.replace(/\.[^/.]+$/, `.${extension}`);
    return parsed.toString();
  }
  return url.replace(/\.[^/.?#]+(?=([?#]|$))/, `.${extension}`);
}

function detectSpineVersion(version: string): RuntimeVersion {
  const prefix = version.slice(0, 3);
  if (prefix === "4.1") return "4.1";
  if (prefix === "4.0") return "4.0";
  if (prefix === "3.8") return "3.8";
  if (prefix === "3.7") return "3.7";
  const versionNumber = Math.floor(Number(prefix) * 10 + 0.001);
  if (Number.isFinite(versionNumber) && versionNumber < 37) return "3.7";
  throw new Error(`Unsupported Spine version: ${version || "unknown"}`);
}

function isVersionPrefix(version: string, ...prefixes: string[]) {
  return prefixes.some((prefix) => version.startsWith(prefix));
}

function readOldBinaryVersion(bytes: Uint8Array) {
  const input = new BinaryInput(bytes);
  try {
    input.readString();
    return input.readString() || "";
  } catch {
    return "";
  }
}

function readNewBinaryVersion(bytes: Uint8Array) {
  const input = new BinaryInput(bytes);
  try {
    input.readInt32();
    input.readInt32();
    return input.readString() || "";
  } catch {
    return "";
  }
}

function detectBinaryVersion(bytes: Uint8Array) {
  const oldVersion = readOldBinaryVersion(bytes);
  if (isVersionPrefix(oldVersion, "3.7", "3.8")) return oldVersion;
  const newVersion = readNewBinaryVersion(bytes);
  return newVersion || oldVersion;
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

function pageUrlFor(pageName: string, atlasUrl: string, pageUrls: string[]) {
  const pageFile = fileName(pageName);
  const exactPath = normalizedPath(pageName);
  const matched = pageUrls.find((url) => normalizedPath(url).endsWith(exactPath))
    || pageUrls.find((url) => fileName(url) === pageFile);
  if (matched) return matched;
  const parsed = toUrl(pageName, atlasUrl);
  return parsed ? parsed.toString() : pageName;
}

async function loadPageBaseTexture(pageName: string, atlasUrl: string, pageUrls: string[]) {
  const pageUrl = pageUrlFor(pageName, atlasUrl, pageUrls);
  const texture = await PIXI.Assets.load<PIXI.Texture>(pageUrl);
  if (texture instanceof PIXI.Texture) return texture.baseTexture;
  const maybeTexture = texture as { baseTexture?: PIXI.BaseTexture };
  if (maybeTexture.baseTexture) return maybeTexture.baseTexture;
  throw new Error(`Failed to load atlas page texture: ${pageUrl}`);
}

async function loadTextureAtlas(atlasUrl: string, atlasText: string, pageUrls: string[]) {
  return new Promise<TextureAtlas>((resolve, reject) => {
    let atlas: TextureAtlas | null = null;
    atlas = new TextureAtlas(
      atlasText,
      (pageName, done) => {
        loadPageBaseTexture(pageName, atlasUrl, pageUrls)
          .then((baseTexture) => done(baseTexture))
          .catch((error) => {
            console.error("Spine atlas page load failed", error);
            done(null as unknown as PIXI.BaseTexture);
          });
      },
      (loadedAtlas) => {
        if (!loadedAtlas || !atlas) {
          reject(new Error(`Failed to load Spine atlas: ${atlasUrl}`));
          return;
        }
        resolve(atlas);
      },
    );
  });
}

function jsonSpineVersion(json: unknown) {
  const skeleton = json && typeof json === "object" && !Array.isArray(json) ? (json as { skeleton?: unknown }).skeleton : null;
  const spine = skeleton && typeof skeleton === "object" && !Array.isArray(skeleton) ? (skeleton as { spine?: unknown }).spine : null;
  return typeof spine === "string" ? spine : "";
}

function sourceUrlFor(asset: SpineLoadableAsset) {
  return asset.jsonUrl || asset.skeletonUrl || "";
}

export function hasSpineSource(asset: Pick<SpineLoadableAsset, "jsonUrl" | "skeletonUrl"> | null | undefined) {
  return Boolean(asset?.jsonUrl || asset?.skeletonUrl);
}

export async function loadSpineResource(asset: SpineLoadableAsset | null | undefined): Promise<SpineResource> {
  if (!asset) throw new Error("Missing Spine asset");
  const sourceUrl = sourceUrlFor(asset);
  if (!sourceUrl) throw new Error("Missing loadable Spine JSON/SKEL source");

  const atlasUrl = asset.atlasUrl || replaceExtension(sourceUrl, "atlas");
  const [atlasText, skeletonInput] = await Promise.all([
    fetchText(atlasUrl),
    extensionFromUrl(sourceUrl) === "skel" ? fetchBytes(sourceUrl) : fetchJson(sourceUrl),
  ]);
  const atlas = await loadTextureAtlas(atlasUrl, atlasText, asset.pageUrls || []);

  const isBinary = skeletonInput instanceof Uint8Array;
  const spineVersion = isBinary ? detectBinaryVersion(skeletonInput) : jsonSpineVersion(skeletonInput);
  if (!spineVersion) throw new Error(`Unable to detect Spine version: ${sourceUrl}`);
  const runtimeVersion = detectSpineVersion(spineVersion);
  const runtime = RUNTIMES[runtimeVersion];
  const attachmentLoader = new runtime.AtlasAttachmentLoader(atlas);
  const parser = isBinary ? new runtime.SkeletonBinary(attachmentLoader) : new runtime.SkeletonJson(attachmentLoader);
  const spineData = isBinary ? parser.readSkeletonData(skeletonInput) : parser.readSkeletonData(skeletonInput);

  return {
    sourceUrl,
    atlasUrl,
    spineVersion,
    runtimeVersion,
    spineData,
    createSpine: () => new runtime.Spine(spineData as never),
  };
}
