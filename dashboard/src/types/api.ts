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
export interface HumanAttentionSummary { unresolvedCount: number; }
export interface Conversation extends ConversationRecord {
  channel_type: ConversationChannelType;
  channel_display_name: string;
  assistant_name: string | null;
  assigned_agent_email: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  human_delivery_configured: boolean;
  human_attention_state?: 'NONE' | 'REQUESTED' | 'ACKNOWLEDGED' | 'RESOLVED';
  contact_display_name?: string | null;
  contact_phone?: string | null;
  contact_language?: string | null;
  contact_country?: string | null;
  communication_language?: string | null;
}
export type SenderType = 'CUSTOMER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
export type ConversationResourceStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
export interface ConversationResource {
  id: string;
  tenant_id: string;
  conversation_id: string;
  message_id: string;
  source_type: 'UPLOAD' | 'WHATSAPP_MEDIA' | 'AGENT_UPLOAD' | 'URL';
  media_category: 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'LINK';
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  processing_status: ConversationResourceStatus;
  failure_code: string | null;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
}
export interface ConversationMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  external_message_id: string | null;
  delivery_status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null;
  delivery_status_updated_at: string | null;
  delivery_failure_code: string | null;
  sender_type: SenderType;
  content: string;
  actor_user_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  actor_email: string | null;
  resources: ConversationResource[];
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
  | { duplicate: false; message: ConversationMessage; delivery: 'AVAILABLE_TO_SAMCHEGUIDE' | 'SENT_TO_WHATSAPP' };
export interface KnowledgeDocument { id: string; tenant_id: string; assistant_id?: string | null; title: string; content: string; status: 'active' | 'inactive'; created_at?: string; updated_at?: string; }
export interface KnowledgeOverview { sources: { ready: number; processing: number; failed: number }; reviewQueue: { candidates: number; profiles: number; recommendations: number; configurations: number }; gaps: { open: number }; runtime: { activeProfile: boolean; activeConfigurations: number; assistants: number }; }
export interface KnowledgeSource { id: string; title: string; source_type: string; original_filename?: string | null; mime_type?: string | null; size_bytes?: number | null; processing_status: string; indexing_status: string; processing_error_code?: string | null; enabled: boolean; assistant_ids?: string[]; extraction_hash?: string | null; extraction_method?: string | null; extraction_version?: string | null; image_segment_count?: number; image_role_summary?: Partial<Record<'BUSINESS' | 'CUSTOMER' | 'UNKNOWN', number>>; updated_at?: string; processed_at?: string | null; indexed_at?: string | null; }
export interface KnowledgeCandidate { id: string; candidate_type: string; proposed_title: string; proposed_content: string; status: string; confidence?: number | null; pii_redaction_status?: string | null; evidence_summary?: unknown; approved_source_id?: string | null; reviewed_at?: string | null; }
export interface KnowledgeCandidateEvidence { conversation_id?: string | null; message_id?: string | null; channel_type: string; sender_type: string; occurred_at: string; evidence_type?: 'CONVERSATION' | 'IMAGE'; evidence_kind?: 'PRIMARY' | 'SUPPORTING_CONTEXT' | null; source_id?: string | null; source_title?: string | null; segment_id?: string | null; role_confidence?: number | null; normalized_text?: string | null; extraction_version?: string | null; extraction_hash?: string | null; segment_order?: number | null; source_locator?: Record<string, unknown> | null; }
export interface KnowledgeGap { id: string; assistant_id?: string | null; normalized_question: string; occurrence_count: number; status: string; suggested_candidate_id?: string | null; signal_type?: string | null; last_detected_at?: string; }
export interface KnowledgeGapSignal { conversation_id: string; message_id: string; channel_type: string; signal_type: string; created_at: string; }
export interface BusinessIdentity { id: string; display_name: string; normalized_identity: string; status: string; created_at?: string; updated_at?: string; }
export interface BusinessIdentityConflict { detected_identity: string; normalized_identity: string; source_ids: string[]; }
export interface BusinessProfileVersion { id: string; schema_version?: number; business_identity_id?: string | null; business_identity_name?: string | null; identity_resolution_status?: string; source_scope?: { business_identity_id?: string; source_ids?: string[] }; profile_data: Record<string, unknown>; evidence?: unknown; status: string; active_version_id?: string | null; superseded_by_version_id?: string | null; reviewed_at?: string | null; created_at?: string; }
export interface BusinessProfileGenerationResult { profile: BusinessProfileVersion; reused: boolean; run_id: string; }
export interface KnowledgeRecommendation {
  id: string;
  recommendation_data: Record<string, unknown>;
  evidence?: Array<{ semantic_category?: string }> | null;
  status: string;
  created_at?: string;
}
export interface AssistantConfigurationVersion { id: string; schema_version?: number; configuration_data: Record<string, unknown>; source_profile_version_id?: string | null; source_recommendation_id?: string | null; status: string; approved_at?: string | null; created_at?: string; }
export interface RecommendationGenerationResult { recommendation: KnowledgeRecommendation; reused: boolean; run_id: string; }
export interface ConfigurationGenerationResult { configuration: AssistantConfigurationVersion; reused: boolean; run_id: string; }
export interface BusinessIdentityScopeAnalysis { status: 'RESOLVED' | 'IDENTITY_RESOLUTION_REQUIRED'; business_identity: BusinessIdentity; source_ids: string[]; identities: Array<{ detected_identity: string; normalized_identity: string; source_ids: string[] }>; evidence: Array<{ source_id: string; source_title: string; detected_identity: string; confidence: number; safe_evidence: string }> }
export interface KnowledgeRetrievalPreview { query: string; matches: Array<{ chunkId: string; sourceId: string; sourceTitle: string; excerpt: string; similarity: number }>; }
export interface TeamMember { id: string; email: string; system_role: SystemRole; tenant_role: TenantRole; created_at?: string; }

export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'UNQUALIFIED';
export interface CrmAnalysis { id?: string; analysis_hash?: string; summary?: string | null; recommended_action?: string | null; signals?: Record<string, unknown> | null; reason_codes?: string[] | null; provider?: string | null; model?: string | null; model_version?: string | null; analyzed_at?: string | null; }
export type DealStatus = 'open' | 'won' | 'lost' | 'closed';
export interface CrmDeal {
  id: string;
  tenant_id?: string;
  contact_id: string;
  lead_id?: string | null;
  title: string;
  value?: number | string | null;
  currency?: string | null;
  probability?: number | null;
  source?: string | null;
  notes?: string | null;
  status?: DealStatus | null;
  pipeline_stage_id: string;
  pipeline_stage?: string | null;
  stage_key?: string | null;
  expected_close_date?: string | null;
  owner_user_id?: string | null;
  owner_email?: string | null;
  contact_display_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface CrmDealList { items: CrmDeal[]; total: number; limit: number; offset: number; }
export interface CrmContact {
  id: string;
  tenant_id: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  deal_count?: number;
  deals?: CrmDeal[];
  deals_total?: number;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface CrmContactList { items: CrmContact[]; total: number; limit: number; offset: number; }
export interface CrmPipelineSummary extends CrmPipelineStage {
  deal_count: number;
  total_value: number | string;
}
export interface CrmOverviewMetrics {
  total_contacts: number;
  open_deals: number;
  pipeline_value: number | string;
  won_deals: number;
  won_revenue: number | string;
}
export interface CrmActivity { id: string; event_type: string; metadata?: Record<string, unknown> | null; created_at?: string | null; conversation_id?: string | null; actor_user_id?: string | null; actor_email?: string | null; }
export interface CrmLead {
  id: string; tenant_id: string; contact_id: string; company_id?: string | null; conversation_id?: string | null; source_channel?: string | null; status?: string | null; lead_score: number; temperature: LeadTemperature; intent?: string | null; service_interest?: string | null; budget_text?: string | null; normalized_budget?: number | string | null; budget_currency?: string | null; timeline?: string | null; assigned_user_id?: string | null; assigned_user_email?: string | null; pipeline_stage_id: string; pipeline_stage?: string | null; stage_key?: string | null; last_activity_at?: string | null; created_at?: string | null; updated_at?: string | null; first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null; phone?: string | null; language?: string | null; country?: string | null; company_name?: string | null; company_website?: string | null; company_industry?: string | null; company_country?: string | null; latest_analysis?: CrmAnalysis | null; deals?: CrmDeal[]; activities?: CrmActivity[];
}
export interface CrmLeadList { items: CrmLead[]; total: number; limit: number; offset: number; }
export interface CrmPipelineStage { id: string; tenant_id: string; stage_key: string; name: string; position: number; is_terminal?: boolean; }

export interface DashboardOverview {
  range_days: number;
  range: { start_date: string; end_date: string; previous_start_date: string; previous_end_date: string; };
  kpis: { total_conversations: number; new_leads: number; appointments: number | null; automations: number | null; satisfaction_rate: number | null; conversation_growth: number | null; };
  conversation_timeseries: Array<{ day: string; count: number }>;
  channel_distribution: Array<{ channel: ConversationChannelType; count: number }>;
  recent_conversations: Array<{ id: string; contact_name: string; customer_external_id?: string | null; channel_type: ConversationChannelType; last_message_preview?: string | null; last_activity_at?: string | null }>;
  ai_performance: { response_rate: number | null; average_response_time_ms: number | null; containment_rate: number | null; satisfaction_rate: number | null; };
  top_intents: Array<{ label: string; count: number }>;
  insights: { peak_hour: string | null; peak_hour_timezone: 'UTC'; best_channel: ConversationChannelType | null; most_active_assistant: { id: string; name: string; channel_types: ConversationChannelType[]; conversation_count: number } | null; growth: number | null; growth_status: 'AVAILABLE' | 'INSUFFICIENT_DATA'; };
  conversation_status_distribution: Array<{ status: ConversationStatus; count: number }>;
}
