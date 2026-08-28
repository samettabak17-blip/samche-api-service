# Business Identity and Source Scope Design

## Goal

Business Profile generation must never assume that every READY source in a tenant describes one company. Generation is explicitly scoped as `tenant -> business identity -> selected eligible sources -> profile versions -> assistant configuration -> runtime persona`.

## Data model

`business_identities` is tenant-scoped and stores a user-facing display name, normalized identity, lifecycle status, and timestamps. `knowledge_source_business_identities` links an eligible source to a business identity without changing Assistant assignment. `business_identity_source_evidence` stores the latest source-derived detected identity, normalized value, confidence, safe evidence, content hash, provider/model provenance, and timestamps.

`business_profiles` gains `business_identity_id`; `business_profile_versions` gains an exact JSONB `source_scope` and `identity_resolution_status`. Existing profile rows remain valid legacy records, while every new scoped generation requires an identity and explicit source IDs.

## Generation contract

The generate request requires `business_identity_id` and a non-empty unique `source_ids` array. Every source must belong to the same tenant and be enabled, active, READY for processing and indexing, and non-archived. Source selection never derives from Assistant assignment.

Each selected source is analyzed independently by the configured knowledge-generation provider. The analysis returns source-derived company identity, confidence, and a short safe evidence statement. Identity names are normalized generically for comparison. Empty or uncertain identities are reported as unresolved; two or more distinct confident identities produce `IDENTITY_RESOLUTION_REQUIRED` before Business Profile generation.

When analysis is clear, the profile prompt contains only the selected sources. Provenance stores the business identity ID, exact source IDs and hashes, and detected identity evidence. The generated version begins in `NEEDS_REVIEW`.

## Lifecycle safety

Approval and activation require `identity_resolution_status = 'RESOLVED'`, a valid tenant-scoped business identity, and a non-empty exact source scope. UI disabling is advisory; backend checks are authoritative. Existing legacy profiles retain their previous lifecycle compatibility but cannot be silently converted into newly scoped V2 artifacts.

Assistant recommendation and configuration generation remain based on the ACTIVE Business Profile. Their provenance is extended with the active profile's business identity and source scope; they do not query all tenant knowledge.

## Dashboard

Business Profile generation becomes a scope form: create or select a Business Identity, select eligible source documents, review detected identity evidence, then generate. Conflicts list identities and their sources and prevent submission. Version cards show business identity, exact selected sources, provenance, and resolution status.

## Safety and compatibility

All joins predicate on tenant ID. No customer-specific identity rules are permitted. Existing Knowledge Base, Assistant assignment, approved candidate ingestion, and runtime activation semantics remain unchanged. SamChe is represented through tenant data and follows the same identity/source-scope contract.

