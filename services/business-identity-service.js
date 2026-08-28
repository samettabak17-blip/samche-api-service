const CORPORATE_SUFFIXES = new Set(['llc', 'ltd', 'limited', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'co']);

export function normalizeBusinessIdentity(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\bl\s*\.\s*l\s*\.\s*c\s*\.?\b/g, ' llc ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part && !CORPORATE_SUFFIXES.has(part))
    .join(' ');
}

export async function analyzeBusinessIdentityScope({ provider, sources }) {
  const evidence = [];
  for (const source of sources) {
    const analysis = await provider.generateBusinessIdentityAnalysis({ source });
    const detectedIdentity = String(analysis.detected_identity ?? '').trim();
    const normalizedIdentity = normalizeBusinessIdentity(detectedIdentity);
    const confidence = Number(analysis.confidence);
    evidence.push({
      source_id: source.id,
      source_title: source.title,
      content_hash: source.content_hash ?? null,
      detected_identity: detectedIdentity || 'unknown',
      normalized_identity: normalizedIdentity,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      safe_evidence: String(analysis.evidence ?? '').trim().slice(0, 1000),
    });
  }
  const identities = [];
  for (const item of evidence.filter((entry) => entry.normalized_identity && entry.confidence >= 0.7)) {
    let identity = identities.find((entry) => entry.normalized_identity === item.normalized_identity);
    if (!identity) {
      identity = { detected_identity: item.detected_identity, normalized_identity: item.normalized_identity, source_ids: [] };
      identities.push(identity);
    }
    identity.source_ids.push(item.source_id);
  }
  return { status: identities.length === 1 ? 'RESOLVED' : 'IDENTITY_RESOLUTION_REQUIRED', identities, evidence };
}
