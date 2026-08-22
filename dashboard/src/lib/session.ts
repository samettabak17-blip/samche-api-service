const tokenKey = 'samche.dashboard.session.v1';

export const session = {
  getToken(): string | null {
    return window.sessionStorage.getItem(tokenKey);
  },

  setToken(token: string): void {
    window.sessionStorage.setItem(tokenKey, token);
  },

  clear(): void {
    window.sessionStorage.removeItem(tokenKey);
  },
};

