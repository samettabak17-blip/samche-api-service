// Staging CRM fixture harness. Runtime API is never imported or modified.
export function fixtureNames(label) {
  return { tenantA: '__ci_crm_a_' + label, tenantB: '__ci_crm_b_' + label, agentEmail: 'ci-crm-agent-' + label + '@example.test' };
}
export function cleanupPlan(tenantIds) {
  return ['crm_lead_analyses','crm_activities','crm_deals','crm_leads','conversation_messages','detach_conversation_contacts','conversations','crm_contacts','crm_companies','knowledge_base_documents','tenant_channels','ai_assistants','crm_pipeline_stages','tenant_users'].map((step)=>({step,tenantIds}));
}
export async function cleanupFixtureRun({ client, tenantIds, names, agentId }) {
  const tenants=await client.query('SELECT id FROM tenants WHERE id = ANY($1::uuid[]) AND name = ANY($2::text[])',[tenantIds,[names.tenantA,names.tenantB]]);
  if(tenants.rowCount!==tenantIds.length) throw new Error('FIXTURE_SCOPE_MISMATCH');
  const q=async(sql)=>client.query(sql,[tenantIds]);
  await q('DELETE FROM crm_lead_analyses WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_activities WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_deals WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_leads WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[])');
  await q('UPDATE conversations SET contact_id = NULL WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_contacts WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_companies WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM knowledge_base_documents WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM ai_assistants WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])');
  await q('DELETE FROM tenant_users WHERE tenant_id = ANY($1::uuid[])');
  await client.query('DELETE FROM users WHERE id = $1 AND email = $2',[agentId,names.agentEmail]);
  await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[]) AND name = ANY($2::text[])',[tenantIds,[names.tenantA,names.tenantB]]);
}