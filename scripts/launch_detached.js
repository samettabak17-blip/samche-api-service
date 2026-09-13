import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/verify_real_external_acceptance.js'], {
  cwd: 'C:/Users/smttb/Documents/samche-api-service',
  detached: true,
  stdio: 'ignore'
});
child.unref();
console.log('Detached child PID:', child.pid);
