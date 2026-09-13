import fs from 'node:fs';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

async function run() {
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.navigate('https://demo.samchecompany.com/');
  await new Promise(r => setTimeout(r, 2000));

  const data = await browser.evaluate(`
    (() => {
      const inst = window.SamcheWebChat?.getInstance();
      const ctx = inst?.capturePageContext();
      return {
        ctx,
        location: {
          pathname: window.location.pathname,
          href: window.location.href,
        }
      };
    })()
  `);
  fs.writeFileSync('C:/Users/smttb/Documents/samche-api-service/scripts/home_debug.json', JSON.stringify(data, null, 2));
  await browser.close();
}

run().catch(console.error);

