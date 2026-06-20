# 2026-06-15 Session Handoff

## Project Snapshot

`Game_Asset_Hub` is a local multi-project game art asset browser.

Current stack:

- Vite + React + TypeScript frontend.
- Node/Express local service.
- SQLite index at `data/asset-hub.sqlite`.
- Pixi/Spine playback via `pixi.js`, `pixi-spine`, and `@pixi-spine/runtime-*` packages pulled by dependencies.

Core scripts:

- `npm run import-assets`: imports project catalog, Spine assets, actions, cues, and effect resources.
- `npm run dev`: starts local Express/Vite service.
- `npm run build`: runs `vite build` and `tsc -p tsconfig.node.json --noEmit`.

Integrated projects:

- `3029`: `H:/game_assets_rebuild/3029_huoying_OL`
- `3017`: `H:/game_assets_rebuild/3017_huoying_renjiechuanshuo`
- `3021`: `H:/game_assets_rebuild/3021_huoying_muyegaoshou`

## Implemented Features

Frontend pages:

- `/`: project cards, search, project entry.
- `/projects/:projectId/characters`: character catalog, server-side filtering/paging, role detail modal.
- `/projects/:projectId/animations`: animation tool with two modes:
  - `单动画`: single Spine animation preview.
  - `动作特效`: action + effect + hit preview.
- `/projects/:projectId/ui-effects`: empty placeholder.

API endpoints:

- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/roles`
- `GET /api/projects/:projectId/roles/:roleId`
- `GET /api/projects/:projectId/animations`
- `GET /api/projects/:projectId/spine/:assetId`
- `GET /api/projects/:projectId/actions?roleId=&q=`
- `GET /api/projects/:projectId/actions/:actionId/timeline`
- `GET /api/projects/:projectId/battle-profile`

SQLite schema includes:

- Base catalog tables: `projects`, `roles`, `role_images`, `skills`, `spine_assets`, `animations`, `asset_paths`, `import_runs`.
- Action-effect tables: `role_actions`, `effect_assets`, `action_actor_cues`, `action_motion_cues`, `action_hit_cues`, `action_effect_cues`, `project_battle_profiles`, `effect_overrides`.

Key files:

- `server/db/schema.ts`
- `server/repositories/assets.ts`
- `server/routes/api.ts`
- `scripts/importAssets.ts`
- `src/App.tsx`
- `src/SpineStage.tsx`
- `src/ActionEffectStage.tsx`
- `src/types.ts`

## Action-Effect Mode State

Action-effect mode is currently intended for:

- `3029`: adapted.
- `3021`: adapted.
- `3017`: not adapted; UI should show no action-effect data.

High-level model:

- `role_actions`: one normalized action row per role/action.
- `action_actor_cues`: actor animation switches, such as caster action animation and target hit animation.
- `action_motion_cues`: actor movement timeline, such as approach, routine movement, return.
- `action_hit_cues`: hit timing and target hit animation.
- `action_effect_cues`: effect Spine spawn timing, target anchor, offsets, scale, layer, and playback speed.
- `effect_assets`: effect Spine skeleton/atlas/page resources.
- `project_battle_profiles`: project-level coordinate and default enemy profile.
- `effect_overrides`: reserved manual override layer. Do not add overrides until original chain is checked.

`ActionEffectStage` uses Pixi layers:

- back effects
- caster actor
- target actor
- front effects
- screen effects

Important behavior already handled:

- Pause sets actor/effect Spine `timeScale` to `0`.
- Seek clears/rebuilds effect instances to avoid duplicated or stale effects.
- Wheel zoom and drag panning exist in both single animation and action-effect stages.

## 3021 Coordinate and Motion Notes

Source project:

- `H:/game_assets_rebuild/3021_huoying_muyegaoshou`

Do not trust only `web-spine-demo` for final positioning decisions. Use original recovered code/config under:

- `H:/game_assets_rebuild/3021_huoying_muyegaoshou/package_recovered/version_0412`

Important original code paths:

- `recovered_scripts/game/PvpBattleControlAttack.js`
  - Uses `skill_info.get(skillId).skil_show.split(",")`.
  - Gets release actor and victims from battle action data.
- `recovered_scripts/game/PvpBattleSkill_Common.js`
  - Loads `cdnRes/pvpbattle/script_json/<script>.json`.
  - Parses `eff`, `routine`, `hit`, `event`, `spine`, `shadow`.
  - `_handleRoutine` maps script `routine.target` to original battle anchors and runs `action_run`.
  - `_handleSpine` maps `spineType` to animation names.
  - `movecamera` parses `duration#zoom#x#y`.
- `recovered_scripts/game/PvpBattleSkillBase.js`
  - Implements anchor helpers such as `getSelfCampCenterPos`, `getOurCenterPos`, `getLineCenterPos`, etc.
- `recovered_scripts/game/action_run.js`
  - Tweens actor node to `toPosition`.
- `recovered_scripts/game/CardSprite.js`
  - Creates Spine under `_body._card`.
  - Spine node starts at `(0, 0)`.
- `recovered_scripts/game/PvpBattleWindow.js`
  - Applies `allModelRoleScale`.

Important recovered config paths:

- `recovered_configs/json/resources/data/data3/skill_info.json`
- `recovered_configs/json/resources/data/data3/knight_info.json`
- `recovered_configs/json/resources/data/data3/eff_node.json`
- `recovered_assets/resources/cdnRes/pvpbattle/script_json/*.json`
- `recovered_assets/resources/cdnRes/pvpbattle/character/*`

Current 3021 importer/stage mapping:

- 3021 PVP formation rules and coordinate conversion live in `scripts/importAssets.ts` and `src/ActionEffectStage.tsx`.
- `project_battle_profiles.coordinateMode` is `3021`.
- `battleCoordScale` is currently `1`.
- model battle scale is currently `0.6`.
- default release/victim index is currently `1`.
- default enemy is `MuYeXiaoBing`.
- Coordinate conversion is based on original PVP battle coordinates:
  - `x = pvpX * battleCoordScale`
  - `y = (formationOriginY - pvpY) * battleCoordScale`
- Script offset conversion:
  - `x = anchor.x + offsetX * battleCoordScale`
  - `y = anchor.y - offsetY * battleCoordScale`

## 3021 DaSheWan Findings

User asked about DaSheWan `三重罗生门` / `DaSheWan_Skill01`.

Confirmed chain:

- `knight_info.active_skill = 10800101`
- `skill_info[10800101].skil_show = DaSheWan_Skill01.json`
- `PvpBattleControlAttack.beforeAtkFinishHandle` starts the script.
- `PvpBattleSkill_Common._handleSpine` maps:
  - `spineType = 34` -> `Jump_forward01`
  - `spineType = 20` -> `Skill01`

Script source:

- Demo readable copy:
  - `H:/game_assets_rebuild/3021_huoying_muyegaoshou/web-spine-demo/public/assets/scripts/DaSheWan_Skill01.json`
- Original recovered package copy:
  - `H:/game_assets_rebuild/3021_huoying_muyegaoshou/package_recovered/version_0412/recovered_assets/resources/cdnRes/pvpbattle/script_json/DaSheWan_Skill01.json`

The two script copies match in content. The recovered original is a Cocos `cc.JsonAsset` wrapper with the same embedded JSON.

`DaSheWan_Skill01.json` key data:

- `routine[0]`: `time=3`, `target=4`, `type=1`, `offsetX=50`, `offsetY=-1`, `flyTime=120`.
- `routine[1]`: `time=2020`, `target=8`, `type=1`, `offsetX=0`, `offsetY=0`, `flyTime=100`.
- `event movecamera`: `time=2`, `param=120#1.03#0#0`.
- `event resetcamera`: `time=2019`, `param=100`.
- `spine[0]`: `time=1`, `spineType=34`, `Jump_forward01`.
- `spine[1]`: `time=130`, `spineType=20`, `Skill01`.

Conclusion on DaSheWan upward movement:

- The large apparent upward movement during `三重罗生门` is not from `routine.offsetY`.
- `routine.offsetY=-1` is only one original coordinate unit.
- `movecamera` zooms to `1.03` but has `x=0`, `y=0`, so it does not add vertical camera movement.
- The large movement is authored inside DaSheWan's Spine `Skill01` animation.

Binary skeleton check:

- Original package `DaSheWan.bin` and demo `DaSheWan.skel` have identical SHA-256:
  - `B9118284E47ABAACE73BBD1C4D6AD29BA741E26AA0E7528E40D7F35EC9C10CDB`
- Parsed with `@pixi-spine/runtime-3.8`.
- `Skill01` has a body-chain translate timeline:
  - `bone2`, frames include `y=-105.261` from about `0.733s` to `2.100s`.
- Effective screen/battle distance is reduced by model scale:
  - DaSheWan `knight_info.scale = 0.95`.
  - PVP `allModelRoleScale = 0.6`.
  - Approx display displacement: `105 * 0.95 * 0.6 ~= 60` battle units, then camera zoom can affect visible size.

Why single animation preview does not show the same movement clearly:

- `src/SpineStage.tsx` is a resource preview, not battle playback.
- It sets only one animation with `spine.state.setAnimation`.
- It fits and centers the whole model using `spineData` bounds or `getLocalBounds`.
- It has no battle ground baseline, enemy, script `routine`, skill camera, or target reference.
- The `Skill01` internal bone movement changes the skeleton pose relative to the Spine origin, but does not move outer `spine.x` / `spine.y`.
- `src/ActionEffectStage.tsx` keeps actor positions in battle coordinates, so the same internal body movement is visible relative to a stable battle origin and enemy.

## Recent Verification Status

Previously verified during this session:

- `npm run import-assets`
- `npm run build`
- Browser smoke on `http://127.0.0.1:5195/projects/3021/animations`

Observed browser console note:

- Vite websocket connection errors may appear during smoke if using a manually selected server/port or after a server restart. These were not app runtime errors.

No verification was rerun while creating this handoff document.

## Known Risks and Follow-Ups

1. Do not add display-only offsets for DaSheWan or other 3021 skills unless original code/config chain cannot explain the movement.

2. If a future task asks for single-animation preview to show battle-relative motion, add an explicit "battle baseline / origin lock" preview mode. Do not change existing centered resource preview silently.

3. 3021 routine target mapping should continue to follow `PvpBattleSkill_Common._handleRoutine` and `PvpBattleSkillBase` helper functions. Target meanings differ depending on context, especially `routine` versus `effect` anchors.

4. 3021 `script_json` can contain events not fully simulated yet, such as camera, special masks, screen shake, audio, and battle UI layers. Current v1 focuses on actor movement, actor animation, effects, hit animation, pause, seek, zoom, and pan.

5. `3017` action-effect mode is intentionally not adapted yet.

6. Chinese garbled text from recovered configs is not deeply cleaned. UI uses fallback values where needed.

7. `effect_overrides` exists for manual tuning, but use it as a last resort and document the original source gap.

## Useful One-Off Analysis Snippet

This Node snippet was used to inspect DaSheWan Spine translate timelines without loading textures:

```js
const fs = require("fs");
const spine = require("@pixi-spine/runtime-3.8");

class DummyLoader {
  newRegionAttachment(skin, name) { return new spine.RegionAttachment(name); }
  newMeshAttachment(skin, name) { return new spine.MeshAttachment(name); }
  newBoundingBoxAttachment(skin, name) { return new spine.BoundingBoxAttachment(name); }
  newPathAttachment(skin, name) { return new spine.PathAttachment(name); }
  newPointAttachment(skin, name) { return new spine.PointAttachment(name); }
  newClippingAttachment(skin, name) { return new spine.ClippingAttachment(name); }
}

const data = new spine.SkeletonBinary(new DummyLoader()).readSkeletonData(
  fs.readFileSync("H:/game_assets_rebuild/3021_huoying_muyegaoshou/web-spine-demo/public/assets/spine/characters/DaSheWan.skel")
);

for (const animName of ["Jump_forward01", "Skill01", "Stand01"]) {
  const anim = data.findAnimation(animName);
  console.log(animName, anim.duration, anim.timelines.length);
  for (const timeline of anim.timelines) {
    if ((timeline.constructor?.name || "").includes("Translate")) {
      const bone = data.bones[timeline.boneIndex];
      const frames = Array.from(timeline.frames);
      const rows = [];
      for (let i = 0; i < frames.length; i += 3) {
        rows.push({ t: frames[i], x: frames[i + 1], y: frames[i + 2] });
      }
      console.log(bone.name, rows);
    }
  }
}
```

## Current Git Note

At the time this handoff was written, the repository appears largely untracked in Git (`git status --short` shows many `??` entries). Do not assume untracked files are disposable.
