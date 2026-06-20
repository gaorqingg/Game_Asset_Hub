import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeInfo,
  Boxes,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Film,
  ImageIcon,
  LayoutGrid,
  ScanFace,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { getActionTimeline, getActions, getAnimations, getCutins, getProject, getProjects, getRoleDetail, getRoles } from "./api";
import ActionEffectStage from "./ActionEffectStage";
import SpineStage from "./SpineStage";
import type { ActionTimelineResponse, AnimationAsset, AnimationRole, Project, RoleActionSummary, RoleDetail, RolePage, RoleSummary, SpineAssetResponse } from "./types";

function displayName(role: Pick<RoleSummary, "displayName" | "fallbackName" | "sourceId">) {
  return role.displayName || role.fallbackName || role.sourceId;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function qualityLabel(items: string[]) {
  if (!items.length) return "可用";
  if (items.includes("source-text")) return "文本待清洗";
  if (items.includes("fallback-name")) return "名称兜底";
  return items.join(" / ");
}

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getProjects(query, controller.signal)
      .then((items) => {
        setProjects(items);
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  return { projects, query, setQuery, loading, error };
}

function HomePage() {
  const { projects, query, setQuery, loading, error } = useProjects();
  const [tab, setTab] = useState("all");
  const visibleProjects = useMemo(() => {
    if (tab === "recent") return [...projects].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (tab === "hot") return [...projects].sort((a, b) => b.roleCount + b.animationCount - (a.roleCount + a.animationCount));
    return projects;
  }, [projects, tab]);

  return (
    <main className="home-shell">
      <header className="home-topbar">
        <Link className="brand" to="/">
          <Boxes size={30} />
          <div>
            <h1>素材站</h1>
            <p>多项目游戏美术资源管理与预览</p>
          </div>
        </Link>
        <label className="search-field compact">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" />
        </label>
      </header>

      <section className="home-tabs" aria-label="项目分组">
        {[
          ["all", "全部项目"],
          ["recent", "最近更新"],
          ["hot", "热门项目"],
        ].map(([value, label]) => (
          <button key={value} className={tab === value ? "active" : ""} type="button" onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </section>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="notice">加载项目索引</div>}

      <section className="project-grid">
        {visibleProjects.map((project) => (
          <Link className="project-card" key={project.id} to={`/projects/${project.id}/characters`}>
            <div className="project-art">
              {project.iconUrl ? <img src={project.iconUrl} alt="" /> : <ImageIcon size={44} />}
            </div>
            <div className="project-card-body">
              <div className="project-card-head">
                <h2>{project.name}</h2>
                <span>{project.id}</span>
              </div>
              <p className="meta-line">
                <CalendarDays size={14} />
                {formatDate(project.createdAt)}
              </p>
              <div className="tag-row">
                {project.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <dl className="stat-strip">
                <div>
                  <dt>角色</dt>
                  <dd>{project.roleCount}</dd>
                </div>
                <div>
                  <dt>Spine</dt>
                  <dd>{project.spineRoleCount}</dd>
                </div>
                <div>
                  <dt>动画</dt>
                  <dd>{project.animationCount}</dd>
                </div>
              </dl>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}

function ProjectShell({ children }: { children: React.ReactNode }) {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getProject(projectId, controller.signal), getProjects("", controller.signal)])
      .then(([projectInfo, allProjects]) => {
        setProject(projectInfo);
        setProjects(allProjects);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) console.error(reason);
      });
    return () => controller.abort();
  }, [projectId]);

  const currentPath = window.location.pathname.includes("/animations")
    ? "animations"
    : window.location.pathname.includes("/cutins")
      ? "cutins"
      : window.location.pathname.includes("/ui-effects")
        ? "ui-effects"
        : "characters";

  return (
    <main className="project-shell">
      <header className="project-topbar">
        <button className="text-icon-button" type="button" onClick={() => navigate("/")}>
          <ArrowLeft size={17} />
          返回首页
        </button>
        <select value={projectId} onChange={(event) => navigate(`/projects/${event.target.value}/${currentPath}`)} aria-label="切换项目">
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <div className="project-chip-row">
          {(project?.tags || []).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <span className="project-date">创建时间：{project ? formatDate(project.createdAt) : "-"}</span>
      </header>
      <nav className="module-tabs">
        <NavLink to={`/projects/${projectId}/characters`}>
          <LayoutGrid size={16} />
          角色图鉴
        </NavLink>
        <NavLink to={`/projects/${projectId}/animations`}>
          <Film size={16} />
          角色动画
        </NavLink>
        <NavLink to={`/projects/${projectId}/cutins`}>
          <ScanFace size={16} />
          特写动画
        </NavLink>
        <NavLink to={`/projects/${projectId}/ui-effects`}>
          <Sparkles size={16} />
          UI动效
        </NavLink>
      </nav>
      {children}
    </main>
  );
}

function CharacterPage() {
  const { projectId = "" } = useParams();
  const [pageData, setPageData] = useState<RolePage | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ career: "", rarity: "", category: "", source: "", hasSpine: false });
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getRoles(
      projectId,
      {
        q: query,
        page,
        pageSize: 60,
        career: filters.career,
        rarity: filters.rarity,
        category: filters.category,
        source: filters.source,
        hasSpine: filters.hasSpine,
      },
      controller.signal,
    )
      .then((data) => {
        setPageData(data);
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, query, page, filters]);

  function setFilter(key: keyof typeof filters, value: string | boolean) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const totalPages = pageData ? Math.max(1, Math.ceil(pageData.total / pageData.pageSize)) : 1;

  return (
    <ProjectShell>
      <section className="tool-panel">
        <div className="toolbar-row">
          <label className="search-field">
            <Search size={17} />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索角色名称 / ID / 技能 / 资源" />
          </label>
          <FilterSelect label="职业" value={filters.career} options={pageData?.filters.careers || []} onChange={(value) => setFilter("career", value)} />
          <FilterSelect label="稀有度" value={filters.rarity} options={pageData?.filters.rarities || []} onChange={(value) => setFilter("rarity", value)} />
          <FilterSelect label="分类" value={filters.category} options={pageData?.filters.categories || []} onChange={(value) => setFilter("category", value)} />
          <FilterSelect label="来源" value={filters.source} options={pageData?.filters.sources || []} onChange={(value) => setFilter("source", value)} />
          <label className="toggle-filter">
            <input type="checkbox" checked={filters.hasSpine} onChange={(event) => setFilter("hasSpine", event.target.checked)} />
            有动画
          </label>
        </div>

        <div className="browser-headline">
          <div>
            <h2>角色图鉴</h2>
            <p>{pageData ? `${pageData.total} 个角色 · 第 ${page} / ${totalPages} 页` : "加载中"}</p>
          </div>
          <div className="pager">
            <button className="icon-button" disabled={page <= 1} type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft size={17} />
            </button>
            <button className="icon-button" disabled={page >= totalPages} type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
              <ChevronRight size={17} />
            </button>
          </div>
        </div>

        {error && <div className="notice error">{error}</div>}
        {loading && <div className="notice">加载角色索引</div>}
        <div className="role-grid">
          {(pageData?.roles || []).map((role) => (
            <button key={role.sourceId} className="role-tile" type="button" onClick={() => setSelectedRole(role.sourceId)}>
              <div className="avatar-frame">
                {role.avatarUrl ? <img src={role.avatarUrl} alt="" /> : <ImageIcon size={24} />}
              </div>
              <strong>{displayName(role)}</strong>
              <span>{role.career} / {role.rarity}</span>
              <em className={role.hasSpine ? "ready" : ""}>{role.hasSpine ? `${role.animationCount} 动画` : "无动画"}</em>
            </button>
          ))}
        </div>
      </section>
      {selectedRole && <RoleModal projectId={projectId} roleId={selectedRole} onClose={() => setSelectedRole(null)} />}
    </ProjectShell>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; count: number }[]; onChange: (value: string) => void }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">全部</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function RoleModal({ projectId, roleId, onClose }: { projectId: string; roleId: string; onClose: () => void }) {
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getRoleDetail(projectId, roleId, controller.signal)
      .then(setRole)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [projectId, roleId]);

  const portrait = role?.images.find((image) => ["whole", "standby", "card"].includes(image.kind)) || role?.images[0];

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭" />
      <section className="role-modal">
        <button className="icon-button modal-close" type="button" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        {error && <div className="notice error">{error}</div>}
        {!role && !error && <div className="notice">加载角色详情</div>}
        {role && (
          <>
            <div className="role-modal-hero">
              <div className="portrait-panel">
                {portrait ? <img src={portrait.url} alt="" /> : <ImageIcon size={54} />}
              </div>
              <div className="role-info-panel">
                <div className="modal-title-row">
                  <h2>{displayName(role)}</h2>
                  <span>{role.rarity}</span>
                </div>
                <dl className="info-grid">
                  <div><dt>ID</dt><dd>{role.sourceId}</dd></div>
                  <div><dt>职业</dt><dd>{role.career}</dd></div>
                  <div><dt>分类</dt><dd>{role.category}</dd></div>
                  <div><dt>来源</dt><dd>{role.source}</dd></div>
                  <div><dt>动画</dt><dd>{role.hasSpine ? `${role.animationCount} 个` : "无"}</dd></div>
                  <div><dt>数据</dt><dd>{qualityLabel(role.dataQuality)}</dd></div>
                </dl>
              </div>
            </div>
            <section className="skill-section">
              <h3>技能列表</h3>
              <div className="skill-list">
                {role.skills.length ? role.skills.map((skill) => (
                  <article key={`${skill.sourceId}-${skill.slot}`} className="skill-row">
                    <div className="skill-icon">{skill.iconUrl ? <img src={skill.iconUrl} alt="" /> : <BadgeInfo size={18} />}</div>
                    <div>
                      <strong>{skill.name}</strong>
                      <span>{skill.slotLabel || skill.slot || skill.sourceId}</span>
                      <p>{skill.summary || skill.description || "暂无描述"}</p>
                    </div>
                  </article>
                )) : <div className="empty-inline">暂无技能配置</div>}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function AnimationPage() {
  const { projectId = "" } = useParams();
  const [query, setQuery] = useState("");
  const [animationQuery, setAnimationQuery] = useState("");
  const [mode, setMode] = useState<"single" | "action">("single");
  const [project, setProject] = useState<Project | null>(null);
  const [roles, setRoles] = useState<AnimationRole[]>([]);
  const [actions, setActions] = useState<RoleActionSummary[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [actionRemarkOpen, setActionRemarkOpen] = useState(false);
  const [actionTimeline, setActionTimeline] = useState<ActionTimelineResponse | null>(null);
  const [loadedAsset, setLoadedAsset] = useState<SpineAssetResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getAnimations(projectId, query, controller.signal)
      .then((data) => {
        setProject(data.project);
        setRoles(data.roles);
        setError("");
        const firstRole = data.roles[0];
        setSelectedRoleId((current) => data.roles.some((role) => role.roleSourceId === current) ? current : firstRole?.roleSourceId || "");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [projectId, query]);

  useEffect(() => {
    const controller = new AbortController();
    getActions(projectId, "", query, controller.signal)
      .then((data) => {
        setActions(data.actions);
        setProject((current) => current || data.project);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) console.error(reason);
      });
    return () => controller.abort();
  }, [projectId, query]);

  const selectedRole = roles.find((role) => role.roleSourceId === selectedRoleId) || (mode === "single" ? roles[0] : undefined);
  const assets = selectedRole?.assets || [];
  const selectedAsset: AnimationAsset | undefined = assets.find((asset) => asset.assetId === selectedAssetId) || assets[0];
  const animations = selectedAsset?.animations || [];
  const actionsForSelectedRole = actions.filter((action) => action.roleSourceId === selectedRoleId);
  const selectedAction = actions.find((action) => action.actionId === selectedActionId) || actionsForSelectedRole[0] || actions[0];
  const actionCountsByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const action of actions) counts.set(action.roleSourceId, (counts.get(action.roleSourceId) || 0) + 1);
    return counts;
  }, [actions]);
  const actionRoleItems = useMemo(() => {
    const items = new Map<string, { roleSourceId: string; displayName: string; runtime: string }>();
    for (const action of actions) {
      if (!items.has(action.roleSourceId)) {
        items.set(action.roleSourceId, {
          roleSourceId: action.roleSourceId,
          displayName: action.roleName || action.roleSourceId,
          runtime: project?.runtime || "",
        });
      }
    }
    return [...items.values()];
  }, [actions, project?.runtime]);
  const activeAnimation = animations.some((animation) => animation.name === selectedAnimation)
    ? selectedAnimation
    : animations.find((animation) => animation.isDefault)?.name || animations[0]?.name || "";
  const filteredAnimations = useMemo(() => {
    const keyword = animationQuery.trim().toLowerCase();
    if (!keyword) return animations;
    return animations.filter((animation) => [
      animation.name,
      animation.isDefault ? "default 默认" : "action 动作",
      animation.frameRate ? `${animation.frameRate}fps` : "",
      animation.duration ? `${animation.duration.toFixed(2)}s` : "",
    ].join(" ").toLowerCase().includes(keyword));
  }, [animationQuery, animations]);
  const filteredActions = useMemo(() => {
    const keyword = animationQuery.trim().toLowerCase();
    if (!keyword) return actionsForSelectedRole;
    return actionsForSelectedRole.filter((action) => [
      action.label,
      action.actionName,
      action.slotLabel,
      action.slot,
      action.skillId,
      action.scriptName,
      action.roleAnimation,
      action.actionId,
      action.remark,
    ].filter(Boolean).join(" ").toLowerCase().includes(keyword));
  }, [animationQuery, actionsForSelectedRole]);
  const selectedActionRemark = actionTimeline && actionTimeline.action.actionId === selectedAction?.actionId
    ? actionTimeline.action.remark || ""
    : selectedAction?.remark || "";
  const runtimeLabel = mode === "action"
    ? actionTimeline?.caster.asset?.runtime || project?.runtime || selectedAction?.sourceKind || "-"
    : loadedAsset?.asset.runtime || selectedAsset?.runtime || project?.runtime || "-";
  const spineVersionLabel = mode === "action"
    ? actionTimeline?.caster.asset?.version || project?.runtime || selectedAction?.sourceKind || "-"
    : loadedAsset?.asset.version || selectedAsset?.runtime || project?.runtime || "-";
  const runtimeBadgeLabel = spineVersionLabel && spineVersionLabel !== "-" && spineVersionLabel !== runtimeLabel
    ? `${runtimeLabel} · ${spineVersionLabel}`
    : runtimeLabel;

  useEffect(() => {
    setSelectedAssetId((current) => assets.some((asset) => asset.assetId === current) ? current : assets[0]?.assetId || "");
  }, [selectedRoleId, roles]);

  useEffect(() => {
    setSelectedAnimation((current) => animations.some((animation) => animation.name === current) ? current : activeAnimation);
  }, [selectedAssetId, selectedRoleId, roles]);

  useEffect(() => {
    if (mode === "action" && actions.length && !actions.some((action) => action.roleSourceId === selectedRoleId)) {
      setSelectedRoleId(actions[0].roleSourceId);
      return;
    }
    const roleActions = actions.filter((action) => action.roleSourceId === selectedRoleId);
    const next = roleActions.some((action) => action.actionId === selectedActionId)
      ? selectedActionId
      : roleActions[0]?.actionId || actions[0]?.actionId || "";
    setSelectedActionId(next);
  }, [actions, mode, selectedActionId, selectedRoleId]);

  useEffect(() => {
    setLoadedAsset(null);
  }, [selectedAsset?.assetId]);

  useEffect(() => {
    setActionTimeline(null);
  }, [selectedActionId]);

  useEffect(() => {
    if (mode !== "action") setActionRemarkOpen(false);
  }, [mode]);

  useEffect(() => {
    if (mode !== "action" || !selectedActionId) return;
    const controller = new AbortController();
    getActionTimeline(projectId, selectedActionId, controller.signal)
      .then(setActionTimeline)
      .catch((reason) => {
        if (!controller.signal.aborted) console.error(reason);
      });
    return () => controller.abort();
  }, [mode, projectId, selectedActionId]);

  return (
    <ProjectShell>
      <section className="animation-layout">
        <aside className="animation-role-column">
          <section className="selector-block compact">
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色 / 动画 / 资源" />
            </label>
            <div className="mode-switch">
              <button type="button" className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>单动画</button>
              <button type="button" className={mode === "action" ? "active" : ""} onClick={() => setMode("action")}>动作特效</button>
            </div>
          </section>

          <section className="selector-block role-browser">
            <div className="sidebar-title">
              <h2>角色列表</h2>
              <span>{mode === "action" ? actionRoleItems.length : roles.length}</span>
            </div>
            <div className="animation-role-list">
              {mode === "action"
                ? actionRoleItems.map((role) => (
                    <button key={role.roleSourceId} className={role.roleSourceId === selectedRoleId ? "active" : ""} type="button" onClick={() => setSelectedRoleId(role.roleSourceId)}>
                      <strong>{role.displayName}</strong>
                      <span>{actionCountsByRole.get(role.roleSourceId) || 0} 动作</span>
                    </button>
                  ))
                : roles.map((role) => (
                    <button key={role.roleSourceId} className={role.roleSourceId === selectedRoleId ? "active" : ""} type="button" onClick={() => setSelectedRoleId(role.roleSourceId)}>
                      <strong>{role.displayName || role.fallbackName || role.roleSourceId}</strong>
                      <span>{role.assets.length} 资源 · {role.runtime}</span>
                    </button>
                  ))}
            </div>
          </section>
        </aside>

        <aside className="animation-list-column">
          <section className="selector-block compact">
            <label className="search-field">
              <Search size={17} />
              <input value={animationQuery} onChange={(event) => setAnimationQuery(event.target.value)} placeholder={mode === "action" ? "筛选动作 / 技能 / 脚本" : "筛选动画名称 / 帧率"} />
            </label>
          </section>

          {mode === "single" ? (
            <>
          <section className="selector-block animation-browser">
            <div className="sidebar-title">
              <h2>动画列表</h2>
              <span>{filteredAnimations.length}/{animations.length}</span>
            </div>
            <div className="animation-name-list">
              {filteredAnimations.map((animation) => (
                <button key={animation.name} className={animation.name === activeAnimation ? "active" : ""} type="button" onClick={() => setSelectedAnimation(animation.name)}>
                  <strong>{animation.name}</strong>
                  <span>{animation.isDefault ? "默认" : "动作"} · {animation.frameRate ? `${animation.frameRate}fps` : "帧率未知"}</span>
                </button>
              ))}
              {!animations.length && <div className="empty-inline">暂无动画条目</div>}
              {Boolean(animations.length) && !filteredAnimations.length && <div className="empty-inline">没有匹配的动画</div>}
            </div>
          </section>

          <section className="selector-block asset-browser">
            <div className="sidebar-title">
              <h2>皮肤 / 资源</h2>
              <span>{assets.length}</span>
            </div>
            <label className="stacked-field">
              <span>资源文件</span>
              <select value={selectedAsset?.assetId || ""} onChange={(event) => setSelectedAssetId(event.target.value)}>
                {assets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>
                ))}
              </select>
            </label>
            <p>{selectedAsset?.runtime || project?.runtime || "runtime unknown"}</p>
          </section>
            </>
          ) : (
            <>
              <section className="selector-block animation-browser action-browser">
                <div className="sidebar-title">
                  <h2>动作列表</h2>
                  <span>{filteredActions.length}/{actionsForSelectedRole.length}</span>
                </div>
                <div className="animation-name-list">
                  {filteredActions.map((action) => (
                    <button key={action.actionId} className={action.actionId === selectedAction?.actionId ? "active" : ""} type="button" onClick={() => setSelectedActionId(action.actionId)}>
                      <strong>{action.label || action.actionName}</strong>
                      <span>{action.slotLabel || action.slot || action.skillId || action.actionId} · {action.effectCount} 特效 / {action.hitCount} 受击</span>
                    </button>
                  ))}
                  {!actionsForSelectedRole.length && <div className="empty-inline">当前项目暂无动作特效数据</div>}
                  {Boolean(actionsForSelectedRole.length) && !filteredActions.length && <div className="empty-inline">没有匹配的动作</div>}
                </div>
              </section>

              <section className="selector-block asset-browser">
                <div className="sidebar-title">
                  <h2>敌人 / 资源</h2>
                  <span>{project?.id === "3017" ? "未适配" : "默认"}</span>
                </div>
                <p>敌人：{actionTimeline?.target.roleSourceId || "加载后显示"}</p>
                <p>角色资源：{actionTimeline?.caster.asset?.name || selectedRole?.displayName || "-"}</p>
                <p>特效资源：{actionTimeline ? `${actionTimeline.effectAssets.length} 个` : `${selectedAction?.effectCount || 0} 条绑定`}</p>
              </section>
            </>
          )}
        </aside>

        <section className="animation-preview">
          <div className="preview-head">
            <div>
              <span>{mode === "action" ? "动作特效预览" : "Spine 预览区"}</span>
              <h2>{mode === "action" ? selectedAction?.label || selectedAction?.actionName || "动作特效" : selectedRole?.displayName || project?.name || "角色动画"}</h2>
              <div className="preview-meta">
                <span>Runtime: <strong>{runtimeLabel}</strong></span>
                <span>Spine版本: <strong>{spineVersionLabel}</strong></span>
              </div>
            </div>
            <div className="preview-actions">
              {mode === "action" && (
                <button
                  className={`icon-button remark-toggle ${actionRemarkOpen ? "active" : ""}`}
                  type="button"
                  onClick={() => setActionRemarkOpen((value) => !value)}
                  title="动作备注"
                  aria-label="动作备注"
                >
                  <BadgeInfo size={16} />
                </button>
              )}
              <span className="runtime-badge">{runtimeBadgeLabel}</span>
            </div>
          </div>
          {mode === "action" && actionRemarkOpen && (
            <>
              <button
                className="action-remark-backdrop"
                type="button"
                onClick={() => setActionRemarkOpen(false)}
                aria-label="关闭动作备注"
              />
              <aside className="action-remark-drawer" aria-label="动作备注">
                <header className="action-remark-head">
                  <div>
                    <span>动作备注</span>
                    <h3>{selectedAction?.label || selectedAction?.actionName || "未选择动作"}</h3>
                  </div>
                  <button className="icon-button" type="button" onClick={() => setActionRemarkOpen(false)} title="关闭">
                    <X size={16} />
                  </button>
                </header>
                <dl className="action-remark-meta">
                  <div>
                    <dt>动作 ID</dt>
                    <dd>{selectedAction?.actionId || "-"}</dd>
                  </div>
                  <div>
                    <dt>技能 / 槽位</dt>
                    <dd>{selectedAction?.slotLabel || selectedAction?.slot || selectedAction?.skillId || "-"}</dd>
                  </div>
                  <div>
                    <dt>脚本 / 动画</dt>
                    <dd>{selectedAction?.scriptName || selectedAction?.roleAnimation || "-"}</dd>
                  </div>
                </dl>
                <section className="action-remark-body">
                  <span>备注内容</span>
                  <p>{selectedActionRemark.trim() || "暂无备注"}</p>
                </section>
              </aside>
            </>
          )}
          {error && <div className="notice error">{error}</div>}
          {mode === "single" ? (
            <SpineStage
              projectId={projectId}
              assetId={selectedAsset?.assetId || null}
              animationName={activeAnimation || null}
              onAssetLoaded={setLoadedAsset}
            />
          ) : (
            <ActionEffectStage
              projectId={projectId}
              actionId={selectedAction?.actionId || null}
              onTimelineLoaded={setActionTimeline}
            />
          )}
        </section>
      </section>
    </ProjectShell>
  );
}

function CutinAnimationPage() {
  const { projectId = "" } = useParams();
  const [query, setQuery] = useState("");
  const [animationQuery, setAnimationQuery] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [roles, setRoles] = useState<AnimationRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [loadedAsset, setLoadedAsset] = useState<SpineAssetResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getCutins(projectId, query, controller.signal)
      .then((data) => {
        setProject(data.project);
        setRoles(data.roles);
        setError("");
        const firstRole = data.roles[0];
        setSelectedRoleId((current) => data.roles.some((role) => role.roleSourceId === current) ? current : firstRole?.roleSourceId || "");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [projectId, query]);

  const selectedRole = roles.find((role) => role.roleSourceId === selectedRoleId) || roles[0];
  const assets = selectedRole?.assets || [];
  const selectedAsset: AnimationAsset | undefined = assets.find((asset) => asset.assetId === selectedAssetId) || assets[0];
  const animations = selectedAsset?.animations || [];
  const activeAnimation = animations.some((animation) => animation.name === selectedAnimation)
    ? selectedAnimation
    : animations.find((animation) => animation.isDefault)?.name || animations[0]?.name || "";
  const filteredAnimations = useMemo(() => {
    const keyword = animationQuery.trim().toLowerCase();
    if (!keyword) return animations;
    return animations.filter((animation) => [
      animation.name,
      animation.isDefault ? "default 默认" : "cutin 特写",
      animation.frameRate ? `${animation.frameRate}fps` : "",
      animation.duration ? `${animation.duration.toFixed(2)}s` : "",
    ].join(" ").toLowerCase().includes(keyword));
  }, [animationQuery, animations]);
  const runtimeLabel = loadedAsset?.asset.runtime || selectedAsset?.runtime || project?.runtime || "-";
  const spineVersionLabel = loadedAsset?.asset.version || selectedAsset?.runtime || project?.runtime || "-";
  const runtimeBadgeLabel = spineVersionLabel && spineVersionLabel !== "-" && spineVersionLabel !== runtimeLabel
    ? `${runtimeLabel} · ${spineVersionLabel}`
    : runtimeLabel;

  useEffect(() => {
    setSelectedAssetId((current) => assets.some((asset) => asset.assetId === current) ? current : assets[0]?.assetId || "");
  }, [selectedRoleId, roles]);

  useEffect(() => {
    setSelectedAnimation((current) => animations.some((animation) => animation.name === current) ? current : activeAnimation);
  }, [selectedAssetId, selectedRoleId, roles]);

  useEffect(() => {
    setLoadedAsset(null);
  }, [selectedAsset?.assetId]);

  return (
    <ProjectShell>
      <section className="animation-layout cutin-layout">
        <aside className="animation-role-column">
          <section className="selector-block compact">
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色 / 特写 / 资源" />
            </label>
          </section>

          <section className="selector-block role-browser">
            <div className="sidebar-title">
              <h2>特写角色</h2>
              <span>{roles.length}</span>
            </div>
            <div className="animation-role-list">
              {roles.map((role) => (
                <button key={role.roleSourceId} className={role.roleSourceId === selectedRoleId ? "active" : ""} type="button" onClick={() => setSelectedRoleId(role.roleSourceId)}>
                  <strong>{role.displayName || role.fallbackName || role.roleSourceId}</strong>
                  <span>{role.assets.length} 特写 · {role.runtime}</span>
                </button>
              ))}
              {!roles.length && <div className="empty-inline">暂无特写动画资源</div>}
            </div>
          </section>
        </aside>

        <aside className="animation-list-column">
          <section className="selector-block compact">
            <label className="search-field">
              <Search size={17} />
              <input value={animationQuery} onChange={(event) => setAnimationQuery(event.target.value)} placeholder="筛选特写动画 / 帧率" />
            </label>
          </section>

          <section className="selector-block animation-browser">
            <div className="sidebar-title">
              <h2>特写动画</h2>
              <span>{filteredAnimations.length}/{animations.length}</span>
            </div>
            <div className="animation-name-list">
              {filteredAnimations.map((animation) => (
                <button key={animation.name} className={animation.name === activeAnimation ? "active" : ""} type="button" onClick={() => setSelectedAnimation(animation.name)}>
                  <strong>{animation.name}</strong>
                  <span>{animation.isDefault ? "默认" : "特写"} · {animation.frameRate ? `${animation.frameRate}fps` : "帧率未知"}</span>
                </button>
              ))}
              {!animations.length && <div className="empty-inline">暂无特写动画条目</div>}
              {Boolean(animations.length) && !filteredAnimations.length && <div className="empty-inline">没有匹配的特写动画</div>}
            </div>
          </section>

          <section className="selector-block asset-browser">
            <div className="sidebar-title">
              <h2>特写资源</h2>
              <span>{assets.length}</span>
            </div>
            <label className="stacked-field">
              <span>资源文件</span>
              <select value={selectedAsset?.assetId || ""} onChange={(event) => setSelectedAssetId(event.target.value)}>
                {assets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>
                ))}
              </select>
            </label>
            <p>{selectedAsset?.runtime || project?.runtime || "runtime unknown"}</p>
          </section>
        </aside>

        <section className="animation-preview">
          <div className="preview-head">
            <div>
              <span>特写动画预览</span>
              <h2>{selectedRole?.displayName || project?.name || "特写动画"}</h2>
              <div className="preview-meta">
                <span>Runtime: <strong>{runtimeLabel}</strong></span>
                <span>Spine版本: <strong>{spineVersionLabel}</strong></span>
              </div>
            </div>
            <span className="runtime-badge">{runtimeBadgeLabel}</span>
          </div>
          {error && <div className="notice error">{error}</div>}
          <SpineStage
            projectId={projectId}
            assetId={selectedAsset?.assetId || null}
            animationName={activeAnimation || null}
            onAssetLoaded={setLoadedAsset}
          />
        </section>
      </section>
    </ProjectShell>
  );
}

function UiEffectsPage() {
  return (
    <ProjectShell>
      <section className="ui-empty">
        <div>
          <Sparkles size={42} />
          <h2>UI动效模块建设中</h2>
          <p>当前版本暂无内容</p>
        </div>
      </section>
    </ProjectShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/projects/:projectId/characters" element={<CharacterPage />} />
      <Route path="/projects/:projectId/animations" element={<AnimationPage />} />
      <Route path="/projects/:projectId/cutins" element={<CutinAnimationPage />} />
      <Route path="/projects/:projectId/ui-effects" element={<UiEffectsPage />} />
    </Routes>
  );
}
