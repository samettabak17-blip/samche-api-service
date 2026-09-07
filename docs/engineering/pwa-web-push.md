# Dashboard Web Push

The authenticated Dashboard is an installable PWA. Phone notification delivery
is optional infrastructure: domain operations, human handoff, and durable jobs
remain authoritative when delivery is unavailable or fails.

## Staging configuration

Configure these server-only Render staging environment variable names:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

`VAPID_SUBJECT` is a VAPID contact subject such as a `mailto:` address or HTTPS
URL. The public key is delivered only through an authenticated tenant-scoped
capability endpoint. The private key must never be bundled into the Dashboard,
returned by an API, logged, or committed.

Generate a new key pair only in an approved operator terminal, then enter the
values directly in Render staging:

```powershell
npx web-push generate-vapid-keys
```

Do not paste the generated private key into source control, browser settings,
or support tickets.

## Operational contract

Push subscriptions are tenant/user/device scoped. Browser permission is
requested only after an explicit Dashboard action. Notification deep links are
validated internal Dashboard routes; navigation does not grant authorization.
Delivery is bounded and observational: expiration disables the affected
subscription, while a delivery failure never changes the originating domain
operation or human-handoff state.
