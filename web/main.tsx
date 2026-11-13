import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  setupSchema,
  loginSchema,
  entityLabel,
  type Snapshot,
  type Entity,
  type EntityData,
  type Kind,
  type ChangeRequest,
  type Operation,
  type Project,
  type AuditEvent,
} from '../shared/schema';
import { api, errorText } from './api';
import { AccountSettings, clearOAuthRequest, resumeOAuth } from './account';
import { RebaseDialog } from './rebase';
import type { AuthStatus } from './types';
import { EntityForm, Modal, RecordDetails, Tag, kindNames, label } from './components';
import './styles.css';

const emptySnapshot: Snapshot = { entities: [], requests: [], history: [], actions: [] };
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN');
function Auth({
  configured,
  setupAllowed,
  onAuth,
}: {
  configured: boolean;
  setupAllowed: boolean;
  onAuth: (status: AuthStatus) => void;
}) {
  const login = useForm({ resolver: zodResolver(loginSchema), defaultValues: { password: '' } });
  const setup = useForm({
    resolver: zodResolver(setupSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const [error, setError] = useState('');
  const current = configured ? login : setup;
  async function submit(value: { password: string }) {
    setError('');
    try {
      onAuth(await api.signIn(configured ? 'login' : 'setup', value.password));
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="brand">
          <span className="brand-icon">序</span> 知序
        </div>
        <div>
          <span className="eyebrow">YOUR PROJECTS, IN ONE PLACE</span>
          <h1>
            把每一次进展，
            <br />
            连接到下一次发布。
          </h1>
          <p>
            从具体功能、开发任务到发布记录，
            <br />
            让个人项目的每一步清晰可见。
          </p>
          <div className="auth-line" />
          <small>个人工作空间 · MCP 自动管理 · 完整历史记录</small>
        </div>
      </section>
      <main className="auth-main">
        <div className="auth-card">
          <span className="eyebrow">PROJECT WORKSPACE</span>
          <h2>
            {configured ? '欢迎回来' : setupAllowed ? '创建你的工作空间' : '等待管理员初始化'}
          </h2>
          <p className="muted">
            {configured ? '输入密码，继续管理你的项目。' : '设置本地管理员密码，开启项目管理。'}
          </p>
          {!configured && !setupAllowed ? (
            <div className="alert" role="status">
              此服务尚未初始化管理员账户。为保护远程服务，网页不开放首次设置。请管理员在服务器上完成账户初始化后刷新页面。
              <button className="secondary" onClick={() => window.location.reload()}>
                刷新状态
              </button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={configured ? login.handleSubmit(submit) : setup.handleSubmit(submit)}
            >
              <div className="field">
                <label htmlFor="password">密码</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={configured ? 'current-password' : 'new-password'}
                  {...(configured ? login.register('password') : setup.register('password'))}
                  aria-invalid={!!current.formState.errors.password}
                  aria-describedby="password-error password-hint"
                />
                <small id="password-hint">{!configured && '至少 12 个字符，请妥善保存。'}</small>
                <span className="field-error" id="password-error" role="alert">
                  {current.formState.errors.password?.message}
                </span>
              </div>
              {!configured && (
                <div className="field">
                  <label htmlFor="confirmPassword">确认密码</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    {...setup.register('confirmPassword')}
                    aria-invalid={!!setup.formState.errors.confirmPassword}
                    aria-describedby="confirm-error"
                  />
                  <span className="field-error" id="confirm-error" role="alert">
                    {setup.formState.errors.confirmPassword?.message}
                  </span>
                </div>
              )}
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              <button className="full-width" disabled={current.formState.isSubmitting}>
                {current.formState.isSubmitting
                  ? '正在验证…'
                  : configured
                    ? '进入工作空间'
                    : '创建工作空间'}
              </button>
            </form>
          )}
          <p className="auth-note">项目数据保存在本地。此版本不执行部署或触发工作流。</p>
        </div>
      </main>
    </div>
  );
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">＋</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [page, setPage] = useState<'overview' | 'pending' | 'history'>('overview');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<Exclude<Kind, 'project'>>('feature');
  const [editor, setEditor] = useState<{ kind: Kind; existing?: Entity } | null>(null);
  const [review, setReview] = useState<ChangeRequest | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshingActions, setRefreshingActions] = useState(false);
  const [search, setSearch] = useState('');
  const prepared = useRef(new Map<string, string>());
  const entities = snapshot.entities;
  const projects = entities.filter((e): e is Project => e.kind === 'project');
  const project = projects.find((e) => e.id === projectId);
  const pending = snapshot.requests.filter((r) => r.status === 'pending');
  const features = entities.filter((e) => e.kind === 'feature');
  function requestId(key: string) {
    let id = prepared.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      prepared.current.set(key, id);
    }
    return id;
  }
  async function reload() {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await api.snapshot());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  async function initialize() {
    setError('');
    setLoading(true);
    try {
      const status = await api.auth();
      setAuth(status);
      if (status.authenticated && resumeOAuth()) return;
      if (status.authenticated) setSnapshot(await api.snapshot());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  function navigate(next: typeof page) {
    setPage(next);
    setProjectId(null);
    setSearch('');
    setNotice('');
  }
  function edit(kind: Kind, existing?: Entity) {
    setEditor({ kind, existing });
  }
  function showReview(value: ChangeRequest) {
    setReviewError('');
    setRebaseOpen(false);
    setReview(value);
  }
  async function propose(operations: Operation[]) {
    const key = JSON.stringify(operations);
    const result = await api.change(requestId(key), operations);
    prepared.current.delete(key);
    if (result.status === 'pending') showReview(result);
    else setNotice(result.status === 'applied' ? '记录已保存。' : '该请求已拒绝。');
    return result;
  }
  async function save(value: EntityData) {
    const old = editor?.existing;
    await propose([
      old
        ? { action: 'update', id: old.id, expectedRevision: old.revision, entity: value }
        : { action: 'create', entity: value },
    ]);
    setEditor(null);
    await reload();
  }
  async function remove(entity: Entity) {
    setBusy(true);
    setError('');
    try {
      await propose([{ action: 'delete', id: entity.id, expectedRevision: entity.revision }]);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function undo(event: AuditEvent) {
    setBusy(true);
    setError('');
    try {
      const result = await api.undo(requestId(`undo:${event.id}`), event.id);
      if (result.status === 'pending') showReview(result);
      else setNotice(`撤销请求：${label(result.status)}`);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: 'confirm' | 'reject') {
    if (!review) return;
    setBusy(true);
    setReviewError('');
    try {
      const result = await api.review(review.id, action);
      setNotice(result.status === 'applied' ? '变更已确认并应用。' : '变更已拒绝，数据未修改。');
      setReview(null);
      await reload();
    } catch (err) {
      setReviewError(
        `${errorText(err)} ${review.mode === 'batch' ? '可点击「基于最新记录重新合并」生成新提案，再核对并确认。' : '请关闭此窗口并刷新，核实最新状态后手动调整。'}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshActions() {
    if (!project) return;
    setRefreshingActions(true);
    setError('');
    try {
      await api.actions(project.id);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRefreshingActions(false);
    }
  }
  if (!auth)
    return (
      <div className="initial-state">
        <span className="brand-icon">序</span>
        <h1>知序</h1>
        {loading ? (
          <p role="status">正在连接工作空间…</p>
        ) : (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void initialize()}>重试连接</button>
          </>
        )}
      </div>
    );
  if (!auth.authenticated)
    return (
      <Auth
        configured={auth.configured}
        setupAllowed={auth.setupAllowed}
        onAuth={(status) => {
          setAuth(status);
          if (resumeOAuth()) return;
          void reload();
        }}
      />
    );
  const displayed = project
    ? entities.filter((e) => e.kind === tab && e.projectId === project.id)
    : [];
  const actions = project
    ? snapshot.actions.find(
        (a) => a.projectId === project.id && a.repository === project.repository,
      )
    : undefined;
  const title = project
    ? project.name
    : page === 'overview'
      ? '项目总览'
      : page === 'pending'
        ? '待确认变更'
        : '操作历史';
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">序</span>
          <div>
            知序<small>个人项目工作空间</small>
          </div>
        </div>
        <div className="sidebar-label">工作空间</div>
        <nav aria-label="主导航">
          {(
            [
              ['overview', '◫', '项目总览'],
              ['pending', '◇', '待确认变更'],
              ['history', '◷', '操作历史'],
            ] as const
          ).map(([key, icon, name]) => (
            <button
              key={key}
              className={`nav-item ${page === key ? 'selected' : ''}`}
              onClick={() => navigate(key)}
              aria-current={page === key ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden>
                {icon}
              </span>
              {name}
              {key === 'pending' && pending.length > 0 && (
                <span className="count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="text-button" onClick={() => setAccountOpen(true)}>
            账户与安全
          </button>
          <div className="local-indicator">
            <span /> {auth.publicUrl ? '安全工作空间' : '本地工作空间'}
          </div>
          <p>所有重要变更，由你确认。</p>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.logout();
                clearOAuthRequest();
                setAccountOpen(false);
                setSnapshot(emptySnapshot);
                setAuth(await api.auth());
                setProjectId(null);
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            退出登录 ↗
          </button>
        </div>
      </aside>
      {accountOpen && (
        <AccountSettings
          auth={auth}
          onClose={() => setAccountOpen(false)}
          onAuth={(status) => {
            setAuth(status);
            if (!status.authenticated) {
              setAccountOpen(false);
              setSnapshot(emptySnapshot);
              setProjectId(null);
              setEditor(null);
              setReview(null);
              setNotice('');
            }
          }}
        />
      )}
      <main className="main">
        <div className="topbar">
          <span>
            工作空间 <span className="muted">/ {project ? '项目详情' : title}</span>
          </span>
          <div>
            <span className="connection">
              <i />
              {auth.publicUrl ? '已登录' : '本地'}
            </span>
            <button
              className="secondary compact"
              onClick={() => void reload()}
              disabled={loading || busy}
            >
              {loading ? '加载中…' : '刷新数据'}
            </button>
          </div>
        </div>
        <header className="page-header">
          <div>
            {project ? (
              <button className="back-link" onClick={() => setProjectId(null)}>
                ← 返回项目总览
              </button>
            ) : (
              <span className="eyebrow">
                {page === 'overview'
                  ? 'YOUR PROJECTS, IN ONE PLACE'
                  : page === 'pending'
                    ? 'REVIEW BEFORE APPLYING'
                    : 'EVERY CHANGE, TRACEABLE'}
              </span>
            )}
            <h1>{title}</h1>
            <p className="muted">
              {project
                ? project.description || '在这里管理功能、任务、问题与版本。'
                : page === 'overview'
                  ? '从具体功能到版本发布，让每一步进展清晰可见。'
                  : page === 'pending'
                    ? '这里保留网页提案、疑似重复的新项目和历史待确认请求。MCP 修改、删除可在授权范围内直接生效。'
                    : '查看每一次数据变更，以及应用前后的完整记录。'}
            </p>
          </div>
          <div className="header-actions">
            {project ? (
              <>
                <button className="secondary" onClick={() => edit('project', project)}>
                  编辑项目
                </button>
                <button
                  className="danger-quiet"
                  disabled={busy}
                  onClick={() => void remove(project)}
                >
                  删除
                </button>
              </>
            ) : page === 'overview' ? (
              <button onClick={() => edit('project')}>＋ 新建项目</button>
            ) : null}
          </div>
        </header>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button className="text-button" onClick={() => void initialize()}>
              重新连接
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {loading && (
          <p className="loading-line" role="status">
            正在同步最新数据…
          </p>
        )}
        {!project && page === 'overview' && (
          <>
            <section className="metrics" aria-label="项目指标">
              <Metric
                title="进行中的项目"
                value={String(projects.filter((p) => p.status === 'active').length)}
                hint="聚焦当前工作"
                icon="◫"
              />
              <Metric
                title="已完成功能"
                value={`${features.filter((f) => f.status === 'done').length} / ${features.length}`}
                hint="记录真实进度"
                icon="✓"
              />
              <Metric
                title="未解决问题"
                value={String(
                  entities.filter(
                    (e) => e.kind === 'issue' && !['resolved', 'closed'].includes(e.status),
                  ).length,
                )}
                hint="及时清理阻碍"
                icon="!"
              />
              <Metric
                title="待确认变更"
                value={String(pending.length)}
                hint="由你决定是否应用"
                icon="◇"
              />
            </section>
            <section>
              <div className="section-heading">
                <h2>
                  所有项目 <span className="total">{projects.length}</span>
                </h2>
                <input
                  className="search"
                  type="search"
                  aria-label="搜索项目"
                  placeholder="搜索项目名称或说明…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {projects.length === 0 && !loading ? (
                <Empty title="从第一个项目开始">
                  <p>把功能计划、开发工作与发布记录整理到一起。</p>
                  <button onClick={() => edit('project')}>＋ 新建项目</button>
                </Empty>
              ) : (
                <div className="project-grid">
                  {projects
                    .filter((p) =>
                      `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => {
                      const fs = features.filter((f) => f.projectId === p.id);
                      const done = fs.filter((f) => f.status === 'done').length;
                      return (
                        <article className="project-card" key={p.id}>
                          <div className="row">
                            <span className="project-avatar">
                              {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <Tag value={p.environmentStatus} />
                          </div>
                          <button
                            className="project-title"
                            onClick={() => {
                              setProjectId(p.id);
                              setTab('feature');
                            }}
                          >
                            {p.name}
                          </button>
                          <p className="project-description">
                            {p.description || '尚未添加项目说明'}
                          </p>
                          <div className="row">
                            <strong className="small">功能进度</strong>
                            <span className="muted small">
                              {done} / {fs.length} 已完成
                            </span>
                          </div>
                          <div
                            className="progress"
                            role="progressbar"
                            aria-label={`${p.name}功能完成进度`}
                            aria-valuenow={done}
                            aria-valuemax={fs.length || 1}
                          >
                            <span
                              style={{ width: `${fs.length ? (100 * done) / fs.length : 0}%` }}
                            />
                          </div>
                          <div className="small muted">
                            {fs.filter((f) => ['backlog', 'planned'].includes(f.status)).length}{' '}
                            规划中 <span className="dot-separator">·</span>{' '}
                            {fs.filter((f) => f.status === 'in_progress').length} 进行中{' '}
                            <span className="dot-separator">·</span>{' '}
                            {fs.filter((f) => f.status === 'blocked').length} 受阻
                          </div>
                          <footer className="row">
                            <span>
                              {p.environmentName} · {p.deployedVersion || '未记录部署'}
                            </span>
                            <button
                              className="text-button"
                              onClick={() => {
                                setProjectId(p.id);
                                setTab('feature');
                              }}
                            >
                              查看项目 →
                            </button>
                          </footer>
                        </article>
                      );
                    })}
                </div>
              )}
              {projects.length > 0 &&
                !projects.some((p) =>
                  `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
                ) && (
                  <Empty title="没有匹配的项目">
                    <p>试试其他关键词。</p>
                  </Empty>
                )}
            </section>
          </>
        )}
        {project && (
          <>
            <div className="context-grid">
              <section className="panel">
                <div className="section-heading">
                  <h2>项目环境</h2>
                  <Tag value={project.environmentStatus} />
                </div>
                <div className="environment-name">{project.environmentName}</div>
                <dl className="environment-details">
                  <div>
                    <dt>部署版本</dt>
                    <dd>{project.deployedVersion || '未记录'}</dd>
                  </div>
                  <div>
                    <dt>项目状态</dt>
                    <dd>
                      <Tag value={project.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>环境地址</dt>
                    <dd>
                      {project.environmentUrl ? (
                        <a href={project.environmentUrl} target="_blank" rel="noreferrer">
                          {project.environmentUrl} ↗
                        </a>
                      ) : (
                        '未设置'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>代码仓库</dt>
                    <dd>
                      {project.repository ? (
                        <a
                          href={`https://github.com/${project.repository}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {project.repository} ↗
                        </a>
                      ) : (
                        '未关联 GitHub 仓库'
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="panel-note">环境与部署状态由你维护，不由 CI 结果推断。</p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    GitHub Actions <span className="subtle-tag">只读</span>
                  </h2>
                  <button
                    className="secondary compact"
                    disabled={!project.repository || refreshingActions}
                    onClick={() => void refreshActions()}
                  >
                    {refreshingActions ? '读取中…' : '手动刷新'}
                  </button>
                </div>
                <p className="muted small">仅展示最新工作流事实，不会触发运行或更新发布状态。</p>
                {actions?.error && (
                  <div className="alert small" role="alert">
                    {actions.error}
                  </div>
                )}
                {actions?.runs.length ? (
                  <ul className="actions-list">
                    {actions.runs.slice(0, 5).map((run) => (
                      <li key={run.id}>
                        <div>
                          <a href={run.url} target="_blank" rel="noreferrer">
                            {run.name} ↗
                          </a>
                          <small>
                            {run.branch} · {run.event} · {dateTime(run.createdAt)}
                          </small>
                        </div>
                        <span className="subtle-tag">{run.conclusion ?? run.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="actions-empty">
                    {!project.repository
                      ? '关联 GitHub 仓库后，可手动读取运行结果。'
                      : actions
                        ? '没有可显示的运行记录。'
                        : '尚未读取 Actions，点击「手动刷新」获取最新信息。'}
                  </p>
                )}
                <p className="panel-note">
                  {actions?.updatedAt
                    ? `最近成功读取：${dateTime(actions.updatedAt)}`
                    : '尚无成功读取记录'}
                  {actions?.attemptedAt && ` · 最近尝试：${dateTime(actions.attemptedAt)}`}
                </p>
              </section>
            </div>
            <section className="panel records-panel">
              <div className="records-toolbar">
                <div className="tabs" role="tablist" aria-label="项目记录">
                  {(['feature', 'task', 'issue', 'release'] as const).map((kind) => (
                    <button
                      key={kind}
                      role="tab"
                      id={`tab-${kind}`}
                      aria-selected={tab === kind}
                      aria-controls="records-content"
                      className={tab === kind ? 'active' : ''}
                      onClick={() => setTab(kind)}
                    >
                      {kindNames[kind]}{' '}
                      <span>
                        {
                          entities.filter((e) => e.kind === kind && e.projectId === project.id)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <button onClick={() => edit(tab)}>＋ 新建{kindNames[tab]}</button>
              </div>
              <div id="records-content" role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {displayed.length === 0 ? (
                  <Empty title={`还没有${kindNames[tab]}`}>
                    <p>
                      {tab === 'feature'
                        ? '写下具体功能、验收标准和计划日期，开始追踪进度。'
                        : '新增记录，让项目工作有迹可循。'}
                    </p>
                    <button className="secondary" onClick={() => edit(tab)}>
                      新建{kindNames[tab]}
                    </button>
                  </Empty>
                ) : (
                  <div className="record-list">
                    {displayed.map((e) => (
                      <article className="record" key={e.id}>
                        <div className="record-top">
                          <div>
                            <div className="record-title">
                              <h3>{entityLabel(e)}</h3>
                              {'priority' in e && (
                                <span className={`priority priority-${e.priority}`}>
                                  {e.priority}
                                </span>
                              )}
                              <Tag value={e.status} />
                            </div>
                            <p className="muted record-description">
                              {'description' in e
                                ? e.description
                                : e.kind === 'release'
                                  ? e.notes
                                  : ''}
                            </p>
                          </div>
                          <div className="record-actions">
                            <button className="secondary compact" onClick={() => edit(e.kind, e)}>
                              编辑
                            </button>
                            <button
                              className="danger-quiet compact"
                              disabled={busy}
                              onClick={() => void remove(e)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                        {e.kind === 'feature' && (
                          <>
                            <div className="acceptance">
                              <strong>验收标准</strong>
                              <p>{e.acceptanceCriteria || '尚未填写验收标准'}</p>
                            </div>
                            <div className="record-meta">
                              <span>
                                计划：{e.plannedStart || '未设置'} → {e.plannedEnd || '未设置'}
                              </span>
                              <span>
                                目标版本：
                                {entities.find((r) => r.id === e.targetReleaseId)
                                  ? entityLabel(entities.find((r) => r.id === e.targetReleaseId)!)
                                  : '未关联'}
                              </span>
                            </div>
                          </>
                        )}
                        {(e.kind === 'task' || e.kind === 'issue') && (
                          <div className="record-meta">
                            <span>
                              关联功能：
                              {entities.find((r) => r.id === e.featureId)
                                ? entityLabel(entities.find((r) => r.id === e.featureId)!)
                                : '未关联'}
                            </span>
                            <span>
                              目标版本：
                              {entities.find((r) => r.id === e.targetReleaseId)
                                ? entityLabel(entities.find((r) => r.id === e.targetReleaseId)!)
                                : '未关联'}
                            </span>
                            {e.kind === 'task' && <span>截止：{e.dueDate || '未设置'}</span>}
                          </div>
                        )}
                        {e.kind === 'release' && (
                          <div className="record-meta">
                            <span>计划发布：{e.plannedDate || '未设置'}</span>
                            <span>实际发布：{e.releasedDate || '未设置'}</span>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
        {page === 'pending' && (
          <section>
            {pending.length === 0 && !loading ? (
              <Empty title="没有待确认的变更">
                <p>网页提案、撤销、疑似重复的新项目和历史待确认请求会显示在这里。</p>
              </Empty>
            ) : (
              <div className="review-list">
                {pending.map((r) => (
                  <article className="panel pending-card" key={r.id}>
                    <div>
                      <div className="record-title">
                        <h3>
                          {r.mode === 'undo'
                            ? '撤销历史操作'
                            : `${r.operations.length} 项变更待确认`}
                        </h3>
                        <span className="subtle-tag">来源：{label(r.source)}</span>
                      </div>
                      <p className="muted">
                        {dateTime(r.createdAt)}
                        {r.duplicates.length > 0 && ` · ${r.duplicates.length} 个疑似重复项目`}
                      </p>
                      <p className="small">
                        {r.operations
                          .map(
                            (op) =>
                              `${label(op.action)}${'entity' in op ? `「${entityLabel(op.entity)}」` : `「${entities.find((e) => e.id === op.id) ? entityLabel(entities.find((e) => e.id === op.id)!) : op.id}」`}`,
                          )
                          .join('、')}
                      </p>
                      <small className="request-id">请求编号：{r.id}</small>
                    </div>
                    <button onClick={() => showReview(r)}>查看并确认 →</button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {page === 'history' && (
          <section>
            {snapshot.history.length === 0 && !loading ? (
              <Empty title="还没有操作记录">
                <p>成功保存的每一次变更都会记录在这里。</p>
              </Empty>
            ) : (
              <div className="history-list">
                {[...snapshot.history]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((event) => (
                    <article className="panel history-card" key={event.id}>
                      <div className="row">
                        <div>
                          <h3>{event.summary}</h3>
                          <p className="muted small">
                            {dateTime(event.createdAt)} · 来源：{label(event.source)} ·{' '}
                            {event.changes.length} 项记录
                          </p>
                        </div>
                        <button
                          className="secondary"
                          disabled={busy || !!event.undoneBy}
                          onClick={() => void undo(event)}
                        >
                          {event.undoneBy ? '已撤销' : '预览撤销'}
                        </button>
                      </div>
                      <details>
                        <summary>查看变更前后快照</summary>
                        {event.changes.map((change) => (
                          <div className="snapshot-item" key={change.id}>
                            <h4>{entityLabel((change.after ?? change.before)!)}</h4>
                            <div className="diff-grid">
                              <section>
                                <h5>变更前</h5>
                                <RecordDetails entity={change.before} entities={entities} />
                              </section>
                              <section>
                                <h5>变更后</h5>
                                <RecordDetails entity={change.after} entities={entities} />
                              </section>
                            </div>
                          </div>
                        ))}
                      </details>
                      <small className="request-id">审计编号：{event.id}</small>
                    </article>
                  ))}
              </div>
            )}
          </section>
        )}
        <footer className="workspace-footer">
          知序 <span>功能完成 ≠ CI 成功 ≠ 已发布部署</span>
        </footer>
      </main>
      {editor && (
        <EntityForm
          kind={editor.kind}
          projectId={projectId ?? undefined}
          existing={editor.existing}
          entities={entities}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}
      {review && !editor && rebaseOpen && (
        <RebaseDialog
          request={review}
          entities={entities}
          requestId={requestId}
          onBack={() => setRebaseOpen(false)}
          onGenerated={async (result) => {
            setRebaseOpen(false);
            if (result.status === 'pending') {
              showReview(result);
              setNotice('新提案已生成，原提案已被替代。请核对后点击「确认并应用」。');
            } else {
              setReview(null);
              setNotice(
                result.status === 'applied'
                  ? '此新提案已经确认并应用，请核对最新记录。'
                  : result.supersededBy
                    ? '此新提案已被其他提案替代，请查看待确认变更。'
                    : '此新提案已被拒绝，请核对最新状态。',
              );
            }
            await reload();
          }}
        />
      )}
      {review && !editor && !rebaseOpen && (
        <Modal
          title={review.mode === 'undo' ? '确认撤销操作' : '确认变更提案'}
          description="请检查下面的具体内容。只有点击「确认并应用」后，这些变更才会写入。"
          busy={busy}
          onClose={() => setReview(null)}
        >
          <div className="review-content">
            <div className="review-meta">
              <span>来源：{label(review.source)}</span>
              <span>{dateTime(review.createdAt)}</span>
              <span>请求编号：{review.id}</span>
            </div>
            {review.rebasedFrom && (
              <p className="warning">
                此提案基于最新记录重新合并，原提案已被替代。尚未应用任何修改。
              </p>
            )}
            {review.duplicates.length > 0 && (
              <div className="warning">
                <strong>发现疑似重复项目</strong>
                <p>请核对以下已有项目，确认确实需要再建一个项目后继续。</p>
                <ul>
                  {review.duplicates.map((d, i) => (
                    <li key={`${d.existingId}-${i}`}>
                      {d.name}：{d.reason}
                      <br />
                      <small>
                        已有项目：{d.existingId} · 新项目：{d.proposedId}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review.mode === 'undo' && (
              <p className="warning">
                将恢复下列历史快照。若记录已有更新或引用关系发生变化，系统会拒绝撤销，避免覆盖新数据。
              </p>
            )}
            {review.operations.map((op, index) => {
              const existing = 'id' in op ? entities.find((e) => e.id === op.id) : undefined;
              return (
                <section className="proposal" key={index}>
                  <h3>
                    <span className={`operation operation-${op.action}`}>{label(op.action)}</span>{' '}
                    {'entity' in op
                      ? entityLabel(op.entity)
                      : existing
                        ? entityLabel(existing)
                        : op.id}
                  </h3>
                  {'expectedRevision' in op && (
                    <p className="small muted">
                      目标编号：{op.id} · 预期修订号：{op.expectedRevision}
                      {existing && existing.revision !== op.expectedRevision && (
                        <strong className="field-error">
                          {' '}
                          · 当前已是修订 {existing.revision}，此提案可能过期。
                        </strong>
                      )}
                    </p>
                  )}
                  <div className="diff-grid">
                    <section>
                      <h4>当前记录{review.mode === 'undo' ? '（撤销前）' : ''}</h4>
                      <RecordDetails entity={existing ?? null} entities={entities} />
                    </section>
                    <section>
                      <h4>{op.action === 'delete' ? '确认后删除' : '变更后'}</h4>
                      {op.action === 'delete' ? (
                        <p className="deletion-warning">
                          该记录将被删除。系统会检查引用关系，不会连带删除其他记录。
                        </p>
                      ) : (
                        <RecordDetails entity={op.entity} entities={entities} />
                      )}
                    </section>
                  </div>
                </section>
              );
            })}
            {review.operations.length === 0 && review.mode === 'undo' && (
              <UndoPreview
                auditId={review.auditId}
                history={snapshot.history}
                entities={entities}
              />
            )}
          </div>
          {reviewError && (
            <div className="alert" role="alert" tabIndex={-1} ref={(node) => node?.focus()}>
              {reviewError}
            </div>
          )}
          <div className="modal-footer">
            <button className="secondary" disabled={busy} onClick={() => setReview(null)}>
              稍后处理
            </button>
            <button className="danger-quiet" disabled={busy} onClick={() => void decide('reject')}>
              拒绝此变更
            </button>
            {review.mode === 'batch' && (
              <button className="secondary" disabled={busy} onClick={() => setRebaseOpen(true)}>
                基于最新记录重新合并
              </button>
            )}
            <button
              disabled={
                busy ||
                (review.mode === 'undo' &&
                  !snapshot.history.some((event) => event.id === review.auditId))
              }
              onClick={() => void decide('confirm')}
            >
              {busy ? '正在处理…' : '确认并应用'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint: string;
  icon: string;
}) {
  return (
    <div className="metric">
      <div className="row">
        <span>{title}</span>
        <span className="metric-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function UndoPreview({
  auditId,
  history,
  entities,
}: {
  auditId?: string;
  history: AuditEvent[];
  entities: Entity[];
}) {
  const event = history.find((e) => e.id === auditId);
  return (
    <>
      {event ? (
        event.changes.map((c) => (
          <section className="proposal" key={c.id}>
            <h3>{entityLabel((c.before ?? c.after)!)}</h3>
            <div className="diff-grid">
              <section>
                <h4>当前记录</h4>
                <RecordDetails
                  entity={entities.find((e) => e.id === c.id) ?? null}
                  entities={entities}
                />
              </section>
              <section>
                <h4>撤销后恢复为</h4>
                <RecordDetails entity={c.before} entities={entities} />
              </section>
            </div>
          </section>
        ))
      ) : (
        <div className="alert">未找到对应历史快照，请刷新后核对。审计编号：{auditId}</div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
