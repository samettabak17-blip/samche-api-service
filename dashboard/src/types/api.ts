[object Object]
export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'UNQUALIFIED';

export interface CrmAnalysis {
  id?: string;
  analysis_hash?: string;
  summary?: string | null;
  recommended_action?: string | null;
  signals?: Record<string, unknown> | null;
  reason_codes?: string[] | null;
  provider?: string | null;
  model?: string | null;
  model_version?: string | null;
  analyzed_at?: string | null;
}

export interface CrmDeal {
  id: string;
  title: string;
  value?: number | string | null;
  currency?: string | null;
  status?: string | null;
  pipeline_stage_id?: string | null;
  expected_close_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CrmActivity {
  id: string;
  event_type: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  conversation_id?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
}

export interface CrmLead {
  id: string;
  tenant_id: string;
  contact_id: string;
  company_id?: string | null;
  conversation_id?: string | null;
  source_channel?: string | null;
  status?: string | null;
  lead_score: number;
  temperature: LeadTemperature;
  intent?: string | null;
  service_interest?: string | null;
  budget_text?: string | null;
  normalized_budget?: number | string | null;
  budget_currency?: string | null;
  timeline?: string | null;
  assigned_user_id?: string | null;
  assigned_user_email?: string | null;
  pipeline_stage_id: string;
  pipeline_stage?: string | null;
  stage_key?: string | null;
  last_activity_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  country?: string | null;
  company_name?: string | null;
  company_website?: string | null;
  company_industry?: string | null;
  company_country?: string | null;
  latest_analysis?: CrmAnalysis | null;
  deals?: CrmDeal[];
  activities?: CrmActivity[];
}

export interface CrmLeadList {
  items: CrmLead[];
  total: number;
  limit: number;
  offset: number;
}

export interface CrmPipelineStage {
  id: string;
  tenant_id: string;
  stage_key: string;
  name: string;
  position: number;
  is_terminal?: boolean;
}
