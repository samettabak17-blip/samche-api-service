import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperateConversation } from '../services/conversation-permissions.js';

test('AGENT can take over an unassigned AI conversation and reply after assignment', () => {
  assert.equal(canOperateConversation({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'takeover', assignedAgentUserId: null, actorUserId: 'agent-1' }), true);
  assert.equal(canOperateConversation({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'send_message', assignedAgentUserId: 'agent-1', actorUserId: 'agent-1' }), true);
});

test('AGENT cannot control another operator conversation or administrative actions', () => {
  assert.equal(canOperateConversation({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'send_message', assignedAgentUserId: 'agent-2', actorUserId: 'agent-1' }), false);
  assert.equal(canOperateConversation({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'pause', assignedAgentUserId: 'agent-1', actorUserId: 'agent-1' }), false);
  assert.equal(canOperateConversation({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'close', assignedAgentUserId: 'agent-1', actorUserId: 'agent-1' }), false);
});

test('OWNER and tenant ADMIN can perform operational controls', () => {
  for (const actor of [
    { systemRole: 'OWNER', tenantRole: undefined },
    { systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
  ]) {
    for (const action of ['takeover', 'return_to_ai', 'pause', 'resume', 'close', 'send_message']) {
      assert.equal(canOperateConversation({ ...actor, action, assignedAgentUserId: 'other-agent', actorUserId: 'admin-1' }), true);
    }
  }
});
