# Task 7 Conversational Guide Design

## Goal

Turn the shared tenant Guide into a conversational-first Roadmap, Tool and Assistant experience without changing published Experience lifecycle state, production, DNS, or tenant-specific infrastructure.

## Boundaries

- Public and private-preview Guides use the same renderer; preview remains ticket-authorized and session-isolated.
- The server owns tenant, assistant, domain, Experience version, session context and conversation linkage.
- The browser stores only an opaque resume token. A resume token is bound server-side to host scope and expires under a SamChe-owned retention policy.
- Providers are adapted to canonical Guide events. The public renderer consumes no provider-specific schema.
- Experience configuration supplies copy, intents and structured fields. No tenant or sector branch is added to the renderer.

## Response model

`GuideResponseEvent` is a validated SamChe contract: `MESSAGE_START`, `THINKING`, `TEXT_DELTA`, `SECTION`, `LIST`, `ACTION`, `MESSAGE_COMPLETE`, and `ERROR`. A real stream is adapted to these events when supported. A completed provider response is transformed into the same event sequence and visibly revealed in bounded text chunks when it is not.

The renderer buffers Markdown-like input into safe text, heading, paragraph and list nodes. It never injects model HTML or exposes unfinished markup delimiters.

## Conversation and memory

One server-side Guide session holds roadmap interaction/history, validated structured facts, tool inputs/results, assistant conversation linkage, current module and timestamps. The client synchronizes bounded state and receives an opaque resume token. Preview sessions have a distinct namespace and cannot resume public state.

## Presentation

Roadmap starts with Experience-configured suggested intents and a free-text composer. Existing structured fields support fact capture rather than defining the primary screen. Roadmap and Assistant share the same thinking-to-progressive-response primitive. The Assistant reminder returns to the existing conversation only.

Header rendering has strict current-Experience precedence: current explicit logo; current explicit avatar only; otherwise no secondary header asset. Original logo bytes are never changed. Theme analysis derives accessible dark/light tokens from sampled current logo pixels.

## Validation

Regression coverage proves canonical events, progressive fallback, safe formatting, session resume/isolation, context reuse, current-only asset rendering, Review/Back behavior, and existing domain/lifecycle constraints. Human acceptance remains required for visible thinking and flowing text.
