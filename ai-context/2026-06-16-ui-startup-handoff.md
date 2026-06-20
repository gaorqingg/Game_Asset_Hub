# 2026-06-16 UI and Startup Handoff

## Purpose

This note captures the latest `Game_Asset_Hub` changes from the current session:

- Animation page layout refactor.
- One-click Windows startup script.
- Dev-server HMR/port handling adjustment.

Project root:

- `H:/game_assets_rebuild/Game_Asset_Hub`

## Animation Page State

Route:

- `/projects/:projectId/animations`

Current layout:

- The previous single left selector plus right inspector layout was replaced with three working columns:
  - role column
  - animation/action/resource column
  - preview/player column
- The right inspector column was removed completely.
- Skin/resource switching now lives in the animation column.
- The animation column has its own local filter:
  - single mode filters current role animations by name/default/frame-rate/duration text.
  - action-effect mode filters current role actions by label/action/slot/skill/script/role animation/id text.
- Filtering does not force the active playing item to change. If the active item is hidden by the filter, the player keeps using the active selection.
- The preview header now shows runtime and Spine version context.

Important files:

- `src/App.tsx`
  - `AnimationPage` owns `animationQuery`, `filteredAnimations`, `filteredActions`, runtime/version labels, and the two-column selector JSX.
  - `AnimationInspectorPanel`, `ActionInspectorPanel`, `InspectorGroup`, `InfoRow`, and inspector-only playback/role-detail state were removed.
- `src/styles.css`
  - `.animation-layout` desktop grid is `240px 280px minmax(520px, 1fr)`.
  - `.animation-role-column` and `.animation-list-column` replace the old `.animation-selector`.
  - No `.animation-inspector` rules should remain.

Responsive behavior:

- At medium width, the three-column structure remains but columns compress to `220px 250px minmax(420px, 1fr)`.
- At mobile width, the page stacks vertically:
  - role column
  - animation/resource column
  - preview column
- Mobile explicitly releases the global `body`, `#root`, and `.project-shell` `overflow: hidden` / `100vh` constraints so the animation page can scroll.
- Browser smoke verified `390x844` with no horizontal overflow.

## One-Click Startup Script

New entrypoint:

- `start-web.bat`

Behavior:

- Can be double-clicked from Windows Explorer.
- Uses `%~dp0` and `start /D "%ROOT%"` so it works from any current directory.
- Checks that `npm` exists in `PATH`.
- Finds the first listening-free port from `5173` through `5199`.
- Binds the dev service to `0.0.0.0` so other devices on the LAN can reach it when the OS/firewall allows the connection.
- Uses `127.0.0.1` only for the local health check and automatic browser URL.
- Starts a new command window titled `Game Asset Hub - <port>` and runs:

```bat
set HOST=0.0.0.0&& set PORT=<port>&& npm run dev
```

- Polls `http://127.0.0.1:<port>/api/health`.
- Opens the system default browser at `http://127.0.0.1:<port>/` after the health check passes.
- Leaves the service command window open so users can see logs and close the window to stop the service.

Important bug fixed during implementation:

- The initial script used nested quotes around `cmd /k "cd /d ... && ..."`.
- Windows treated `"cd /d H:\game_assets_rebuild\Game_Asset_Hub\"` as an external executable and printed:
  - `"cd /d ..."` is not recognized as an internal or external command.
- The current script avoids this by using `start /D "%ROOT%" cmd /k ...`.

Port-switch verification:

- Existing listeners were present on several ports including `5173`, `5174`, and `5175`.
- Running `start-web.bat` successfully selected `5176`.
- `http://127.0.0.1:5176/api/health` returned `ok: true`.
- Test services on `5175` and `5176` were stopped after validation.

## Server/HMR Adjustment

File:

- `server/index.ts`

Current behavior:

- Express is now attached to an explicit Node HTTP server.
- In dev mode, Vite middleware receives `hmr: { server: httpServer }`.
- The HTTP server listens with `httpServer.listen(port, host, ...)`.

Reason:

- The startup script may run multiple local Hub instances on different HTTP ports.
- Vite's default HMR WebSocket can otherwise try to use a separate fixed port and conflict with older local services.
- Reusing the same HTTP server keeps HMR tied to the selected Hub port.

No API or schema change:

- Existing routes, SQLite schema, import scripts, and front-end route paths remain unchanged.

## Verification Completed

Commands/checks run:

- `npm run build`
- `cmd /c start-web.bat`
- `Invoke-RestMethod http://127.0.0.1:5176/api/health`

Observed results:

- Build passed.
- The standard Vite chunk-size warning still appears and is not related to this work.
- The startup script correctly skipped occupied ports and opened a healthy service.
- The temporary test service was cleaned up.

## Current Caveats and Follow-Ups

- `5173` may still be occupied by an older unrelated local page/service in this workstation. Do not assume `5173` is the current Hub API.
- The repository still appears mostly untracked in Git. Treat all untracked files as meaningful user/workspace state.
- `start-web.bat` uses a fixed search range of `5173-5199`. If many local services are running, expand the range intentionally rather than silently picking a random high port.
- If future agents change the animation page shell, keep mobile scrolling in mind: the global app shell defaults to `100vh` and `overflow: hidden`, which is hostile to stacked mobile tool layouts unless overridden.
