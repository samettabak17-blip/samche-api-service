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

export interface Assistant {
  id: string;
  tenant_id: string;
  name: string;
  system_prompt?: string | null;
  model?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenantChannel {
  id: string;
  tenant_id: string;
  assistant_id?: string | null;
  channel_type: 'WEB_CHAT' | 'WHATSAPP';
  display_name: string;
  external_channel_id?: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  channel_id: string;
  external_conversation_id?: string | null;
  customer_external_id?: string | null;
  status: 'open' | 'closed' | 'archived';
  created_at?: string;
  updated_at?: string;
}

export type SenderType = 'CUSTOMER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';

export interface ConversationMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  external_message_id?: string | null;
  sender_type: SenderType;
  content: string;
  created_at?: string;
}

export interface KnowledgeDocument {
  id: string;
  tenant_id: string;
  assistant_id?: string | null;
  title: string;
  content: string;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface TeamMember {
  id: string;
  email: string;
  system_role: SystemRole;
  tenant_role: TenantRole;
  created_at?: string;
}

