export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  csrfToken: string;
}
