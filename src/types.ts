export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  tags: string[];
  iconPath: string | null;
  iconUrl: string | null;
  runtime: string;
  assetBaseUrl: string;
  catalogBaseUrl: string;
  roleCount: number;
  spineRoleCount: number;
  animationCount: number;
  updatedAt: string;
}

export interface RoleSummary {
  id: number;
  projectId: string;
  sourceId: string;
  displayName: string;
  fallbackName: string;
  model: string | null;
  career: string;
  rarity: string;
  category: string;
  source: string;
  dataQuality: string[];
  hasSpine: boolean;
  animationCount: number;
  avatarUrl: string | null;
}

export interface RoleImage {
  kind: string;
  path: string;
  sourcePath: string | null;
  url: string;
}

export interface Skill {
  sourceId: string;
  slot: string | null;
  slotLabel: string | null;
  name: string;
  iconUrl: string | null;
  summary: string;
  description: string;
}

export interface SpineAssetSummary {
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
  skeletonUrl: string | null;
  jsonUrl: string | null;
  atlasUrl: string | null;
  pageUrls: string[];
}

export interface RoleDetail extends Omit<RoleSummary, "avatarUrl"> {
  images: RoleImage[];
  skills: Skill[];
  spineAssets: SpineAssetSummary[];
  raw: unknown;
}

export interface RolePage {
  project: Project;
  filters: {
    careers: FilterOption[];
    rarities: FilterOption[];
    categories: FilterOption[];
    sources: FilterOption[];
  };
  page: number;
  pageSize: number;
  total: number;
  roles: RoleSummary[];
}

export interface FilterOption {
  value: string;
  count: number;
}

export interface AnimationEntry {
  name: string;
  duration: number | null;
  frameRate: number | null;
  isDefault: boolean;
}

export interface AnimationAsset {
  assetId: string;
  name: string;
  runtime: string;
  animations: AnimationEntry[];
}

export interface AnimationRole {
  roleSourceId: string;
  displayName: string;
  fallbackName: string;
  model: string | null;
  runtime: string;
  assets: AnimationAsset[];
}

export interface SpineAssetResponse {
  project: Project;
  asset: SpineAssetSummary & {
    animations: AnimationEntry[];
  };
}

export interface RoleActionSummary {
  id: number;
  projectId: string;
  roleSourceId: string;
  roleName: string;
  roleModel: string | null;
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
  effectCount: number;
  hitCount: number;
}

export interface EffectAssetSummary {
  effectAssetId: string;
  effectName: string;
  runtime: string;
  skeletonPath: string | null;
  jsonPath: string | null;
  atlasPath: string | null;
  pages: string[];
  animations: string[];
  defaultAnimation: string | null;
  bounds: unknown;
  skeletonUrl: string | null;
  jsonUrl: string | null;
  atlasUrl: string | null;
  pageUrls: string[];
}

export interface BattleProfile {
  projectId: string;
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
  anchorRules: unknown;
}

export interface ActionActorCue {
  cueIndex: number;
  timeMs: number;
  actorSide: "caster" | "target" | string;
  animationName: string;
  sourceAnimCode: string | null;
  loop: boolean;
  speed: number;
  returnAnimation: string | null;
}

export interface ActionMotionCue {
  cueIndex: number;
  timeMs: number;
  subject: "caster" | "target" | string;
  motionType: string;
  targetCode: string | null;
  offsetX: number;
  offsetY: number;
  durationMs: number;
  easing: string | null;
  flip: boolean;
}

export interface ActionHitCue {
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
}

export interface ActionEffectCue {
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
}

export interface ActionTimelineResponse {
  project: Project | null;
  action: RoleActionSummary;
  caster: {
    roleSourceId: string;
    asset: SpineAssetSummary | null;
  };
  target: {
    roleSourceId: string | null;
    asset: SpineAssetSummary | null;
  };
  battleProfile: BattleProfile | null;
  actorCues: ActionActorCue[];
  motionCues: ActionMotionCue[];
  hitCues: ActionHitCue[];
  effectCues: ActionEffectCue[];
  effectAssets: EffectAssetSummary[];
  warnings: string[];
}
