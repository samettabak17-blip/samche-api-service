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

export async function createFixtureLifecycle({ client, label, passwordHash }) {
  const names = fixtureNames(label);
  await client.query('BEGIN');
  try {
    const tenant = await client.query("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [names.tenantA]);
    const tenantId = tenant.rows[0].id;
    const admin = await client.query("INSERT INTO users (email,password_hash,system_role) VALUES ($1,$2,'CUSTOMER') RETURNING id", ['ci-crm-admin-' + label + '@example.test', passwordHash]);
    const agent = await client.query("INSERT INTO users (email,password_hash,system_role) VALUES ($1,$2,'CUSTOMER') RETURNING id", [names.agentEmail, passwordHash]);
    await client.query("INSERT INTO tenant_users (tenant_id,user_id,tenant_role) VALUES ($1,$2,'ADMIN'),($1,$3,'AGENT')", [tenantId,admin.rows[0].id,agent.rows[0].id]);
    const stage = await client.query("SELECT id FROM crm_pipeline_stages WHERE tenant_id=$1 AND stage_key='NEW_LEAD'",[tenantId]);
    const contact = await client.query("INSERT INTO crm_contacts (tenant_id,identity_kind,identity_hash,source) VALUES ($1,'ANONYMOUS_SESSION',$2,'CI') RETURNING id",[tenantId,'ci-'+label.padEnd(61,'0').slice(0,64)]);
    const lead = await client.query("INSERT INTO crm_leads (tenant_id,contact_id,pipeline_stage_id) VALUES ($1,$2,$3) RETURNING id",[tenantId,contact.rows[0].id,stage.rows[0].id]);
    const deal = await client.query("INSERT INTO crm_deals (tenant_id,lead_id,title,pipeline_stage_id) VALUES ($1,$2,'CI CRM fixture',$3) RETURNING id",[tenantId,lead.rows[0].id,stage.rows[0].id]);
    await client.query('COMMIT');
    return { tenantId, adminId: admin.rows[0].id, agentId: agent.rows[0].id, contactId: contact.rows[0].id, leadId: lead.rows[0].id, dealId: deal.rows[0].id, names };
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
}

export async function withFixtureLifecycle({ client, label, passwordHash, run }) {
  let fixture;
  try { fixture = await createFixtureLifecycle({ client, label, passwordHash }); return await run(fixture); }
  finally { if (fixture) await cleanupFixtureRun({ client, tenantIds:[fixture.tenantId], names:{tenantA:fixture.names.tenantA,tenantB:fixture.names.tenantA}, agentId:fixture.agentId }).catch(()=>{}); }
}
