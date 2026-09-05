export function buildNpmInvocation(args, {
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (npmExecPath) {
    return { command: execPath, args: [npmExecPath, ...args], shell: false };
  }
  return {
    command: platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    shell: platform === 'win32',
  };
}
