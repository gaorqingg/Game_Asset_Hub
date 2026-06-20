# 2026-06-15 HTTP Resource Handoff

## Purpose

This note captures the latest resource publishing and HTTP URL migration work for `Game_Asset_Hub`.

Project root:

- `H:/game_assets_rebuild/Game_Asset_Hub`

Integrated source projects:

- `3029`: `H:/game_assets_rebuild/3029_huoying_OL`
- `3017`: `H:/game_assets_rebuild/3017_huoying_renjiechuanshuo`
- `3021`: `H:/game_assets_rebuild/3021_huoying_muyegaoshou`

Current test resource host:

- `http://192.168.0.9`

Current local Hub test service:

- `http://127.0.0.1:5190`
- PID at handoff time: `42104`
- `5173` and `5174` were already occupied by older Node/Vite services; `5173` was not the current Hub API.

## What Was Changed

The Hub was migrated so API responses use HTTP resource URLs instead of local Express proxy paths.

Old URL patterns:

- `/external-assets/{projectId}/assets/...`
- `/hub/projects/{projectId}/catalog/...`

New URL patterns:

- `http://192.168.0.9/{projectId}/assets/...`
- `http://192.168.0.9/{projectId}/catalog/...`

Code touched:

- `server/config.ts`
  - Added `defaultPublicOrigin`.
  - Added `joinPublicUrl(baseUrl, assetPath)`.
  - Added `projectAssetBaseUrl(projectId)`.
  - Added `projectCatalogBaseUrl(projectId)`.
  - `externalAssetUrl()` and `hubImageUrl()` are retained as compatibility wrappers, but now return HTTP URLs by default.
- `scripts/importAssets.ts`
  - Future imports write HTTP `asset_base_url`, `catalog_base_url`, and `asset_paths.url`.
  - Relative path fields remain relative.
- `server/repositories/assets.ts`
  - API response URLs are now composed from database base URLs.
  - Catalog URLs use `projects.catalog_base_url`.
  - Spine/effect URLs use `projects.asset_base_url`.
  - Important returned fields affected: `iconUrl`, `avatarUrl`, `RoleDetail.images[].url`, `skills[].iconUrl`, `skeletonUrl`, `jsonUrl`, `atlasUrl`, `pageUrls`.

Local compatibility kept:

- `server/index.ts` still mounts `/external-assets/{projectId}/assets` and `/hub` for local compatibility.
- API responses no longer depend on these paths.

## Database State

SQLite path:

- `data/asset-hub.sqlite`

Backup created before URL sync:

- `data/asset-hub.before-http-20260615111751.sqlite`

Current `projects` URL fields:

```text
3017 asset_base_url   = http://192.168.0.9/3017/assets
3017 catalog_base_url = http://192.168.0.9/3017/catalog
3021 asset_base_url   = http://192.168.0.9/3021/assets
3021 catalog_base_url = http://192.168.0.9/3021/catalog
3029 asset_base_url   = http://192.168.0.9/3029/assets
3029 catalog_base_url = http://192.168.0.9/3029/catalog
```

At handoff time:

- `old_project_urls = 0`
- `old_asset_path_urls = 0`

Database sync SQL that was used:

```sql
BEGIN IMMEDIATE;

UPDATE projects
SET asset_base_url = 'http://192.168.0.9/' || id || '/assets',
    catalog_base_url = 'http://192.168.0.9/' || id || '/catalog';

UPDATE asset_paths
SET url = 'http://192.168.0.9/' || project_id || '/assets/' || path;

COMMIT;
```

Important invariant:

- Keep `spine_assets.skeleton_path`, `spine_assets.json_path`, `spine_assets.atlas_path`, `spine_assets.pages_json`, `role_images.path`, and `skills.icon_path` as relative paths.
- Only base URLs and derived `asset_paths.url` should be environment-specific.

## Published Resource Layout

Shared copy path used for internal nginx document root:

- `\\192.168.0.9\wwwroot`

Expected HTTP layout:

```text
http://192.168.0.9/3017/assets/...
http://192.168.0.9/3017/catalog/...
http://192.168.0.9/3021/assets/...
http://192.168.0.9/3021/catalog/...
http://192.168.0.9/3029/assets/...
http://192.168.0.9/3029/catalog/...
```

Catalog copy completed:

- `3029`: `3037` files, `104.57 MB`
- `3017`: `331` files, `7.9 MB`
- `3021`: `703` files, `46.8 MB`

Assets directories were confirmed present on `\\192.168.0.9\wwwroot`:

- `3029/assets`: `3075` files, `1709.81 MB`
- `3017/assets`: `2305` files, `396.44 MB`
- `3021/assets`: `4237` files, `2643.61 MB`

Do not use `robocopy /MIR` unless the target project directory is known to be disposable.

## CORS / Nginx State

The page is being tested from:

- `http://127.0.0.1:5190`

Resources are loaded from:

- `http://192.168.0.9`

Nginx CORS state at handoff:

- `GET` and `HEAD` return `Access-Control-Allow-Origin: *`.
- `OPTIONS` still returns `405 Method Not Allowed`.
- Current app requests are plain GETs without custom headers, so regular resource loading should work.
- If future code adds custom headers or otherwise triggers preflight, nginx must handle `OPTIONS -> 204`.

Known good CORS checks:

```powershell
Invoke-WebRequest "http://192.168.0.9/3029/assets/manifest.json" -Method Head -Headers @{ Origin = "http://127.0.0.1:5173" } -UseBasicParsing
Invoke-WebRequest "http://192.168.0.9/3029/catalog/roles.json" -Method Head -Headers @{ Origin = "http://127.0.0.1:5173" } -UseBasicParsing
Invoke-WebRequest "http://192.168.0.9/3021/assets/spine/characters/AFei.skel" -Method Head -Headers @{ Origin = "http://127.0.0.1:5173" } -UseBasicParsing
```

Expected header:

```text
Access-Control-Allow-Origin: *
```

## Verification Already Run

Build:

```powershell
npm run build
```

Result:

- Passed.
- Vite emitted only the normal large chunk warning.

API verification on temporary/current service:

```text
http://127.0.0.1:5190/api/projects
http://127.0.0.1:5190/api/projects/3029/spine/11000101
http://127.0.0.1:5190/api/projects/3021/spine/SanChuan
http://127.0.0.1:5190/api/projects/3029/actions/11000101%3A21000101/timeline
```

Results:

- All returned `200`.
- Responses contained `http://192.168.0.9/...`.
- Responses did not contain `/external-assets/`.
- Responses did not contain `/hub/projects/`.

Sample verified API response values:

```text
jsonUrl  = http://192.168.0.9/3029/assets/spine/characters/11000101.json
atlasUrl = http://192.168.0.9/3029/assets/spine/characters/11000101.atlas
pageUrl  = http://192.168.0.9/3029/assets/spine/characters/11000101.png
```

## How To Continue

If testing manually:

1. Open `http://127.0.0.1:5190`.
2. Test project list images.
3. Test character catalog images.
4. Test single Spine preview:
   - `3029`, asset `11000101`
   - `3021`, asset `SanChuan`
5. Test action-effect preview:
   - `3029`, action `11000101:21000101`
   - `3021`, any populated action.

If restarting the service:

```powershell
$env:PORT='5190'
$env:HOST='127.0.0.1'
npm run dev
```

If port `5190` is still running and must be stopped:

```powershell
Get-NetTCPConnection -LocalPort 5190 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

If checking API URL shape:

```powershell
$r = Invoke-WebRequest "http://127.0.0.1:5190/api/projects" -UseBasicParsing
$r.Content.Contains("http://192.168.0.9/")
$r.Content.Contains("/external-assets/")
$r.Content.Contains("/hub/projects/")
```

Expected:

```text
True
False
False
```

## Future CDN Notes

Default origin is currently:

```text
ASSET_HUB_PUBLIC_ORIGIN || http://192.168.0.9
```

Supported future overrides:

```text
PROJECT_3029_ASSET_BASE_URL
PROJECT_3029_CATALOG_BASE_URL
PROJECT_3017_ASSET_BASE_URL
PROJECT_3017_CATALOG_BASE_URL
PROJECT_3021_ASSET_BASE_URL
PROJECT_3021_CATALOG_BASE_URL
```

When moving to CDN:

- Keep database path columns relative.
- Update base URLs through env vars and/or database sync.
- Ensure CDN returns CORS headers for GET/HEAD.
- Add OPTIONS handling if any future request path triggers browser preflight.

## Git / Workspace Notes

The workspace appears largely untracked in Git. `git diff` may show nothing even after edits because files are untracked.

Do not assume untracked files are disposable.

Generated/build artifacts may have changed because `npm run build` was executed.
