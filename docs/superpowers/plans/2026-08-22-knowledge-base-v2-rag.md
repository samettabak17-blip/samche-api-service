# SamChe Knowledge Base V2 + RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text-only tenant knowledge with secure document ingestion, asynchronous processing, tenant-scoped pgvector retrieval, and assistant RAG grounding.

**Architecture:** A private S3-compatible storage adapter keeps binaries outside PostgreSQL. PostgreSQL stores tenant-isolated metadata, durable processing jobs, chunks, profile suggestions, and pgvector embeddings. A Render background worker processes documents asynchronously and a shared runtime service retrieves only assistant-authorized tenant chunks.

**Tech Stack:** Node.js/Express, PostgreSQL with pgvector, Cloudflare R2 through AWS S3 SDK, Render Background Worker, OpenAI embeddings, pdfjs-dist, mammoth, React/TypeScript/TanStack Query.

**Spec:** Chat-approved Knowledge Base V2 + RAG implementation plan (2026-08-22).

## Global Constraints

- Work only on `staging`; never modify `main` or production.
- Preserve legacy `/api/chat`, `/chat`, and `/webhook` behavior.
- Private object storage only; never expose storage or provider credentials to the browser.
- OWNER and tenant ADMIN write; AGENT remains read-only.
- Every resource lookup and retrieval query must filter by tenant before ranking.
- Do not make uploaded text system instructions or automatically modify assistant prompts.
- Do not run migration 003 unless Stage 0 confirms pgvector availability.

---

### Task 1: Stage 0 platform preflight

**Files:**
- Create: `.github/workflows/staging-kb-v2-preflight.yml`
- Create: `docs/knowledge-base-v2-staging-prerequisites.md`

**Interfaces:**
- Produces a staging-only Actions log with PostgreSQL version, installed vector extension state, vector availability, and non-secret R2/worker configuration presence.

- [ ] Query `pg_extension` and `pg_available_extensions` for `vector` without logging the database URL.
- [ ] Record whether a private R2 bucket configuration and separate Render worker are available.
- [ ] Stop before migration if `vector` is unavailable.
- [ ] Commit: `chore(staging): add knowledge base v2 preflight`.

### Task 2: Storage and durable processing schema

**Files:**
- Create: `migrations/003_knowledge_base_v2.sql`
- Modify: `migrations/runMigrations.js`
- Create: `services/knowledge/processing-queue.js`

**Interfaces:**
- `enqueueKnowledgeJob({ tenantId, documentId, kind }): Promise<void>`
- `claimKnowledgeJob(workerId): Promise<KnowledgeJob | null>`

- [ ] Add `knowledge_documents`, `knowledge_document_assistants`, `knowledge_document_chunks`, `knowledge_processing_jobs`, profile suggestion tables, composite FKs, status checks and tenant indexes.
- [ ] Backfill legacy `knowledge_base_documents` records as `MANUAL_TEXT` without deleting the original table.
- [ ] Use `FOR UPDATE SKIP LOCKED` leases and bounded retry/backoff.
- [ ] Commit: `feat(knowledge): add v2 persistence and queue`.

### Task 3: Private object storage and upload API

**Files:**
- Create: `services/storage/object-storage.js`
- Create: `services/storage/r2-storage.js`
- Create: `middleware/knowledge-upload.js`
- Modify: `routes/dashboardRoutes.js`
- Modify: `app.js`

**Interfaces:**
- `objectStorage.put({ key, stream, contentType }): Promise<void>`
- `objectStorage.getStream(key): Promise<Readable>`
- `objectStorage.delete(key): Promise<void>`
- `POST /api/v1/tenants/:tenantId/knowledge-base/uploads`

- [ ] Stream authenticated PDF, DOCX and TXT uploads to private storage after filename, size and content-type checks.
- [ ] Enforce 25 MB maximum and tenant/user upload rate limits.
- [ ] Use tenant-generated object keys and create a queued document record before returning HTTP 202.
- [ ] Implement authorized metadata/list/detail/delete/reprocess/download endpoints.
- [ ] Commit: `feat(knowledge): add private document upload API`.

### Task 4: Extraction, chunking, embeddings and worker

**Files:**
- Create: `services/knowledge/extract.js`
- Create: `services/knowledge/chunk.js`
- Create: `services/knowledge/embeddings.js`
- Create: `workers/knowledge-worker.js`
- Modify: `package.json`

**Interfaces:**
- `extractDocument({ mimeType, stream }): Promise<string>`
- `chunkText(text): Array<{ index, content, tokenCount }>`
- `embedTexts(texts): Promise<number[][]>`
- `processKnowledgeJob(job): Promise<void>`

- [ ] Extract text with pdfjs-dist, mammoth, and UTF-8 TXT support; reject corrupt or empty files.
- [ ] Normalize and split text into bounded overlapping chunks with hard per-document limits.
- [ ] Store embeddings and update only successful jobs to `READY`.
- [ ] Mark extraction/provider failures as `FAILED` or retryable without logging document body.
- [ ] Commit: `feat(knowledge): process and index tenant documents`.

### Task 5: Tenant RAG runtime and profile suggestions

**Files:**
- Create: `services/knowledge/retrieval.js`
- Create: `services/knowledge/profile-analysis.js`
- Create: `services/tenant-assistant-runtime.js`
- Create: `routes/tenantAssistantRuntimeRoutes.js`
- Modify: `app.js`

**Interfaces:**
- `retrieveKnowledge({ tenantId, assistantId, query, limit }): Promise<RetrievedChunk[]>`
- `answerTenantAssistant({ tenantId, assistantId, message }): Promise<AssistantAnswer>`
- `POST /api/v1/tenants/:tenantId/assistants/:assistantId/preview`

- [ ] Filter tenant and assistant scope before pgvector cosine ranking.
- [ ] Insert retrieved chunks as explicitly delimited untrusted context below platform and assistant instructions.
- [ ] Add a controlled ADMIN preview endpoint for live RAG verification; do not modify legacy chat routes.
- [ ] Generate DRAFT business-profile suggestions only; applying a suggestion is an explicit ADMIN action.
- [ ] Commit: `feat(knowledge): add tenant-scoped RAG runtime`.

### Task 6: Dashboard Knowledge Base V2

**Files:**
- Modify: `dashboard/src/features/knowledge-base/knowledge-base-page.tsx`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/types/api.ts`
- Create: `dashboard/src/features/knowledge-base/upload-dropzone.tsx`
- Create: `dashboard/src/features/knowledge-base/document-status.tsx`

**Interfaces:**
- Tenant-scoped TanStack keys for documents, document detail, and processing status.

- [ ] Replace the primary textarea flow with drag/drop, browse, multi-file assistant association and truthful progress/status states.
- [ ] Keep manual text as a secondary action.
- [ ] Show view, download when allowed, reprocess and delete; hide mutation UI for AGENT.
- [ ] Poll only processing documents and invalidate only active tenant keys.
- [ ] Commit: `feat(dashboard): add knowledge base v2 UX`.

### Task 7: Tests and staging verification

**Files:**
- Create: `test/knowledge-v2.test.js`
- Create: `test/fixtures/knowledge/*`
- Modify: `.github/workflows/staging-dashboard-integration.yml`
- Modify: dashboard Vitest files

- [ ] Add PDF, DOCX, TXT, invalid MIME, oversize, corrupt, status transition, deletion cleanup and rate-limit tests.
- [ ] Verify ADMIN write, AGENT 403, cross-tenant isolation, same-tenant assistant associations, chunk/vector cleanup and retrieval isolation.
- [ ] Verify relevant RAG retrieval, no-result retrieval, and injection-resistant context behavior.
- [ ] Run dashboard tests, TypeScript, build, backend tests, staging worker processing, and legacy regressions.
- [ ] Commit: `test(knowledge): verify v2 ingestion and retrieval`.

