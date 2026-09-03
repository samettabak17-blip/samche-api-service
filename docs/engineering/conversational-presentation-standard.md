# Conversational presentation standard

Provider adapters produce SamChe-owned canonical response events: `THINKING`,
`TEXT_DELTA`, `SECTION`, `LIST`, `ACTION`, `COMPLETE`, and `ERROR`. The core
conversation layer must not depend on a provider stream format.

Channel adapters obtain their delivery policy from
`services/conversation-presentation-policy.js`. Web Guide uses visible
progressive display. Future Web Chat can use the same `WEB` capability profile.
The WhatsApp adapter should use its native typing capability where supported and
deliver bounded natural chunks; it must not imitate browser character animation.
