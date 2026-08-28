# Knowledge Authority Epoch Design

## Status and scope

This design addresses the proven Task 6 revoked-knowledge history leak. It does not change provider selection, channel routing, handoff, delivery, retrieval ranking, generated persona semantics, or production configuration.

The security boundary is tenant-scoped and Assistant-scoped. The first implementation uses a coarse Assistant-level epoch because existing conversation messages do not carry source-level provenance. A knowledge authority change invalidates provider history for that Assistant, while keeping every database message visible to Live Inbox and audit consumers.

## Proven failure

Current semantic retrieval and current supplementary knowledge correctly exclude an unassigned Task 6 source. Older CUSTOMER and ASSISTANT messages still contain source-only facts and are copied into the provider prompt. The model can therefore repeat revoked facts from history even when current knowledge is empty.

The provider-authority decision must be enforced structurally. Prompt wording alone is not an authorization boundary.

## Considered approaches

### Selected: Assistant-level monotonically increasing epoch

Each `ai_assistants` row owns a `knowledge_authority_version`. Provider-eligible conversation messages are stamped with the Assistant ID and current version. Knowledge authority changes atomically increment the affected Assistant version. Provider history includes only messages stamped with the current Assistant and current version.

This is fail-closed, testable, and compatible with existing storage. It deliberately resets all model-context continuity for one Assistant when any authority-bearing source or ACTIVE runtime artifact changes.

### Rejected for this increment: source-level message provenance

Source-level filtering would retain unrelated history, but current messages do not record which source/chunk contributed to an answer. Retrofitting precise multi-source provenance across supplementary, semantic, generated artifacts, USER messages, and three channels is a larger subsystem. Guessing provenance from text is not a security boundary.

### Rejected: stronger prompt instructions or marker redaction

The current prompt already labels history untrusted, yet Gemini repeats old facts. Text matching cannot reliably identify paraphrases and would couple authorization to document content.

## Schema

Add restart-safe migration `024_knowledge_authority_epoch.sql`.

### Assistant authority state

Add to `ai_assistants`:

- `knowledge_authority_version BIGINT NOT NULL DEFAULT 1`
- constraint ensuring the value is greater than zero

The existing composite `(id, tenant_id)` relationship remains authoritative. No global or tenant-only epoch is introduced.

### Message provenance

Add to `conversation_messages`:

- `authority_assistant_id UUID NULL`
- `knowledge_authority_version BIGINT NULL`
- nullable foreign key `authority_assistant_id -> ai_assistants(id)` with `ON DELETE SET NULL`; provider eligibility still requires the message tenant, conversation tenant, and Assistant tenant to match
- positive-version check when populated
- provider-history lookup index on `(tenant_id, conversation_id, authority_assistant_id, knowledge_authority_version, created_at DESC, id DESC)`

Null Assistant provenance or a null/mismatched version means “not authorized for model history.” It does not hide or delete the message from Live Inbox. If an Assistant is deleted, the Assistant reference becomes null while the historical numeric version may remain for audit; such a row is never provider-eligible.

### Backfill

Existing `conversation_messages` remain null-provenance. They stay visible in all UI/audit/history APIs but are excluded from provider context after deployment. This fail-closed reset is intentional: historical rows cannot be reliably attributed to an Assistant authority version after the fact.

Migration statements use `ADD COLUMN IF NOT EXISTS`, catalog-guarded constraints, `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION`. The repository reruns every SQL migration at startup, so trigger creation uses `DROP TRIGGER IF EXISTS` followed by deterministic recreation. Data backfill is monotonic and does not rewrite message content.

## Atomic epoch changes

PostgreSQL triggers enforce authority changes at the tables that define runtime truth. This avoids missed application paths and makes the state change atomic with the underlying mutation.

### Source assignment

`knowledge_source_assistants` INSERT and DELETE increment only the referenced `(tenant_id, assistant_id)` version. `ON CONFLICT DO NOTHING` produces no trigger and therefore no false bump. Re-assignment increments again; old history never becomes current merely because the same source returns.

### Task 6 source lifecycle

For a Task 6 source (`content_hash IS NOT NULL`), changes to runtime eligibility increment every currently assigned Assistant:

- `enabled`
- `status`
- `processing_status`
- `indexing_status`

This covers archive, disable, re-index leaving READY, processing failure, and indexing returning to READY. Chunk writes alone do not bump: runtime eligibility changes only when the source row reaches/leaves its authoritative READY state.

### Canonical Candidate knowledge

Candidate approval creates a Task 6 source and assignment through existing paths. Assignment triggers an epoch change; the source transition to READY triggers another. The candidate's APPROVED label alone does not affect runtime authority.

### ACTIVE configuration

Changing `ai_assistants.active_configuration_version_id` increments that Assistant's epoch. Approval, review, generation, and rejection do not increment because `APPROVED != ACTIVE` and those states do not change runtime authority.

### ACTIVE Business Profile

Changing `business_profiles.active_version_id` increments all active Assistants in that tenant. Runtime configuration resolution joins the tenant ACTIVE profile for each Assistant, so the profile pointer is a tenant artifact consumed through Assistant-scoped runtime context. Approval alone does not increment.

### True legacy Knowledge Base

Legacy rows are identified by `content_hash IS NULL`, matching the existing compatibility boundary. INSERT, DELETE, or changes to `assistant_id`, `content`, `status`, or `enabled` increment:

- the specifically assigned legacy Assistant when `assistant_id` is non-null;
- all active Assistants in the tenant when a legacy row is global (`assistant_id IS NULL`).

This preserves legacy inclusion rules while preventing revoked legacy facts from surviving through provider history. Read-only listing and Live Inbox behavior do not change.

## Message stamping

The current authority snapshot is resolved through the conversation's channel integration:

`conversation -> tenant_channels -> channel_integrations -> ai_assistants`

The lookup requires matching tenant, enabled integration, active channel, and active Assistant. A mapped provider-history message is stamped with the resolved Assistant ID/version in the same transaction that inserts the message.

WhatsApp CUSTOMER and ASSISTANT messages are stamped. AGENT and lifecycle-generated messages are also stamped when the conversation has one valid mapped Assistant so Return to AI has an explicit boundary. Messages without one unambiguous active mapping remain null-provenance and are never supplied as model history.

Provider delivery correlation updates do not alter provenance.

## Provider history filtering

### WhatsApp

`persistWhatsAppInbound` resolves the Assistant authority version before inserting the CUSTOMER message. It loads the display/audit history exactly as before only where required by UI APIs; the provider-history query is separate and requires:

- matching tenant and conversation;
- `authority_assistant_id = current assistant`;
- `knowledge_authority_version = current version`.

It retains the existing bounded ordering and message limit. The current CUSTOMER message is not duplicated in history and `Current customer message`.

After an epoch change, all older CUSTOMER, ASSISTANT, AGENT, and SYSTEM messages remain in the database but none are sent to Gemini. Messages created after the change establish new continuity.

### AI Guide and signed Web Chat

Both mapped runtimes maintain process-memory histories that can reproduce the same class of leak. For mapped integrations, memory entries are stamped with Assistant ID/version and filtered to the current epoch before provider calls. A changed epoch cannot reactivate old entries. Unmapped legacy sessions keep their existing behavior because they have no tenant/Assistant Task 6 authority.

This increment does not redesign either channel or change its provider.

## Human handoff

Human Take Over continues to suppress AI. Live Inbox and audit queries continue returning all messages regardless of provenance.

On Return to AI:

- messages from the current epoch may be supplied as bounded history;
- messages from an older epoch are excluded;
- a lifecycle or AGENT message that cannot resolve one active Assistant remains visible but is excluded from provider history.

Authority changes while a conversation is in HUMAN mode therefore take effect when AI resumes without deleting operator history.

## Isolation and concurrency

Every epoch mutation predicates on both `tenant_id` and `assistant_id`. Cross-tenant IDs cannot increment or stamp another tenant's state. Different Assistants in one tenant own independent versions except a tenant ACTIVE Business Profile change, which intentionally increments each active Assistant because each consumes that profile.

Epoch increments use `knowledge_authority_version = knowledge_authority_version + 1` inside the same database transaction as the authority mutation. Concurrent authority changes serialize through row updates and cannot reuse an old value.

A provider turn carries the version resolved during inbound persistence. If authority changes before assistant-response persistence, that response must not be stamped as current authority: persistence compares the captured version with the current Assistant version and suppresses stale provider delivery through the existing handling-version-style guard.

## API and UI compatibility

No response payload exposes the epoch. Dashboard source assignment contracts remain unchanged. Legacy Knowledge Base and Live Inbox APIs still return complete message history. No database ID, channel mapping, provider, or customer-visible Assistant name changes.

## Tests and acceptance

Tests use real PostgreSQL where SQL behavior matters and pure context tests for prompt construction:

1. assigned READY source is available in current retrieval/supplementary context;
2. unassignment removes both current knowledge paths and increments only the mapped Assistant;
3. old ASSISTANT message remains queryable by Live Inbox but is absent from provider history;
4. old CUSTOMER marker is absent from provider history;
5. fresh current-epoch history is marker-free;
6. re-assignment increments again, does not revive old history, and permits new current retrieval;
7. archive increments and excludes old history;
8. different Assistant version/history remains isolated;
9. different tenant remains isolated;
10. unrelated source revocation resets the affected Assistant's entire provider history—an explicit conservative trade-off;
11. all Live Inbox messages remain visible;
12. Human Take Over / Return to AI stays green;
13. true legacy global and Assistant-specific Knowledge Base behavior stays green;
14. media, attachments, voice, delivery states, and provider correlation stay green;
15. ACTIVE profile/configuration pointer changes increment; APPROVED-only changes do not;
16. migration can run twice and partially pre-existing columns/constraints/triggers converge safely.

Staging manual acceptance remains mandatory. Automated success cannot mark Task 6 GREEN.

## Known trade-off

Any authority change for one Assistant invalidates that Assistant's complete provider-context history, including unrelated conversational continuity. The user-visible transcript is unaffected. This is the safe initial boundary because source-specific provenance does not exist; retaining selectively guessed history could re-authorize revoked facts. A future source-level provenance design may narrow invalidation without weakening this contract.
