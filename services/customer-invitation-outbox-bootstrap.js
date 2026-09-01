import { validateInvitationMailConfiguration } from './customer-invitation-mailer.js';
import { createCustomerInvitationOutboxWorker } from './customer-invitation-outbox-service.js';
import { classifySafeSmtpFailure, createSmtpCustomerInvitationMailer } from './smtp-customer-invitation-mailer.js';

export function createCustomerInvitationOutboxStartup({
  database,
  environment = process.env,
  createMailer = createSmtpCustomerInvitationMailer,
  createWorker = createCustomerInvitationOutboxWorker,
  onStatus = () => {},
}) {
  let worker = null;
  let startPromise = null;
  let currentStatus = 'NOT_STARTED';
  const publish = (status) => {
    currentStatus = status;
    onStatus(status);
  };

  return {
    async start() {
      if (worker) return worker;
      if (startPromise) return startPromise;
      startPromise = (async () => {
        let config;
        try {
          config = validateInvitationMailConfiguration(environment);
        } catch {
          publish('DISABLED');
          return null;
        }
        try {
        publish('PREFLIGHTING');
        const mailer = createMailer({ config });
        await mailer.verifyConnection();
        publish('STARTING');
        worker = createWorker({
          database,
          mailer,
          envelopeKey: environment.INVITATION_ENVELOPE_ENCRYPTION_KEY,
          onStatus: ({ state, code }) => publish(code ? `${state}_${code}` : state),
        });
        return worker;
        } catch (error) {
          publish(`PREFLIGHT_${classifySafeSmtpFailure(error)}`);
          return null;
        } finally {
          startPromise = null;
        }
      })();
      return startPromise;
    },
    stop() {
      worker?.stop();
      worker = null;
    },
    status() {
      return currentStatus;
    },
  };
}
