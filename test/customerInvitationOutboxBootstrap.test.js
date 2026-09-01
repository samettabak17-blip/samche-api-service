import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerInvitationOutboxStartup } from '../services/customer-invitation-outbox-bootstrap.js';

const validEnvironment = {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret',
  SMTP_FROM_EMAIL: 'support@samchecompany.com', SMTP_FROM_NAME: 'SamChe Support',
  PUBLIC_INVITATION_BASE_URL: 'https://dashboard.example.test',
  INVITATION_ENVELOPE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

test('post-migration onboarding startup starts exactly one durable outbox worker and exposes its running state', () => {
  const worker = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const starts = [];
  const startup = createCustomerInvitationOutboxStartup({
    database: {},
    environment: validEnvironment,
    createMailer: () => ({ sendInvitation: async () => undefined }),
    createWorker: (input) => { starts.push(input); input.onStatus({ state: 'RUNNING' }); return worker; },
  });

  assert.equal(startup.status(), 'NOT_STARTED');
  assert.equal(startup.start(), worker);
  assert.equal(startup.status(), 'RUNNING');
  assert.equal(starts.length, 1);
  assert.equal(startup.start(), worker);
  assert.equal(starts.length, 1);
  startup.stop();
  assert.equal(worker.stopCalls, 1);
});

test('post-migration onboarding startup reports a safe disabled state when mail preflight fails', () => {
  const startup = createCustomerInvitationOutboxStartup({
    database: {},
    environment: { ...validEnvironment, SMTP_PASSWORD: '' },
    createMailer: () => assert.fail('mailer must not be created'),
    createWorker: () => assert.fail('worker must not be started'),
  });

  assert.equal(startup.start(), null);
  assert.equal(startup.status(), 'DISABLED');
});

test('post-migration onboarding startup exposes a safe runtime worker error and stops the retained worker on shutdown', () => {
  const worker = { stopped: false, stop() { this.stopped = true; } };
  let workerInput;
  const startup = createCustomerInvitationOutboxStartup({
    database: {}, environment: validEnvironment,
    createMailer: () => ({ sendInvitation: async () => undefined }),
    createWorker: (input) => { workerInput = input; return worker; },
  });

  startup.start();
  workerInput.onStatus({ state: 'ERROR', code: 'OUTBOX_WORKER_FAILURE' });
  assert.equal(startup.status(), 'ERROR_OUTBOX_WORKER_FAILURE');
  startup.stop();
  assert.equal(worker.stopped, true);
});
