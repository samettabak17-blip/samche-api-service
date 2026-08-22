export type SystemRole = 'OWNER' | 'CUSTOMER';
export type TenantRole = 'ADMIN' | 'AGENT';

export interface AuthUser { id: string; email: string; system_role: SystemRole; }
export interface LoginResponse { token: string; user: AuthUser; }
export interface Tenant { id: string; name: string; status: string; tenant_role?: TenantRole; created_at?: string; }
export interface Assistant { id: string; tenant_id: string; name: string; system_prompt?: string | null; model?: string | null; status?: string | null; created_at?: string; updated_at?: string; }
export type ConversationChannelType = 'WEB_CHAT' | 'WHATSAPP' | 'SAMCHEGUIDE';
export interface TenantChannel { id: string; tenant_id: string; assistant_id?: string | null; channel_type: ConversationChannelType; display_name: string; external_channel_id?: string | null; status: 'active' | 'inactive'; created_at?: string; updated_at?: string; }
export type ConversationStatus = 'open' | 'closed' | 'archived';
export type ConversationHandlingMode = 'AI' | 'HUMAN' | 'PAUSED';
export interface ConversationRecord {
  id: string;
  tenant_id: string;
  channel_id: string;
  external_conversation_id: string | null;
  customer_external_id: string | null;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  handling_mode: ConversationHandlingMode;
  assigned_agent_user_id: string | null;
  handoff_requested: boolean;
  handoff_reason: string | null;
  handling_version: number;
  last_activity_at: string;
}
export interface Conversation extends ConversationRecord {
  channel_type: ConversationChannelType;
  channel_display_name: string;
  assistant_name: string | null;
  assigned_agent_email: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
}
export type SenderType = 'CUSTOMER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
export interface ConversationMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  external_message_id: string | null;
  sender_type: SenderType;
  content: string;
  actor_user_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  actor_email: string | null;
}
export type ConversationAuditEventType = 'TAKEOVER' | 'RETURN_TO_AI' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'ASSIGNMENT' | 'HANDOFF_REQUESTED' | 'HUMAN_MESSAGE';
export interface ConversationAuditEvent {
  id: string;
  event_type: ConversationAuditEventType;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
}
export interface ConversationOperationResponse { conversation: ConversationRecord; }
export type AgentMessageResponse =
  | { duplicate: true }
  | { duplicate: false; message: ConversationMessage; delivery: 'AVAILABLE_TO_SAMCHEGUIDE' };
export interface KnowledgeDocument { id: string; tenant_id: string; assistant_id?: string | null; title: string; content: string; status: 'active' | 'inactive'; created_at?: string; updated_at?: string; }
export interface TeamMember { id: string; email: string; system_role: SystemRole; tenant_role: TenantRole; created_at?: string; }

export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'UNQUALIFIED';
export interface CrmAnalysis { id?: string; analysis_hash?: string; summary?: string | null; recommended_action?: string | null; signals?: Record<string, unknown> | null; reason_codes?: string[] | null; provider?: string | null; model?: string | null; model_version?: string | null; analyzed_at?: string | null; }
export interface CrmDeal { id: string; title: string; value?: number | string | null; currency?: string | null; status?: string | null; pipeline_stage_id?: string | null; expected_close_date?: string | null; created_at?: string | null; updated_at?: string | null; }
export interface CrmActivity { id: string; event_type: string; metadata?: Record<string, unknown> | null; created_at?: string | null; conversation_id?: string | null; actor_user_id?: string | null; actor_email?: string | null; }
export interface CrmLead {
  id: string; tenant_id: string; contact_id: string; company_id?: string | null; conversation_id?: string | null; source_channel?: string | null; status?: string | null; lead_score: number; temperature: LeadTemperature; intent?: string | null; service_interest?: string | null; budget_text?: string | null; normalized_budget?: number | string | null; budget_currency?: string | null; timeline?: string | null; assigned_user_id?: string | null; assigned_user_email?: string | null; pipeline_stage_id: string; pipeline_stage?: string | null; stage_key?: string | null; last_activity_at?: string | null; created_at?: string | null; updated_at?: string | null; first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null; phone?: string | null; language?: string | null; country?: string | null; company_name?: string | null; company_website?: string | null; company_industry?: string | null; company_country?: string | null; latest_analysis?: CrmAnalysis | null; deals?: CrmDeal[]; activities?: CrmActivity[];
}
export interface CrmLeadList { items: CrmLead[]; total: number; limit: number; offset: number; }
export interface CrmPipelineStage { id: string; tenant_id: string; stage_key: string; name: string; position: number; is_terminal?: boolean; }
