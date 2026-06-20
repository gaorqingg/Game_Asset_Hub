import type { DatabaseSync } from "node:sqlite";

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  return rows.some((row) => String(row.name || "") === column);
}

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      icon_path TEXT,
      runtime TEXT NOT NULL,
      asset_base_url TEXT NOT NULL,
      catalog_base_url TEXT NOT NULL,
      source_catalog_json TEXT NOT NULL,
      source_spine_manifest TEXT NOT NULL,
      role_count INTEGER NOT NULL DEFAULT 0,
      spine_role_count INTEGER NOT NULL DEFAULT 0,
      animation_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      fallback_name TEXT NOT NULL,
      model TEXT,
      career TEXT,
      rarity TEXT,
      category TEXT,
      source TEXT,
      search_text TEXT NOT NULL DEFAULT '',
      data_quality TEXT NOT NULL DEFAULT '[]',
      has_spine INTEGER NOT NULL DEFAULT 0,
      animation_count INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS role_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      role_source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      source_path TEXT,
      UNIQUE(project_id, role_source_id, kind)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      role_source_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      slot TEXT,
      slot_label TEXT,
      name TEXT NOT NULL,
      icon_path TEXT,
      summary TEXT,
      description TEXT,
      search_text TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, role_source_id, source_id, slot)
    );

    CREATE TABLE IF NOT EXISTS spine_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      source_asset_id TEXT NOT NULL,
      role_source_id TEXT,
      runtime TEXT NOT NULL,
      name TEXT NOT NULL,
      skeleton_path TEXT,
      json_path TEXT,
      atlas_path TEXT,
      pages_json TEXT NOT NULL DEFAULT '[]',
      version TEXT,
      source_manifest TEXT NOT NULL DEFAULT '{}',
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS animations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role_source_id TEXT,
      name TEXT NOT NULL,
      duration REAL,
      frame_rate REAL,
      is_default INTEGER NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL DEFAULT '',
      UNIQUE(project_id, asset_id, name)
    );

    CREATE TABLE IF NOT EXISTS asset_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      asset_id TEXT,
      role_source_id TEXT,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      url TEXT NOT NULL,
      exists_on_disk INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, kind, path)
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      message TEXT,
      stats_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS role_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role_source_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      skill_id TEXT,
      slot TEXT,
      slot_label TEXT,
      action_name TEXT NOT NULL,
      label TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      role_animation TEXT,
      script_name TEXT,
      duration_ms INTEGER,
      is_primary INTEGER NOT NULL DEFAULT 0,
      remark TEXT,
      search_text TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, action_id)
    );

    CREATE TABLE IF NOT EXISTS effect_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      effect_asset_id TEXT NOT NULL,
      effect_name TEXT NOT NULL,
      runtime TEXT NOT NULL,
      skeleton_path TEXT,
      json_path TEXT,
      atlas_path TEXT,
      pages_json TEXT NOT NULL DEFAULT '[]',
      animations_json TEXT NOT NULL DEFAULT '[]',
      default_animation TEXT,
      bounds_json TEXT NOT NULL DEFAULT '{}',
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, effect_asset_id)
    );

    CREATE TABLE IF NOT EXISTS action_actor_cues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      cue_index INTEGER NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 0,
      actor_side TEXT NOT NULL,
      animation_name TEXT NOT NULL,
      source_anim_code TEXT,
      loop INTEGER NOT NULL DEFAULT 0,
      speed REAL NOT NULL DEFAULT 1,
      return_animation TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, action_id, cue_index)
    );

    CREATE TABLE IF NOT EXISTS action_motion_cues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      cue_index INTEGER NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL,
      motion_type TEXT NOT NULL,
      target_code TEXT,
      offset_x REAL NOT NULL DEFAULT 0,
      offset_y REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      easing TEXT,
      flip INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, action_id, cue_index)
    );

    CREATE TABLE IF NOT EXISTS action_hit_cues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      cue_index INTEGER NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 0,
      target_actor_id TEXT NOT NULL DEFAULT 'default-enemy',
      target_code TEXT,
      hit_index INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 1,
      hit_animation TEXT NOT NULL DEFAULT 'Hit01',
      hit_duration_ms INTEGER,
      hit_pause_ms INTEGER NOT NULL DEFAULT 0,
      time_source TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, action_id, cue_index)
    );

    CREATE TABLE IF NOT EXISTS action_effect_cues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      cue_index INTEGER NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 0,
      time_source TEXT NOT NULL,
      effect_role TEXT NOT NULL,
      effect_asset_id TEXT NOT NULL,
      effect_name TEXT NOT NULL,
      effect_animation TEXT,
      hit_cue_id INTEGER,
      hit_index INTEGER,
      target_actor_id TEXT NOT NULL DEFAULT 'default-enemy',
      target_code TEXT,
      anchor TEXT,
      position_type TEXT NOT NULL DEFAULT 'enemy',
      offset_x REAL NOT NULL DEFAULT 0,
      offset_y REAL NOT NULL DEFAULT 0,
      layer TEXT NOT NULL DEFAULT 'front',
      scale REAL NOT NULL DEFAULT 1,
      speed REAL NOT NULL DEFAULT 1,
      loop INTEGER NOT NULL DEFAULT 0,
      z_index INTEGER NOT NULL DEFAULT 0,
      mask_type INTEGER NOT NULL DEFAULT 0,
      direction_mode TEXT NOT NULL DEFAULT 'target',
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(project_id, action_id, cue_index)
    );

    CREATE TABLE IF NOT EXISTS project_battle_profiles (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      default_enemy_role_source_id TEXT,
      default_enemy_asset_id TEXT,
      battle_coord_scale REAL NOT NULL DEFAULT 1,
      caster_x REAL NOT NULL DEFAULT -260,
      caster_y REAL NOT NULL DEFAULT 0,
      target_x REAL NOT NULL DEFAULT 260,
      target_y REAL NOT NULL DEFAULT 0,
      caster_scale REAL NOT NULL DEFAULT 0.45,
      target_scale REAL NOT NULL DEFAULT 0.45,
      coordinate_mode TEXT NOT NULL DEFAULT 'custom',
      idle_animation TEXT NOT NULL DEFAULT 'idle',
      hit_animation TEXT NOT NULL DEFAULT 'Hit01',
      anchor_rules_json TEXT NOT NULL DEFAULT '{}',
      raw_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS effect_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      action_id TEXT,
      cue_id INTEGER,
      role_source_id TEXT,
      role_animation TEXT,
      action_name TEXT,
      effect_asset_id TEXT,
      time_ms INTEGER,
      anchor TEXT,
      position_type TEXT,
      offset_x REAL,
      offset_y REAL,
      layer TEXT,
      scale REAL,
      speed REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      UNIQUE(project_id, action_id, cue_id)
    );

    CREATE INDEX IF NOT EXISTS idx_roles_project ON roles(project_id);
    CREATE INDEX IF NOT EXISTS idx_roles_display ON roles(project_id, display_name);
    CREATE INDEX IF NOT EXISTS idx_roles_filters ON roles(project_id, career, rarity, category, source);
    CREATE INDEX IF NOT EXISTS idx_skills_role ON skills(project_id, role_source_id);
    CREATE INDEX IF NOT EXISTS idx_assets_project_role ON spine_assets(project_id, role_source_id);
    CREATE INDEX IF NOT EXISTS idx_animations_project_role ON animations(project_id, role_source_id);
    CREATE INDEX IF NOT EXISTS idx_asset_paths_project ON asset_paths(project_id, asset_id);
    CREATE INDEX IF NOT EXISTS idx_role_actions_project_role ON role_actions(project_id, role_source_id);
    CREATE INDEX IF NOT EXISTS idx_role_actions_search ON role_actions(project_id, action_name, label, skill_id);
    CREATE INDEX IF NOT EXISTS idx_effect_assets_project ON effect_assets(project_id, effect_asset_id);
    CREATE INDEX IF NOT EXISTS idx_actor_cues_action ON action_actor_cues(project_id, action_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_motion_cues_action ON action_motion_cues(project_id, action_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_hit_cues_action ON action_hit_cues(project_id, action_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_effect_cues_action ON action_effect_cues(project_id, action_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_effect_overrides_project ON effect_overrides(project_id, action_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS roles_fts USING fts5(
      project_id UNINDEXED,
      source_id UNINDEXED,
      display_name,
      fallback_name,
      career,
      rarity,
      category,
      source,
      search_text
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      project_id UNINDEXED,
      role_source_id UNINDEXED,
      source_id UNINDEXED,
      name,
      slot_label,
      summary,
      description,
      search_text
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS animations_fts USING fts5(
      project_id UNINDEXED,
      asset_id UNINDEXED,
      role_source_id UNINDEXED,
      name,
      search_text
    );
  `);

  if (!hasColumn(db, "role_actions", "remark")) {
    db.exec("ALTER TABLE role_actions ADD COLUMN remark TEXT");
  }
}
