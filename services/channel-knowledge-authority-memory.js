function serializedAuthority(snapshot) {
  if (!snapshot?.assistantId || snapshot.version === null || snapshot.version === undefined) return null;
  try {
    const version = BigInt(snapshot.version);
    if (version <= 0n) return null;
    return { assistantId: snapshot.assistantId, version: version.toString() };
  } catch {
    return null;
  }
}

export function stampProviderMemoryEntry(entry, knowledgeAuthority) {
  const authority = serializedAuthority(knowledgeAuthority);
  return authority ? { ...entry, knowledgeAuthority: authority } : { ...entry };
}

export function filterProviderMemoryByAuthority(entries, currentKnowledgeAuthority) {
  const current = serializedAuthority(currentKnowledgeAuthority);
  if (!current) return entries;
  return entries.filter((entry) => {
    const stamped = serializedAuthority(entry?.knowledgeAuthority);
    return stamped?.assistantId === current.assistantId && stamped.version === current.version;
  });
}
