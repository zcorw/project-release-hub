import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '../shared/schema';
import { api, errorText } from './api';
import { Modal } from './components';
import type { AccountSecurity, AuthStatus } from './types';

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码').max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次新密码不一致',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: '新密码不能与当前密码相同',
  });
type PasswordFields = z.infer<typeof passwordChangeSchema>;
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN');
const securityEventLabels: Record<string, string> = {
  account_created: '管理员账户已创建',
  login_succeeded: '登录成功',
  login_failed: '登录失败',
  logout: '退出登录',
  password_changed: '密码已修改',
  all_sessions_revoked: '全部会话已撤销',
  session_revoked: '登录会话已撤销',
  consent_approved: '已同意应用授权',
  consent_denied: '已拒绝应用授权',
  token_issued: '已签发访问凭据',
  token_refreshed: '已刷新访问凭据',
  token_revoked: '访问凭据已撤销',
  grant_revoked: '应用授权已撤销',
  user_grants_revoked: '全部应用授权已撤销',
  credential_replay_revoked: '检测到刷新凭据重复使用',
};

export function resumeOAuth(): boolean {
  const request = new URLSearchParams(window.location.search).get('oauth_request');
  if (!request || !/^[A-Za-z0-9_-]{16,256}$/.test(request)) return false;
  window.location.assign(`/oauth/authorize?request_id=${encodeURIComponent(request)}`);
  return true;
}

export function clearOAuthRequest() {
  const url = new URL(window.location.href);
  url.searchParams.delete('oauth_request');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function AccountSettings({
  auth,
  onAuth,
  onClose,
}: {
  auth: AuthStatus;
  onAuth: (status: AuthStatus) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<AccountSecurity | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    action: () => Promise<void>;
  } | null>(null);
  const form = useForm<PasswordFields>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  async function load() {
    setLoading(true);
    try {
      setData(await api.security());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setConfirmation(null);
    } catch (err) {
      setError(errorText(err));
      setConfirmation(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function acceptStatus(status: AuthStatus) {
    if (!status.authenticated) clearOAuthRequest();
    onAuth(status);
  }
  return (
    <Modal
      title="账户与安全"
      description="管理单用户管理员密码、登录会话和 MCP 应用授权。"
      busy={busy}
      onClose={onClose}
    >
      <div className="account-settings">
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {confirmation ? (
          <section className="account-section" aria-label="确认安全操作">
            <h3>{confirmation.title}</h3>
            <p>请确认后继续。撤销后需要重新登录或重新授权。</p>
            <div className="account-actions">
              <button disabled={busy} onClick={() => void run(confirmation.action)}>
                {busy ? '正在处理…' : '确认操作'}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
                取消
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="account-section">
              <h3>修改密码</h3>
              <p className="muted">
                修改后保留当前登录，退出其他会话，并撤销全部 OAuth 授权。已连接的 MCP
                应用需要重新授权。
              </p>
              <form
                noValidate
                onSubmit={form.handleSubmit(() =>
                  setConfirmation({
                    title: '确认修改密码，并撤销其他会话与全部 OAuth 授权？',
                    action: async () => {
                      const values = form.getValues();
                      acceptStatus(
                        await api.changePassword(values.currentPassword, values.newPassword),
                      );
                      form.reset();
                      setNotice('密码已更新，其他会话与 OAuth 授权已撤销。');
                      await load();
                    },
                  }),
                )}
              >
                {(
                  [
                    ['currentPassword', '当前密码', 'current-password'],
                    ['newPassword', '新密码', 'new-password'],
                    ['confirmPassword', '确认新密码', 'new-password'],
                  ] as const
                ).map(([key, label, autocomplete]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`account-${key}`}>{label}</label>
                    <input
                      id={`account-${key}`}
                      type="password"
                      autoComplete={autocomplete}
                      disabled={busy}
                      {...form.register(key)}
                      aria-invalid={!!form.formState.errors[key]}
                      aria-describedby={`account-${key}-error`}
                    />
                    <span id={`account-${key}-error`} className="field-error" role="alert">
                      {form.formState.errors[key]?.message}
                    </span>
                  </div>
                ))}
                <button disabled={busy}>修改密码</button>
              </form>
            </section>
            <section className="account-section">
              <div className="account-actions">
                <h3>登录会话</h3>
                <button
                  className="secondary compact"
                  disabled={busy || loading}
                  onClick={() => {
                    setError('');
                    void load();
                  }}
                >
                  刷新安全信息
                </button>
              </div>
              {loading && <p role="status">正在加载安全信息…</p>}
              {!loading && !data && <p>安全信息加载失败，请刷新重试。</p>}
              {data?.sessions.map((session) => (
                <article className="account-record" key={session.id}>
                  <div>
                    <strong>{session.current ? '当前会话' : '其他会话'}</strong>
                    <p>登录：{dateTime(session.createdAt)}</p>
                    <p>最近活动：{dateTime(session.lastSeenAt)}</p>
                    <p>到期：{dateTime(session.expiresAt)}</p>
                  </div>
                  <button
                    className="danger-quiet"
                    disabled={busy || loading}
                    onClick={() =>
                      setConfirmation({
                        title: session.current ? '确认退出当前会话？' : '确认撤销此会话？',
                        action: async () => {
                          const status = await api.revokeSession(session.id);
                          acceptStatus(status);
                          if (status.authenticated) {
                            setNotice('会话已撤销。');
                            await load();
                          }
                        },
                      })
                    }
                  >
                    {session.current ? '退出当前会话' : '撤销会话'}
                  </button>
                </article>
              ))}
              {data?.sessions.length === 0 && <p className="muted">没有可显示的会话。</p>}
              <p className="muted">退出全部会话也会撤销全部 OAuth 授权，包括当前登录。</p>
              <button
                className="danger-quiet"
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    title: '确认退出全部会话，并撤销全部 OAuth 授权？',
                    action: async () => acceptStatus(await api.logoutAll()),
                  })
                }
              >
                退出全部会话
              </button>
            </section>
            <section className="account-section">
              <h3>MCP 应用授权</h3>
              <p className="muted">
                {auth.oauthEnabled
                  ? 'OAuth 已启用。MCP 可在授权范围内直接修改、删除记录，无需逐次网页确认。'
                  : '当前服务器未启用远程 OAuth。'}
              </p>
              {auth.publicUrl && <p className="account-url">服务地址：{auth.publicUrl}</p>}
              {data?.grants.map((grant) => (
                <article className="account-record" key={grant.id}>
                  <div>
                    <strong>{grant.clientName}</strong>
                    <p>权限：{grant.scope}</p>
                    <p>授权：{dateTime(grant.createdAt)}</p>
                    <p>最近使用：{grant.lastUsedAt ? dateTime(grant.lastUsedAt) : '未记录'}</p>
                  </div>
                  <button
                    className="danger-quiet"
                    disabled={busy || loading}
                    onClick={() =>
                      setConfirmation({
                        title: `确认撤销 ${grant.clientName} 的授权？`,
                        action: async () => {
                          await api.revokeGrant(grant.id);
                          setNotice('应用授权已撤销。');
                          await load();
                        },
                      })
                    }
                  >
                    撤销授权
                  </button>
                </article>
              ))}
              {data?.grants.length === 0 && <p className="muted">尚无 OAuth 应用授权。</p>}
            </section>
            <section className="account-section">
              <h3>近期安全记录</h3>
              {data?.events.map((event) => (
                <article className="account-record" key={event.id}>
                  <div>
                    <strong>{securityEventLabels[event.event] ?? '其他安全事件'}</strong>
                    <p>{dateTime(event.createdAt)}</p>
                  </div>
                </article>
              ))}
              {data?.events.length === 0 && <p className="muted">暂无安全记录。</p>}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
