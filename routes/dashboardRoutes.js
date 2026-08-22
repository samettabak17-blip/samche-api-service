import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken, requireTenantAccess, requireTenantAdmin } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';

const router = express.Router();
router.use(authenticateToken);

const page = (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    res.status(400).json({ error: 'limit must be 1-100 and offset must be non-negative' });
    return null;
  }
  return { limit, offset };
};
const tenant = (req, res) => {
  if (!isValidUUID(req.params.tenantId)) { res.status(400).json({ error: 'Invalid tenant ID' }); return null; }
  return req.verified_tenant_id;
};
const channelBody = async (req, res) => {
  const { channel_type, display_name, external_channel_id = null, assistant_id = null, status = 'active' } = req.body;
  if (!['WEB_CHAT','WHATSAPP'].includes(channel_type) || typeof display_name !== 'string' || !display_name.trim() || !['active','inactive'].includes(status)) {
    res.status(400).json({ error: 'Invalid channel body' }); return null;
  }
  if (assistant_id && !isValidUUID(assistant_id)) { res.status(400).json({ error: 'Invalid assistant ID' }); return null; }
  if (assistant_id) {
    const a = await query('SELECT id FROM ai_assistants WHERE id=$1 AND tenant_id=$2', [assistant_id, req.verified_tenant_id]);
    if (!a.rowCount) { res.status(400).json({ error: 'Assistant must belong to this tenant' }); return null; }
  }
  return [channel_type, display_name.trim(), external_channel_id || null, assistant_id, status];
};
router.get('/:tenantId/team', requireTenantAccess, async (req,res)=> {
  if(!tenant(req,res)) return;
  const r=await query('SELECT u.id,u.email,u.system_role,tu.tenant_role,tu.created_at FROM tenant_users tu JOIN users u ON u.id=tu.user_id WHERE tu.tenant_id=$1 ORDER BY tu.created_at',[req.verified_tenant_id]);
  res.json(r.rows);
});
router.get('/:tenantId/channels', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;

  try {
    const result = await query(
      'SELECT id,tenant_id,assistant_id,channel_type,display_name,external_channel_id,status,created_at,updated_at FROM tenant_channels WHERE tenant_id=$1 ORDER BY created_at DESC',
      [req.verified_tenant_id]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Fetch tenant channels error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.post('/:tenantId/channels', requireTenantAccess, requireTenantAdmin, async(req,res)=>{if(!tenant(req,res))return; const b=await channelBody(req,res);if(!b)return;try{const r=await query('INSERT INTO tenant_channels(channel_type,display_name,external_channel_id,assistant_id,status,tenant_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[...b,req.verified_tenant_id]);res.status(201).json(r.rows[0]);}catch(e){res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'Channel already exists':'Server error'});}});
router.get('/:tenantId/channels/:channelId', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.channelId))return res.status(400).json({error:'Invalid channel ID'});const r=await query('SELECT * FROM tenant_channels WHERE id=$1 AND tenant_id=$2',[req.params.channelId,req.verified_tenant_id]);if(!r.rowCount)return res.status(404).json({error:'Channel not found'});res.json(r.rows[0]);});
router.put('/:tenantId/channels/:channelId', requireTenantAccess, requireTenantAdmin, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.channelId))return res.status(400).json({error:'Invalid channel ID'});const b=await channelBody(req,res);if(!b)return;const r=await query('UPDATE tenant_channels SET channel_type=$1,display_name=$2,external_channel_id=$3,assistant_id=$4,status=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND tenant_id=$7 RETURNING *',[...b,req.params.channelId,req.verified_tenant_id]);if(!r.rowCount)return res.status(404).json({error:'Channel not found'});res.json(r.rows[0]);});
router.delete('/:tenantId/channels/:channelId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res) || !isValidUUID(req.params.channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }

  const channelId = req.params.channelId;
  const tenantId = req.verified_tenant_id;
  const conflict = { error: 'Channel cannot be deleted while conversations are linked to it' };

  try {
    const linkedConversation = await query(
      'SELECT 1 FROM conversations WHERE channel_id = $1 AND tenant_id = $2 LIMIT 1',
      [channelId, tenantId]
    );
    if (linkedConversation.rowCount > 0) {
      return res.status(409).json(conflict);
    }

    const result = await query(
      'DELETE FROM tenant_channels WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [channelId, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Channel not found' });
    return res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    if (error?.code === '23503') return res.status(409).json(conflict);
    console.error('Delete tenant channel error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.get('/:tenantId/conversations', requireTenantAccess, async(req,res)=>{if(!tenant(req,res))return;const p=page(req,res);if(!p)return;const r=await query('SELECT * FROM conversations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[req.verified_tenant_id,p.limit,p.offset]);res.json(r.rows);});
router.get('/:tenantId/conversations/:conversationId', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.conversationId))return res.status(400).json({error:'Invalid conversation ID'});const r=await query('SELECT * FROM conversations WHERE id=$1 AND tenant_id=$2',[req.params.conversationId,req.verified_tenant_id]);if(!r.rowCount)return res.status(404).json({error:'Conversation not found'});res.json(r.rows[0]);});
router.get('/:tenantId/conversations/:conversationId/messages', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.conversationId))return res.status(400).json({error:'Invalid conversation ID'});const p=page(req,res);if(!p)return;const r=await query('SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id WHERE m.conversation_id=$1 AND m.tenant_id=$2 ORDER BY m.created_at ASC LIMIT $3 OFFSET $4',[req.params.conversationId,req.verified_tenant_id,p.limit,p.offset]);res.json(r.rows);});
const kbBody=async(req,res)=>{const{title,content,assistant_id=null,status='active'}=req.body;if(typeof title!=='string'||!title.trim()||typeof content!=='string'||!content.trim()||!['active','inactive'].includes(status)){res.status(400).json({error:'Invalid knowledge document body'});return null;}if(assistant_id&&(!isValidUUID(assistant_id)||(await query('SELECT id FROM ai_assistants WHERE id=$1 AND tenant_id=$2',[assistant_id,req.verified_tenant_id])).rowCount===0)){res.status(400).json({error:'Assistant must belong to this tenant'});return null;}return[title.trim(),content.trim(),assistant_id,status];};
router.get('/:tenantId/knowledge-base',requireTenantAccess,async(req,res)=>{if(!tenant(req,res))return;const r=await query('SELECT * FROM knowledge_base_documents WHERE tenant_id=$1 ORDER BY created_at DESC',[req.verified_tenant_id]);res.json(r.rows);});
router.post('/:tenantId/knowledge-base',requireTenantAccess,requireTenantAdmin,async(req,res)=>{if(!tenant(req,res))return;const b=await kbBody(req,res);if(!b)return;const r=await query('INSERT INTO knowledge_base_documents(title,content,assistant_id,status,tenant_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[...b,req.verified_tenant_id]);res.status(201).json(r.rows[0]);});
for (const method of ['get','put','delete']) router[method]('/:tenantId/knowledge-base/:documentId',requireTenantAccess,...(method==='get'?[]:[requireTenantAdmin]),async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.documentId))return res.status(400).json({error:'Invalid document ID'});if(method==='get'){const r=await query('SELECT * FROM knowledge_base_documents WHERE id=$1 AND tenant_id=$2',[req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json(r.rows[0]):res.status(404).json({error:'Knowledge document not found'});}if(method==='delete'){const r=await query('DELETE FROM knowledge_base_documents WHERE id=$1 AND tenant_id=$2 RETURNING id',[req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json({message:'Knowledge document deleted successfully'}):res.status(404).json({error:'Knowledge document not found'});}const b=await kbBody(req,res);if(!b)return;const r=await query('UPDATE knowledge_base_documents SET title=$1,content=$2,assistant_id=$3,status=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND tenant_id=$6 RETURNING *',[...b,req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json(r.rows[0]):res.status(404).json({error:'Knowledge document not found'});});
export default router;