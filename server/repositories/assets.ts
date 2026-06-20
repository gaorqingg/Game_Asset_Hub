import type { DatabaseSync } from "node:sqlite";
import { joinPublicUrl, projectAssetBaseUrl, projectCatalogBaseUrl } from "../config.js";

type Row = Record<string, unknown>;
const CUTIN_ASSET_SQL = "(lower(coalesce(s.json_path, '')) LIKE 'spine/cutins/%' OR lower(coalesce(s.skeleton_path, '')) LIKE 'spine/cutins/%')";

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

function likeQuery(query: string): string {
  return `%${query.trim().toLowerCase()}%`;
}

function projectIdFromRow(row: Row) {
  return String(row.project_id || row.id || "");
}

function assetBaseUrlFromRow(row: Row) {
  const projectId = projectIdFromRow(row);
  return row.asset_base_url ? String(row.asset_base_url) : projectAssetBaseUrl(projectId);
}

function catalogBaseUrlFromRow(row: Row) {
  const projectId = projectIdFromRow(row);
  return row.catalog_base_url ? String(row.catalog_base_url) : projectCatalogBaseUrl(projectId);
}

function assetUrl(row: Row, assetPath: string | null | undefined): string | null {
  return assetPath ? joinPublicUrl(assetBaseUrlFromRow(row), assetPath) : null;
}

function catalogUrl(baseUrl: string, imagePath: string | null | undefined): string | null {
  return imagePath ? joinPublicUrl(baseUrl, imagePath) : null;
}

function projectFromRow(row: Row) {
  const id = String(row.id);
  const catalogBaseUrl = catalogBaseUrlFromRow(row);
  return {
    id,
    name: String(row.name),
    rootPath: String(row.root_path),
    createdAt: String(row.created_at),
    tags: parseJson<string[]>(row.tags_json, []),
    iconPath: row.icon_path ? String(row.icon_path) : null,
    iconUrl: catalogUrl(catalogBaseUrl, row.icon_path ? String(row.icon_path) : null),
    runtime: String(row.runtime),
    assetBaseUrl: row.asset_base_url ? String(row.asset_base_url) : projectAssetBaseUrl(id),
    catalogBaseUrl,
    roleCount: Number(row.role_count || 0),
    spineRoleCount: Number(row.spine_role_count || 0),
    animationCount: Number(row.animation_count || 0),
    updatedAt: String(row.updated_at),
  };
}

function roleFromRow(row: Row) {
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    sourceId: String(row.source_id),
    displayName: String(row.display_name),
    fallbackName: String(row.fallback_name),
    model: row.model ? String(row.model) : null,
    career: row.career ? String(row.career) : "未配置",
    rarity: row.rarity ? String(row.rarity) : "未配置",
    category: row.category ? String(row.category) : "未配置",
    source: row.source ? String(row.source) : "未配置",
    dataQuality: parseJson<string[]>(row.data_quality, []),
    hasSpine: Boolean(row.has_spine),
    animationCount: Number(row.animation_count || 0),
  };
}

function assetFromRow(row: Row) {
  const pages = parseJson<string[]>(row.pages_json, []);
  return {
    assetId: String(row.asset_id),
    sourceAssetId: String(row.source_asset_id),
    roleSourceId: row.role_source_id ? String(row.role_source_id) : null,
    runtime: String(row.runtime),
    name: String(row.name),
    skeletonPath: row.skeleton_path ? String(row.skeleton_path) : null,
    jsonPath: row.json_path ? String(row.json_path) : null,
    atlasPath: row.atlas_path ? String(row.atlas_path) : null,
    pages,
    version: row.version ? String(row.version) : null,
    skeletonUrl: assetUrl(row, row.skeleton_path ? String(row.skeleton_path) : null),
    jsonUrl: assetUrl(row, row.json_path ? String(row.json_path) : null),
    atlasUrl: assetUrl(row, row.atlas_path ? String(row.atlas_path) : null),
    pageUrls: pages.map((page) => joinPublicUrl(assetBaseUrlFromRow(row), page)),
  };
}

function effectAssetFromRow(row: Row) {
  const pages = parseJson<string[]>(row.pages_json, []);
  const animations = parseJson<string[]>(row.animations_json, []);
  return {
    effectAssetId: String(row.effect_asset_id),
    effectName: String(row.effect_name),
    runtime: String(row.runtime),
    skeletonPath: row.skeleton_path ? String(row.skeleton_path) : null,
    jsonPath: row.json_path ? String(row.json_path) : null,
    atlasPath: row.atlas_path ? String(row.atlas_path) : null,
    pages,
    animations,
    defaultAnimation: row.default_animation ? String(row.default_animation) : null,
    bounds: parseJson(row.bounds_json, {}),
    skeletonUrl: assetUrl(row, row.skeleton_path ? String(row.skeleton_path) : null),
    jsonUrl: assetUrl(row, row.json_path ? String(row.json_path) : null),
    atlasUrl: assetUrl(row, row.atlas_path ? String(row.atlas_path) : null),
    pageUrls: pages.map((page) => joinPublicUrl(assetBaseUrlFromRow(row), page)),
  };
}

function actionFromRow(row: Row) {
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    roleSourceId: String(row.role_source_id),
    actionId: String(row.action_id),
    skillId: row.skill_id ? String(row.skill_id) : null,
    slot: row.slot ? String(row.slot) : null,
    slotLabel: row.slot_label ? String(row.slot_label) : null,
    actionName: String(row.action_name),
    label: String(row.label),
    sourceKind: String(row.source_kind),
    roleAnimation: row.role_animation ? String(row.role_animation) : null,
    scriptName: row.script_name ? String(row.script_name) : null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    isPrimary: Boolean(row.is_primary),
    remark: row.remark ? String(row.remark) : null,
  };
}

function battleProfileFromRow(row: Row | undefined) {
  if (!row) return null;
  return {
    projectId: String(row.project_id),
    defaultEnemyRoleSourceId: row.default_enemy_role_source_id ? String(row.default_enemy_role_source_id) : null,
    defaultEnemyAssetId: row.default_enemy_asset_id ? String(row.default_enemy_asset_id) : null,
    battleCoordScale: Number(row.battle_coord_scale || 1),
    casterX: Number(row.caster_x || -260),
    casterY: Number(row.caster_y || 0),
    targetX: Number(row.target_x || 260),
    targetY: Number(row.target_y || 0),
    casterScale: Number(row.caster_scale || 0.45),
    targetScale: Number(row.target_scale || 0.45),
    coordinateMode: String(row.coordinate_mode || "custom"),
    idleAnimation: String(row.idle_animation || "idle"),
    hitAnimation: String(row.hit_animation || "Hit01"),
    anchorRules: parseJson(row.anchor_rules_json, {}),
  };
}

export interface RoleQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  career?: string;
  rarity?: string;
  category?: string;
  source?: string;
  hasSpine?: string;
}

type SqlParam = string | number | null;

export class AssetRepository {
  constructor(private readonly db: DatabaseSync) {}

  listProjects(query = "") {
    const trimmed = query.trim();
    const rows = trimmed
      ? this.db
          .prepare(
            `SELECT * FROM projects
             WHERE lower(name || ' ' || tags_json || ' ' || id) LIKE ?
             ORDER BY datetime(created_at) DESC`,
          )
          .all(likeQuery(trimmed))
      : this.db.prepare("SELECT * FROM projects ORDER BY datetime(created_at) DESC").all();
    return rows.map(projectFromRow);
  }

  getProject(projectId: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | undefined;
    return row ? projectFromRow(row) : null;
  }

  listRoleFilters(projectId: string) {
    const collect = (column: string) =>
      this.db
        .prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM roles WHERE project_id = ? AND ${column} IS NOT NULL AND ${column} != '' GROUP BY ${column} ORDER BY count DESC, value ASC`)
        .all(projectId)
        .map((row) => ({ value: String((row as Row).value), count: Number((row as Row).count) }));
    return {
      careers: collect("career"),
      rarities: collect("rarity"),
      categories: collect("category"),
      sources: collect("source"),
    };
  }

  listRoles(projectId: string, query: RoleQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(96, Math.max(12, Number(query.pageSize || 48)));
    const offset = (page - 1) * pageSize;
    const where = ["r.project_id = ?"];
    const params: SqlParam[] = [projectId];
    let join = "";

    if (query.q?.trim()) {
      const fts = buildFtsQuery(query.q);
      join = "JOIN roles_fts ON roles_fts.rowid = r.id";
      where.push("roles_fts MATCH ?");
      params.push(fts);
    }

    for (const [column, value] of [
      ["career", query.career],
      ["rarity", query.rarity],
      ["category", query.category],
      ["source", query.source],
    ] as const) {
      if (value) {
        where.push(`r.${column} = ?`);
        params.push(value);
      }
    }

    if (query.hasSpine === "1" || query.hasSpine === "true") {
      where.push("r.has_spine = 1");
    }

    const whereSql = where.join(" AND ");
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM roles r ${join} WHERE ${whereSql}`)
      .get(...params) as Row;
    const rows = this.db
      .prepare(
        `SELECT r.*,
          (SELECT path FROM role_images img WHERE img.project_id = r.project_id AND img.role_source_id = r.source_id AND img.kind IN ('avatar', 'head') ORDER BY CASE img.kind WHEN 'avatar' THEN 0 ELSE 1 END LIMIT 1) AS avatar_path
         FROM roles r
         ${join}
         WHERE ${whereSql}
         ORDER BY r.has_spine DESC, r.display_name ASC, r.source_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as Row[];
    const project = this.getProject(projectId);
    const catalogBaseUrl = project?.catalogBaseUrl || projectCatalogBaseUrl(projectId);

    return {
      page,
      pageSize,
      total: Number(countRow.count || 0),
      roles: rows.map((row) => ({
        ...roleFromRow(row),
        avatarUrl: catalogUrl(catalogBaseUrl, row.avatar_path ? String(row.avatar_path) : null),
      })),
    };
  }

  getRoleDetail(projectId: string, roleSourceId: string) {
    const row = this.db
      .prepare("SELECT * FROM roles WHERE project_id = ? AND source_id = ?")
      .get(projectId, roleSourceId) as Row | undefined;
    if (!row) return null;
    const role = roleFromRow(row);
    const imageRows = this.db
      .prepare("SELECT kind, path, source_path FROM role_images WHERE project_id = ? AND role_source_id = ? ORDER BY kind")
      .all(projectId, roleSourceId) as Row[];
    const skillRows = this.db
      .prepare("SELECT * FROM skills WHERE project_id = ? AND role_source_id = ? ORDER BY id")
      .all(projectId, roleSourceId) as Row[];
    const assetRows = this.db
      .prepare(
        `SELECT s.*, p.asset_base_url
         FROM spine_assets s
         JOIN projects p ON p.id = s.project_id
         WHERE s.project_id = ? AND s.role_source_id = ?
           AND NOT ${CUTIN_ASSET_SQL}
         ORDER BY s.name`,
      )
      .all(projectId, roleSourceId) as Row[];
    const project = this.getProject(projectId);
    const catalogBaseUrl = project?.catalogBaseUrl || projectCatalogBaseUrl(projectId);

    return {
      ...role,
      images: imageRows.map((img) => ({
        kind: String(img.kind),
        path: String(img.path),
        sourcePath: img.source_path ? String(img.source_path) : null,
        url: joinPublicUrl(catalogBaseUrl, String(img.path)),
      })),
      skills: skillRows.map((skill) => ({
        sourceId: String(skill.source_id),
        slot: skill.slot ? String(skill.slot) : null,
        slotLabel: skill.slot_label ? String(skill.slot_label) : null,
        name: String(skill.name),
        iconUrl: catalogUrl(catalogBaseUrl, skill.icon_path ? String(skill.icon_path) : null),
        summary: skill.summary ? String(skill.summary) : "",
        description: skill.description ? String(skill.description) : "",
      })),
      spineAssets: assetRows.map(assetFromRow),
      raw: parseJson(row.raw_json, {}),
    };
  }

  listAnimations(projectId: string, query = "") {
    const trimmed = query.trim();
    const where = ["a.project_id = ?"];
    const params: SqlParam[] = [projectId];
    let join = "";
    if (trimmed) {
      join = "JOIN animations_fts ON animations_fts.rowid = a.id";
      where.push("animations_fts MATCH ?");
      params.push(buildFtsQuery(trimmed));
    }
    where.push(`NOT ${CUTIN_ASSET_SQL}`);
    const rows = this.db
      .prepare(
        `SELECT a.*, r.display_name, r.fallback_name, r.model, s.name AS asset_name, s.runtime
         FROM animations a
         ${join}
         LEFT JOIN roles r ON r.project_id = a.project_id AND r.source_id = a.role_source_id
         LEFT JOIN spine_assets s ON s.project_id = a.project_id AND s.asset_id = a.asset_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.display_name ASC, s.name ASC, a.is_default DESC, a.name ASC`,
      )
      .all(...params) as Row[];

    const byRole = new Map<string, {
      roleSourceId: string;
      displayName: string;
      fallbackName: string;
      model: string | null;
      runtime: string;
      assets: Map<string, { assetId: string; name: string; runtime: string; animations: unknown[] }>;
    }>();

    for (const row of rows) {
      const roleSourceId = String(row.role_source_id || row.asset_id);
      if (!byRole.has(roleSourceId)) {
        byRole.set(roleSourceId, {
          roleSourceId,
          displayName: String(row.display_name || row.fallback_name || row.model || roleSourceId),
          fallbackName: String(row.fallback_name || roleSourceId),
          model: row.model ? String(row.model) : null,
          runtime: String(row.runtime || ""),
          assets: new Map(),
        });
      }
      const group = byRole.get(roleSourceId)!;
      const assetId = String(row.asset_id);
      if (!group.assets.has(assetId)) {
        group.assets.set(assetId, {
          assetId,
          name: String(row.asset_name || assetId),
          runtime: String(row.runtime || group.runtime),
          animations: [],
        });
      }
      group.assets.get(assetId)!.animations.push({
        name: String(row.name),
        duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
        frameRate: row.frame_rate === null || row.frame_rate === undefined ? null : Number(row.frame_rate),
        isDefault: Boolean(row.is_default),
      });
    }

    return [...byRole.values()].map((role) => ({
      ...role,
      assets: [...role.assets.values()],
    }));
  }

  listCutins(projectId: string, query = "") {
    const trimmed = query.trim();
    const where = ["a.project_id = ?", CUTIN_ASSET_SQL];
    const params: SqlParam[] = [projectId];
    let join = "";
    if (trimmed) {
      join = "JOIN animations_fts ON animations_fts.rowid = a.id";
      where.push("animations_fts MATCH ?");
      params.push(buildFtsQuery(trimmed));
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, r.display_name, r.fallback_name, r.model, s.name AS asset_name, s.runtime
         FROM animations a
         ${join}
         JOIN spine_assets s ON s.project_id = a.project_id AND s.asset_id = a.asset_id
         LEFT JOIN roles r ON r.project_id = a.project_id AND r.source_id = a.role_source_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.display_name ASC, s.name ASC, a.is_default DESC, a.name ASC`,
      )
      .all(...params) as Row[];

    const byRole = new Map<string, {
      roleSourceId: string;
      displayName: string;
      fallbackName: string;
      model: string | null;
      runtime: string;
      assets: Map<string, { assetId: string; name: string; runtime: string; animations: unknown[] }>;
    }>();

    for (const row of rows) {
      const roleSourceId = String(row.role_source_id || row.asset_id);
      if (!byRole.has(roleSourceId)) {
        byRole.set(roleSourceId, {
          roleSourceId,
          displayName: String(row.display_name || row.fallback_name || row.model || roleSourceId),
          fallbackName: String(row.fallback_name || roleSourceId),
          model: row.model ? String(row.model) : null,
          runtime: String(row.runtime || ""),
          assets: new Map(),
        });
      }
      const group = byRole.get(roleSourceId)!;
      const assetId = String(row.asset_id);
      if (!group.assets.has(assetId)) {
        group.assets.set(assetId, {
          assetId,
          name: String(row.asset_name || assetId),
          runtime: String(row.runtime || group.runtime),
          animations: [],
        });
      }
      group.assets.get(assetId)!.animations.push({
        name: String(row.name),
        duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
        frameRate: row.frame_rate === null || row.frame_rate === undefined ? null : Number(row.frame_rate),
        isDefault: Boolean(row.is_default),
      });
    }

    return [...byRole.values()].map((role) => ({
      ...role,
      assets: [...role.assets.values()],
    }));
  }

  getSpineAsset(projectId: string, assetId: string) {
    const row = this.db
      .prepare(
        `SELECT s.*, p.asset_base_url
         FROM spine_assets s
         JOIN projects p ON p.id = s.project_id
         WHERE s.project_id = ? AND s.asset_id = ?`,
      )
      .get(projectId, assetId) as Row | undefined;
    if (!row) return null;
    const animations = this.db
      .prepare("SELECT name, duration, frame_rate, is_default FROM animations WHERE project_id = ? AND asset_id = ? ORDER BY is_default DESC, name ASC")
      .all(projectId, assetId) as Row[];
    const project = this.getProject(projectId);
    return {
      project,
      asset: {
        ...assetFromRow(row),
        animations: animations.map((animation) => ({
          name: String(animation.name),
          duration: animation.duration === null || animation.duration === undefined ? null : Number(animation.duration),
          frameRate: animation.frame_rate === null || animation.frame_rate === undefined ? null : Number(animation.frame_rate),
          isDefault: Boolean(animation.is_default),
        })),
      },
    };
  }

  listActions(projectId: string, roleId = "", query = "") {
    const where = ["a.project_id = ?"];
    const params: SqlParam[] = [projectId];
    if (roleId) {
      where.push("a.role_source_id = ?");
      params.push(roleId);
    }
    if (query.trim()) {
      where.push("lower(a.search_text) LIKE ?");
      params.push(likeQuery(query));
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, r.display_name, r.fallback_name, r.model,
          (SELECT COUNT(*) FROM action_effect_cues e WHERE e.project_id = a.project_id AND e.action_id = a.action_id) AS effect_count,
          (SELECT COUNT(*) FROM action_hit_cues h WHERE h.project_id = a.project_id AND h.action_id = a.action_id) AS hit_count
         FROM role_actions a
         LEFT JOIN roles r ON r.project_id = a.project_id AND r.source_id = a.role_source_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.display_name ASC, a.is_primary DESC, a.slot ASC, a.label ASC`,
      )
      .all(...params) as Row[];
    return rows.map((row) => ({
      ...actionFromRow(row),
      roleName: String(row.display_name || row.fallback_name || row.model || row.role_source_id),
      roleModel: row.model ? String(row.model) : null,
      effectCount: Number(row.effect_count || 0),
      hitCount: Number(row.hit_count || 0),
    }));
  }

  getBattleProfile(projectId: string) {
    return battleProfileFromRow(
      this.db.prepare("SELECT * FROM project_battle_profiles WHERE project_id = ?").get(projectId) as Row | undefined,
    );
  }

  private getSpineAssetForRole(projectId: string, roleSourceId: string | null | undefined) {
    if (!roleSourceId) return null;
    const row = this.db
      .prepare(
        `SELECT s.*, p.asset_base_url
         FROM spine_assets s
         JOIN projects p ON p.id = s.project_id
         WHERE s.project_id = ? AND (s.role_source_id = ? OR s.asset_id = ? OR s.source_asset_id = ?)
         ORDER BY CASE WHEN s.role_source_id = ? THEN 0 ELSE 1 END, s.name ASC
         LIMIT 1`,
      )
      .get(projectId, roleSourceId, roleSourceId, roleSourceId, roleSourceId) as Row | undefined;
    return row ? assetFromRow(row) : null;
  }

  getActionTimeline(projectId: string, actionId: string) {
    const actionRow = this.db
      .prepare("SELECT * FROM role_actions WHERE project_id = ? AND action_id = ?")
      .get(projectId, actionId) as Row | undefined;
    if (!actionRow) return null;

    const action = actionFromRow(actionRow);
    const project = this.getProject(projectId);
    const profile = this.getBattleProfile(projectId);
    const warnings: string[] = [];
    const casterAsset = this.getSpineAssetForRole(projectId, action.roleSourceId);
    if (!casterAsset) warnings.push(`missing-caster:${action.roleSourceId}`);
    const targetAsset = this.getSpineAssetForRole(projectId, profile?.defaultEnemyAssetId || profile?.defaultEnemyRoleSourceId || null);
    if (!targetAsset && profile) warnings.push(`missing-default-enemy:${profile.defaultEnemyRoleSourceId || profile.defaultEnemyAssetId}`);

    const actorCues = this.db
      .prepare("SELECT * FROM action_actor_cues WHERE project_id = ? AND action_id = ? ORDER BY time_ms ASC, cue_index ASC")
      .all(projectId, actionId) as Row[];
    const motionCues = this.db
      .prepare("SELECT * FROM action_motion_cues WHERE project_id = ? AND action_id = ? ORDER BY time_ms ASC, cue_index ASC")
      .all(projectId, actionId) as Row[];
    const hitCues = this.db
      .prepare("SELECT * FROM action_hit_cues WHERE project_id = ? AND action_id = ? ORDER BY time_ms ASC, cue_index ASC")
      .all(projectId, actionId) as Row[];
    const effectCueRows = this.db
      .prepare("SELECT * FROM action_effect_cues WHERE project_id = ? AND action_id = ? ORDER BY time_ms ASC, cue_index ASC")
      .all(projectId, actionId) as Row[];
    const effectIds = [...new Set(effectCueRows.map((row) => String(row.effect_asset_id)))];
    const effectAssets = effectIds.map((effectId) => {
      const row = this.db
        .prepare(
          `SELECT e.*, p.asset_base_url
           FROM effect_assets e
           JOIN projects p ON p.id = e.project_id
           WHERE e.project_id = ? AND e.effect_asset_id = ?`,
        )
        .get(projectId, effectId) as Row | undefined;
      if (!row) warnings.push(`missing-effect:${effectId}`);
      return row ? effectAssetFromRow(row) : null;
    }).filter(Boolean);

    return {
      project,
      action,
      caster: {
        roleSourceId: action.roleSourceId,
        asset: casterAsset,
      },
      target: {
        roleSourceId: profile?.defaultEnemyRoleSourceId || targetAsset?.roleSourceId || null,
        asset: targetAsset,
      },
      battleProfile: profile,
      actorCues: actorCues.map((cue) => ({
        cueIndex: Number(cue.cue_index),
        timeMs: Number(cue.time_ms || 0),
        actorSide: String(cue.actor_side),
        animationName: String(cue.animation_name),
        sourceAnimCode: cue.source_anim_code ? String(cue.source_anim_code) : null,
        loop: Boolean(cue.loop),
        speed: Number(cue.speed || 1),
        returnAnimation: cue.return_animation ? String(cue.return_animation) : null,
      })),
      motionCues: motionCues.map((cue) => ({
        cueIndex: Number(cue.cue_index),
        timeMs: Number(cue.time_ms || 0),
        subject: String(cue.subject),
        motionType: String(cue.motion_type),
        targetCode: cue.target_code ? String(cue.target_code) : null,
        offsetX: Number(cue.offset_x || 0),
        offsetY: Number(cue.offset_y || 0),
        durationMs: Number(cue.duration_ms || 0),
        easing: cue.easing ? String(cue.easing) : null,
        flip: Boolean(cue.flip),
      })),
      hitCues: hitCues.map((cue) => ({
        cueIndex: Number(cue.cue_index),
        timeMs: Number(cue.time_ms || 0),
        targetActorId: String(cue.target_actor_id || "default-enemy"),
        targetCode: cue.target_code ? String(cue.target_code) : null,
        hitIndex: Number(cue.hit_index || 0),
        hitCount: Number(cue.hit_count || 1),
        hitAnimation: String(cue.hit_animation || profile?.hitAnimation || "Hit01"),
        hitDurationMs: cue.hit_duration_ms === null || cue.hit_duration_ms === undefined ? null : Number(cue.hit_duration_ms),
        hitPauseMs: Number(cue.hit_pause_ms || 0),
        timeSource: String(cue.time_source || "fallback"),
      })),
      effectCues: effectCueRows.map((cue) => ({
        cueIndex: Number(cue.cue_index),
        timeMs: Number(cue.time_ms || 0),
        timeSource: String(cue.time_source || "fallback"),
        effectRole: String(cue.effect_role),
        effectAssetId: String(cue.effect_asset_id),
        effectName: String(cue.effect_name),
        effectAnimation: cue.effect_animation ? String(cue.effect_animation) : null,
        hitCueId: cue.hit_cue_id === null || cue.hit_cue_id === undefined ? null : Number(cue.hit_cue_id),
        hitIndex: cue.hit_index === null || cue.hit_index === undefined ? null : Number(cue.hit_index),
        targetActorId: String(cue.target_actor_id || "default-enemy"),
        targetCode: cue.target_code ? String(cue.target_code) : null,
        anchor: cue.anchor ? String(cue.anchor) : null,
        positionType: String(cue.position_type || "enemy"),
        offsetX: Number(cue.offset_x || 0),
        offsetY: Number(cue.offset_y || 0),
        layer: String(cue.layer || "front"),
        scale: Number(cue.scale || 1),
        speed: Number(cue.speed || 1),
        loop: Boolean(cue.loop),
        zIndex: Number(cue.z_index || 0),
        maskType: Number(cue.mask_type || 0),
        directionMode: String(cue.direction_mode || "target"),
      })),
      effectAssets,
      warnings,
    };
  }
}
