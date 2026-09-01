import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerInvitationOutboxStartup } from '../services/customer-invitation-outbox-bootstrap.js';

const validEnvironment = {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret',
  SMTP_FROM_EMAIL: 'support@samchecompany.com', SMTP_FROM_NAME: 'SamChe Support',
  PUBLIC_INVITATION_BASE_URL: 'https://dashboard.example.test',
  INVITATION_ENVELOPE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

test('post-migration onboarding startup completes SMTP preflight before starting exactly one durable outbox worker', async () => {
  const worker = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const starts = [];
  const startup = createCustomerInvitationOutboxStartup({
    database: {},
    environment: validEnvironment,
    createMailer: () => ({ verifyConnection: async () => undefined, sendInvitation: async () => undefined }),
    createWorker: (input) => { starts.push(input); input.onStatus({ state: 'RUNNING' }); return worker; },
  });

  assert.equal(startup.status(), 'NOT_STARTED');
  assert.equal(await startup.start(), worker);
  assert.equal(startup.status(), 'RUNNING');
  assert.equal(starts.length, 1);
  assert.equal(await startup.start(), worker);
  assert.equal(starts.length, 1);
  startup.stop();
  assert.equal(worker.stopCalls, 1);
});

test('post-migration onboarding startup reports a safe SMTP phase when non-sending transport preflight fails', async () => {
  const startup = createCustomerInvitationOutboxStartup({
    database: {},
    environment: validEnvironment,
    createMailer: () => ({ verifyConnection: async () => { const error = new Error('Greeting never received'); error.code = 'ETIMEDOUT'; error.command = 'CONN'; throw error; } }),
    createWorker: () => assert.fail('worker must not be started'),
  });

  assert.equal(await startup.start(), null);
  assert.equal(startup.status(), 'PREFLIGHT_SMTP_GREETING_TIMEOUT');
});

test('post-migration onboarding startup remains disabled when required SMTP configuration is invalid', async () => {
  const startup = createCustomerInvitationOutboxStartup({
    database: {},
    environment: { ...validEnvironment, SMTP_PASSWORD: '' },
    createMailer: () => assert.fail('mailer must not be created'),
    createWorker: () => assert.fail('worker must not be started'),
  });

  assert.equal(await startup.start(), null);
  assert.equal(startup.status(), 'DISABLED');
});

test('post-migration onboarding startup exposes a safe runtime worker error and stops the retained worker on shutdown', async () => {
  const worker = { stopped: false, stop() { this.stopped = true; } };
  let workerInput;
  const startup = createCustomerInvitationOutboxStartup({
    database: {}, environment: validEnvironment,
    createMailer: () => ({ verifyConnection: async () => undefined, sendInvitation: async () => undefined }),
    createWorker: (input) => { workerInput = input; return worker; },
  });

  await startup.start();
  workerInput.onStatus({ state: 'ERROR', code: 'OUTBOX_WORKER_FAILURE' });
  assert.equal(startup.status(), 'ERROR_OUTBOX_WORKER_FAILURE');
  startup.stop();
  assert.equal(worker.stopped, true);
});
