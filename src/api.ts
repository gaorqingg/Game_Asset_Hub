import type { ActionTimelineResponse, AnimationRole, BattleProfile, Project, RoleActionSummary, RoleDetail, RolePage, SpineAssetResponse } from "./types";

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function getProjects(query = "", signal?: AbortSignal): Promise<Project[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  const data = await fetchJson<{ projects: Project[] }>(`/api/projects?${params}`, signal);
  return data.projects;
}

export async function getProject(projectId: string, signal?: AbortSignal): Promise<Project> {
  const data = await fetchJson<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}`, signal);
  return data.project;
}

export async function getRoles(projectId: string, params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<RolePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) query.set(key, String(value));
  }
  return fetchJson<RolePage>(`/api/projects/${encodeURIComponent(projectId)}/roles?${query}`, signal);
}

export async function getRoleDetail(projectId: string, roleId: string, signal?: AbortSignal): Promise<RoleDetail> {
  const data = await fetchJson<{ role: RoleDetail }>(`/api/projects/${encodeURIComponent(projectId)}/roles/${encodeURIComponent(roleId)}`, signal);
  return data.role;
}

export async function getAnimations(projectId: string, query = "", signal?: AbortSignal): Promise<{ project: Project; roles: AnimationRole[] }> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  return fetchJson<{ project: Project; roles: AnimationRole[] }>(`/api/projects/${encodeURIComponent(projectId)}/animations?${params}`, signal);
}

export async function getCutins(projectId: string, query = "", signal?: AbortSignal): Promise<{ project: Project; roles: AnimationRole[] }> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  return fetchJson<{ project: Project; roles: AnimationRole[] }>(`/api/projects/${encodeURIComponent(projectId)}/cutins?${params}`, signal);
}

export async function getSpineAsset(projectId: string, assetId: string, signal?: AbortSignal): Promise<SpineAssetResponse> {
  return fetchJson<SpineAssetResponse>(`/api/projects/${encodeURIComponent(projectId)}/spine/${encodeURIComponent(assetId)}`, signal);
}

export async function getActions(projectId: string, roleId = "", query = "", signal?: AbortSignal): Promise<{ project: Project; actions: RoleActionSummary[] }> {
  const params = new URLSearchParams();
  if (roleId) params.set("roleId", roleId);
  if (query.trim()) params.set("q", query.trim());
  return fetchJson<{ project: Project; actions: RoleActionSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/actions?${params}`, signal);
}

export async function getActionTimeline(projectId: string, actionId: string, signal?: AbortSignal): Promise<ActionTimelineResponse> {
  return fetchJson<ActionTimelineResponse>(`/api/projects/${encodeURIComponent(projectId)}/actions/${encodeURIComponent(actionId)}/timeline`, signal);
}

export async function getBattleProfile(projectId: string, signal?: AbortSignal): Promise<{ project: Project; battleProfile: BattleProfile | null }> {
  return fetchJson<{ project: Project; battleProfile: BattleProfile | null }>(`/api/projects/${encodeURIComponent(projectId)}/battle-profile`, signal);
}
