# WhatsApp Semantic Candidates Design

## Goal

Convert image-extracted conversation segments into reviewable, durable tenant knowledge without treating a BUSINESS speaker as automatic business truth.

## Decision

Introduce a SamChe-owned semantic adapter with a provider-independent structured output. It classifies BUSINESS segments into `DURABLE_BUSINESS_FACT`, `ASSISTANT_BEHAVIOR_OR_QUALIFICATION`, `CUSTOMER_SPECIFIC_CONTEXT`, `TRANSIENT_CONVERSATION`, `DURABLE_POLICY_OR_COMMITMENT_CANDIDATE`, or `UNSAFE_OR_AMBIGUOUS` and produces only decontextualized canonical text for durable facts. CUSTOMER and UNKNOWN segments never create durable candidates.

The image candidate service persists only durable facts as `NEEDS_REVIEW` `knowledge_candidates`; raw redacted segment text remains provenance evidence. Semantic classification and canonical text are stored with image evidence so each candidate is auditable. Qualification output is not auto-promoted to the existing assistant recommendation system because image generation is tenant-scoped and may have no assistant identity; it is retained as non-runtime evidence for a future explicit recommendation generation flow. No automatic profile or configuration changes occur.

## Safety

- The semantic adapter is injected and provider-independent; production wiring may use the existing provider boundary, while tests use a deterministic fake.
- No tenant name, customer name, location, phrase list, or customer-specific prompt is allowed in production classification logic.
- PII redaction applies to canonical text and evidence before persistence.
- Existing APPROVED candidates are immutable. Regeneration replaces only unapproved image-derived candidates for the same source/extraction through a transaction, then inserts canonical facts idempotently.
- No external provider calls during this task's tests or staging verification.

## Data and API

An additive migration adds semantic category and canonicalization metadata to `knowledge_candidate_image_evidence`, plus an image-derived candidate lifecycle marker on `knowledge_candidates`. The existing generate endpoint and candidate list remain compatible; safe semantic metadata is included in returned candidate/evidence DTOs.

## Verification

Tests cover every semantic class, canonicalization, PII, timestamps, idempotency, evidence, tenancy, approval, profile/configuration safety, document regressions, and Dashboard rendering. Human acceptance regenerates candidates from the existing `whatsapp.png` record after staging deployment.
