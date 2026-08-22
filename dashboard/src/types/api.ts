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
  channel_type: 'WEB_CHAT' | 'WHATSAPP' | 'SAMCHEGUIDE';
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
  handling_mode?: 'AI' | 'HUMAN' | 'PAUSED';
  assigned_agent_user_id?: string | null;
  assigned_agent_email?: string | null;
  handoff_requested?: boolean;
  handoff_reason?: string | null;
  handling_version?: number;
  last_activity_at?: string;
  channel_type?: TenantChannel['channel_type'];
  channel_display_name?: string;
  assistant_name?: string | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
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
  actor_user_id?: string | null;
  actor_email?: string | null;
}

export interface ConversationAuditEvent {
  id: string;
  tenant_id: string;
  conversation_id: string;
  event_type: 'TAKEOVER' | 'RETURN_TO_AI' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'ASSIGNMENT' | 'HANDOFF_REQUESTED' | 'HUMAN_MESSAGE';
  metadata: Record<string, unknown>;
  actor_email?: string | null;
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

