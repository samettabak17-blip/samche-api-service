/**
 * Real Headless Browser automation helper via Chrome DevTools Protocol (CDP)
 * Zero external npm dependencies — uses native Node.js fetch and WebSocket.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

export function findBrowserBinary() {
  if (process.env.BROWSER_BIN && fs.existsSync(process.env.BROWSER_BIN)) return process.env.BROWSER_BIN;
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
      ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class BrowserCdp {
  constructor(proc, ws, port) {
    this.proc = proc;
    this.ws = ws;
    this.port = port;
    this.msgId = 1;
    this.pending = new Map();
    this.eventListeners = [];

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) {
            reject(new Error(`CDP Error (${data.error.code}): ${data.error.message}`));
          } else {
            resolve(data.result);
          }
        }
        for (const fn of this.eventListeners) {
          try { fn(data); } catch (e) {}
        }
      } catch (err) {
        console.warn('BrowserCdp message parse error:', err);
      }
    };
  }

  static async launch(options = {}) {
    const port = options.port || (9222 + Math.floor(Math.random() * 500));
    const edgePath = options.executablePath || process.env.EDGE_PATH || findBrowserBinary();
    const headless = options.headless !== false;

    const args = [
      headless ? '--headless=new' : '',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/edge_cdp_profile_' + port,
      'about:blank',
    ].filter(Boolean);

    const proc = spawn(edgePath, args, { stdio: 'ignore' });

    // Poll until debugging port is available
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const pages = await res.json();
          const pageTarget = Array.isArray(pages) ? pages.find((p) => p.type === 'page') : null;
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!wsUrl) {
      proc.kill();
      throw new Error(`Failed to connect to browser on port ${port} within timeout`);
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const client = new BrowserCdp(proc, ws, port);
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');
    return client;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    let resolved = false;
    const navPromise = new Promise((resolve) => {
      const fn = (data) => {
        if (data.method === 'Page.loadEventFired' || data.method === 'Page.domContentEventFired') {
          if (!resolved) {
            resolved = true;
            this.eventListeners = this.eventListeners.filter((l) => l !== fn);
            resolve();
          }
        }
      };
      this.eventListeners.push(fn);
    });

    await this.send('Page.navigate', { url });
    await Promise.race([
      navPromise,
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    await new Promise((r) => setTimeout(r, 400));
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(`Evaluation exception: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res?.result?.value;
  }

  async setViewport({ width, height, deviceScaleFactor = 1, isMobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: isMobile,
    });
    await new Promise((r) => setTimeout(r, 150));
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    try {
      this.proc.kill();
    } catch {}
  }
}
