export function resolvePostgresSsl({
  connectionString,
  databaseSsl = process.env.DATABASE_SSL,
  nodeEnv = process.env.NODE_ENV,
}) {
  if (databaseSsl === 'strict') {
    const parsed = new URL(connectionString);
    return { rejectUnauthorized: true, servername: parsed.hostname };
  }
  if (databaseSsl === 'false') return false;
  return nodeEnv === 'production' ? { rejectUnauthorized: false } : false;
}
