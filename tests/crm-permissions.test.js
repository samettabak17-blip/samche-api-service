import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperateCrmLead, canWriteCrm } from '../services/crm-permissions.js';

test('OWNER and tenant ADMIN have full CRM write access', () => {
  assert.equal(canWriteCrm({ systemRole: 'OWNER', tenantRole: undefined }), true);
  assert.equal(canWriteCrm({ systemRole: 'CUSTOMER', tenantRole: 'ADMIN' }), true);
});

test('AGENT is read-only except assigned lead operational stage update', () => {
  const agent = { systemRole: 'CUSTOMER', tenantRole: 'AGENT', userId: 'agent-1' };
  assert.equal(canWriteCrm(agent), false);
  assert.equal(canOperateCrmLead({ ...agent, action: 'stage', assignedUserId: 'agent-1' }), true);
  assert.equal(canOperateCrmLead({ ...agent, action: 'stage', assignedUserId: 'agent-2' }), false);
  assert.equal(canOperateCrmLead({ ...agent, action: 'rescore', assignedUserId: 'agent-1' }), false);
});

test('unknown system roles cannot operate CRM records', () => {
  assert.equal(canWriteCrm({ systemRole: 'UNKNOWN', tenantRole: 'ADMIN' }), false);
  assert.equal(canOperateCrmLead({ systemRole: 'UNKNOWN', tenantRole: 'ADMIN', userId: 'x', action: 'stage', assignedUserId: 'x' }), false);
});

