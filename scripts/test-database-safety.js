const TEST_DATABASE_MARKER = /(^|[_-])(test|testing)([_-]|$)/i;
const FORBIDDEN_DATABASE_MARKER = /(^|[_-])(prod(?:uction)?|staging|shared)([_-]|$)/i;

export function getDatabaseName(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) return null;
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

export function isSafeTestDatabaseUrl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const databaseName = getDatabaseName(connectionString);
    return /^postgres(?:ql)?:$/.test(parsed.protocol)
      && Boolean(parsed.hostname)
      && Boolean(parsed.username)
      && Boolean(databaseName)
      && TEST_DATABASE_MARKER.test(databaseName)
      && !FORBIDDEN_DATABASE_MARKER.test(databaseName);
  } catch {
    return false;
  }
}
