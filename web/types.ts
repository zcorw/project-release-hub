export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  csrfToken: string;
  setupAllowed: boolean;
  oauthEnabled: boolean;
  publicUrl?: string;
}

export interface AccountSecurity {
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }[];
  grants: {
    id: string;
    clientName: string;
    scope: string;
    createdAt: string;
    lastUsedAt?: string;
  }[];
  events: { id: string; event: string; createdAt: string; detail?: string }[];
}
