import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { HubIngestError, replaceProjectFromHubIngest } from "../ingest/hubIngest.js";
import { AssetRepository } from "../repositories/assets.js";

function sendNotFound(response: Response, message: string) {
  response.status(404).json({ error: message });
}

function routeParam(request: Request, key: string): string {
  const value = request.params[key];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function sendIngestError(response: Response, error: unknown) {
  if (error instanceof HubIngestError) {
    response.status(error.statusCode).json({
      error: error.message,
      details: error.details,
    });
    return;
  }

  response.status(500).json({
    error: "Failed to import hub-ingest package",
    details: [error instanceof Error ? error.message : String(error)],
  });
}

export function registerApiRoutes(app: Express, repository: AssetRepository, db: DatabaseSync): void {
  app.get("/api/projects", (request: Request, response: Response) => {
    response.json({ projects: repository.listProjects(String(request.query.q || "")) });
  });

  app.get("/api/projects/:projectId", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "项目不存在");
    response.json({ project });
  });

  app.get("/api/projects/:projectId/roles", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "项目不存在");
    const result = repository.listRoles(projectId, {
      q: String(request.query.q || ""),
      page: Number(request.query.page || 1),
      pageSize: Number(request.query.pageSize || 48),
      career: request.query.career ? String(request.query.career) : undefined,
      rarity: request.query.rarity ? String(request.query.rarity) : undefined,
      category: request.query.category ? String(request.query.category) : undefined,
      source: request.query.source ? String(request.query.source) : undefined,
      hasSpine: request.query.hasSpine ? String(request.query.hasSpine) : undefined,
    });
    response.json({ project, filters: repository.listRoleFilters(projectId), ...result });
  });

  app.get("/api/projects/:projectId/roles/:roleId", (request: Request, response: Response) => {
    const detail = repository.getRoleDetail(routeParam(request, "projectId"), routeParam(request, "roleId"));
    if (!detail) return sendNotFound(response, "角色不存在");
    response.json({ role: detail });
  });

  app.get("/api/projects/:projectId/animations", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "项目不存在");
    response.json({
      project,
      roles: repository.listAnimations(projectId, String(request.query.q || "")),
    });
  });

  app.get("/api/projects/:projectId/cutins", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "项目不存在");
    response.json({
      project,
      roles: repository.listCutins(projectId, String(request.query.q || "")),
    });
  });

  app.get("/api/projects/:projectId/actions", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "Project not found");
    response.json({
      project,
      actions: repository.listActions(projectId, String(request.query.roleId || ""), String(request.query.q || "")),
    });
  });

  app.get("/api/projects/:projectId/actions/:actionId/timeline", (request: Request, response: Response) => {
    const timeline = repository.getActionTimeline(routeParam(request, "projectId"), routeParam(request, "actionId"));
    if (!timeline) return sendNotFound(response, "Action not found");
    response.json(timeline);
  });

  app.get("/api/projects/:projectId/battle-profile", (request: Request, response: Response) => {
    const projectId = routeParam(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) return sendNotFound(response, "Project not found");
    response.json({ project, battleProfile: repository.getBattleProfile(projectId) });
  });

  app.get("/api/projects/:projectId/spine/:assetId", (request: Request, response: Response) => {
    const asset = repository.getSpineAsset(routeParam(request, "projectId"), routeParam(request, "assetId"));
    if (!asset) return sendNotFound(response, "Spine 资源不存在");
    response.json(asset);
  });

  app.post("/api/ingest/projects/:projectId/replace", (request: Request, response: Response) => {
    try {
      const result = replaceProjectFromHubIngest(db, routeParam(request, "projectId"), request.body);
      response.json({ ok: true, ...result });
    } catch (error) {
      sendIngestError(response, error);
    }
  });
}
