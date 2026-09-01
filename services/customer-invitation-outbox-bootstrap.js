import { validateInvitationMailConfiguration } from './customer-invitation-mailer.js';
import { createCustomerInvitationOutboxWorker } from './customer-invitation-outbox-service.js';
import { createSmtpCustomerInvitationMailer } from './smtp-customer-invitation-mailer.js';

export function createCustomerInvitationOutboxStartup({
  database,
  environment = process.env,
  createMailer = createSmtpCustomerInvitationMailer,
  createWorker = createCustomerInvitationOutboxWorker,
  onStatus = () => {},
}) {
  let worker = null;
  let currentStatus = 'NOT_STARTED';
  const publish = (status) => {
    currentStatus = status;
    onStatus(status);
  };

  return {
    start() {
      if (worker) return worker;
      try {
        const config = validateInvitationMailConfiguration(environment);
        publish('STARTING');
        worker = createWorker({
          database,
          mailer: createMailer({ config }),
          envelopeKey: environment.INVITATION_ENVELOPE_ENCRYPTION_KEY,
          onStatus: ({ state, code }) => publish(code ? `${state}_${code}` : state),
        });
        return worker;
      } catch {
        publish('DISABLED');
        return null;
      }
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
