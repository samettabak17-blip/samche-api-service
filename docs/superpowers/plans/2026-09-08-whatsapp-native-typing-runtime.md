# WhatsApp Native Typing Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real inbound AI path await a valid Meta typing indicator and route typing and delivery through the canonical channel phone-number ID.

**Architecture:** The transport accepts an explicit canonical phone-number ID and server-only token. A small lifecycle boundary called by the mounted webhook owns eligibility, awaited typing, safe diagnostics, pacing, and outbound continuation so tests exercise the same orchestration path as staging.

**Tech Stack:** Node.js ES modules, Express, Axios, PostgreSQL, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-08-whatsapp-channel-typing-auth-acceptance-repair-design.md`

## Global Constraints

- Send the official `typing_indicator: { type: 'text' }` payload against the inbound wamid.
- Preserve 1500 ms minimum compose window and 2500 ms maximum artificial delay.
- Never log tokens, credentials, customer phone numbers, contents, or full Meta payloads.
- Human ownership, handoff, duplicate delivery, and AI suppression never emit typing.

---

### Task 1: Correct transport payload and per-channel routing

**Files:**
- Modify: `services/whatsapp-delivery-service.js`
- Modify: `test/whatsappNativeTypingAndPacing.test.js`

**Interfaces:**
- Produces: `sendWhatsAppTypingIndicator({ phoneNumberId, incomingMessageId, ... })` returning provider status and `deliverWhatsAppText` that trusts its explicit canonical channel ID rather than global phone identity.

- [ ] **Step 1: Change tests to require the real Meta payload and multi-channel behavior**

Add `typing_indicator: { type: 'text' }`, assert HTTP status capture, require an explicit phone ID, and prove two canonical phone IDs can share the same server-only transport token without global-ID mismatch.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `node --test test/whatsappNativeTypingAndPacing.test.js`.

- [ ] **Step 3: Implement the minimal transport correction**

Remove `WHATSAPP_PHONE_ID` as an identity check, keep `WHATSAPP_TOKEN` required, target only the explicit phone ID, add the typing field, and preserve safe provider diagnostics.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run `node --test test/whatsappNativeTypingAndPacing.test.js`.

### Task 2: Mounted webhook lifecycle and observability

**Files:**
- Create: `services/whatsapp-ai-response-lifecycle-service.js`
- Modify: `app.js`
- Create: `test/whatsappWebhookTypingRuntimePath.test.js`

**Interfaces:**
- Produces: `beginWhatsAppAiResponseLifecycle(input)` and `completeWhatsAppAiResponseLifecycle(input)` called directly by the mounted webhook.

- [ ] **Step 1: Write the failing orchestration test**

Drive the same lifecycle functions used by `app.js` with an inbound webhook scope and assert exact order: persisted canonical scope, awaited typing request, runtime/model callback, pacing, outbound continuation. Assert failure logs contain safe category/status and outbound still proceeds.

- [ ] **Step 2: Run the path test and confirm RED**

Run `node --test test/whatsappWebhookTypingRuntimePath.test.js`.

- [ ] **Step 3: Implement and wire the lifecycle boundary**

Validate webhook phone ID equals canonical integration phone ID, log attempted/accepted/failed with fingerprints and short IDs, await transport, and use the completion wrapper for every eligible AI response branch.

- [ ] **Step 4: Run the path test and confirm GREEN**

Run the focused path test and inspect event order.

### Task 3: Canonical outbound phone routing

**Files:**
- Modify: `app.js`
- Modify: affected WhatsApp delivery tests in `test/`.

**Interfaces:**
- Consumes: `whatsappInbox.integration.external_channel_id` and persisted channel external ID for workers.

- [ ] **Step 1: Write failing outbound tests**

Cover AI reply, resource acknowledgement, human-support acknowledgement, contextual follow-up, and lifecycle notification routing with a non-global canonical phone ID.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run the affected WhatsApp assistant, handoff, follow-up, and delivery tests.

- [ ] **Step 3: Thread canonical phone ID through each send path**

Change send helpers to require `phoneNumberId`, include channel external ID in worker queries, and reject missing canonical routing rather than falling back to a global phone ID.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same tests plus duplicate webhook, delivery status, takeover, and Return to AI regressions.