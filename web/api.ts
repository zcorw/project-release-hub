import type { AccountSecurity, AuthStatus } from './types';
import type {
  ActionsSnapshot,
  ChangeRequest,
  Operation,
  Snapshot,
  RebaseInput,
  RebasePreview,
} from '../shared/schema';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
let csrfToken = '';
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new ApiError(
      'NETWORK',
      body === undefined
        ? '连接失败，请检查本地服务后重试。'
        : '连接中断，操作结果尚未确认。请使用重试按钮，系统会保留原请求编号，避免重复提交。',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error?.code ?? String(response.status),
      data?.error?.message ?? '请求失败，请刷新后重试。',
      data?.error?.details,
    );
  if (data === null)
    throw new ApiError('INVALID_RESPONSE', '服务返回了无法识别的结果，请重试核实操作状态。');
  return data as T;
}
export const api = {
  async auth(): Promise<AuthStatus> {
    const value = await request<AuthStatus>('/api/auth/status');
    csrfToken = value.csrfToken;
    return value;
  },
  async signIn(mode: 'setup' | 'login', password: string): Promise<AuthStatus> {
    const value = await request<AuthStatus>(`/api/auth/${mode}`, { password });
    csrfToken = value.csrfToken;
    return value;
  },
  logout: () => request<void>('/api/auth/logout', {}),
  security: () => request<AccountSecurity>('/api/account/security'),
  async changePassword(currentPassword: string, newPassword: string): Promise<AuthStatus> {
    const value = await request<AuthStatus>('/api/account/password', {
      currentPassword,
      newPassword,
    });
    csrfToken = value.csrfToken;
    return value;
  },
  async logoutAll(): Promise<AuthStatus> {
    const value = await request<AuthStatus>('/api/account/logout-all', {});
    csrfToken = value.csrfToken;
    return value;
  },
  async revokeSession(id: string): Promise<AuthStatus> {
    const value = await request<AuthStatus>(
      `/api/account/sessions/${encodeURIComponent(id)}/revoke`,
      {},
    );
    csrfToken = value.csrfToken;
    return value;
  },
  revokeGrant: (id: string) =>
    request<void>(`/api/account/grants/${encodeURIComponent(id)}/revoke`, {}),
  snapshot: () => request<Snapshot>('/api/snapshot'),
  change: (requestId: string, operations: Operation[]) =>
    request<ChangeRequest>('/api/changes', { requestId, operations }),
  review: (id: string, action: 'confirm' | 'reject') =>
    request<ChangeRequest>(`/api/changes/${encodeURIComponent(id)}/${action}`, {}),
  previewRebase: (id: string) =>
    request<RebasePreview>(`/api/changes/${encodeURIComponent(id)}/rebase`),
  rebase: (id: string, input: RebaseInput) =>
    request<ChangeRequest>(`/api/changes/${encodeURIComponent(id)}/rebase`, input),
  undo: (requestId: string, auditId: string) =>
    request<ChangeRequest>('/api/undo', { requestId, auditId }),
  actions: (id: string) =>
    request<ActionsSnapshot>(`/api/projects/${encodeURIComponent(id)}/actions/refresh`, {}),
};
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误，请重试。';
}
