export type SystemRole = 'OWNER' | 'CUSTOMER';
export type TenantRole = 'ADMIN' | 'AGENT';

export interface AuthUser {
  id: string;
  email: string;
  system_role: SystemRole;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface Tenant {
  id: string;
  name: string;
  status: string;
  tenant_role?: TenantRole;
  created_at?: string;
}

