import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function createFixtureServer() {
  const webChatJs = fs.readFileSync(path.resolve('public/web-chat.js'), 'utf8');
  
  const mockAppearance = {
    brand_name: "SamChe Teknoloji Task 8",
    title: "Destek",
    subtitle: "Çevrimiçi",
    launcher_label: "Temsilci",
    launcher_position: "right",
    launcher_icon: "chat",
    launcher_style: "pill",
    glow_intensity: 95,
    glow_spread: 85,
    pulse_animation: "strong",
    animation_speed: "normal",
    theme: {
      primary_color: "#80C8F8",
      accent_color: "#10B981",
      surface_tint: "#1A293F",
      surface_glass: "rgba(20, 30, 43, 0.82)",
      surface_solid: "#111827",
      glow_color: "rgba(128, 200, 248, 0.42)",
      glow_soft: "rgba(128, 200, 248, 0.21)",
      glow_ring: "rgba(128, 200, 248, 0.77)",
      glow_spread_px: 29,
      glow_halo_px: 51,
      pulse_duration: "3.6s",
      launcher_text: "#0F172A",
      text_color: "#F8FAFC",
      muted_color: "#94A3B8",
      border_color: "rgba(255, 255, 255, 0.12)",
      primary_foreground: "#0F172A",
      accent_foreground: "#0F172A"
    }
  };

  const pageHtml = (title, routePath) => '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>' + title + '</title><style>body { font-family: sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: white; min-height: 100vh; overflow-x: hidden; } nav { display: flex; gap: 1rem; margin-bottom: 2rem; } nav a { color: #60a5fa; cursor: pointer; text-decoration: underline; } .content { border: 1px solid #334155; padding: 2rem; border-radius: 8px; }</style></head><body><nav><a id="link-home" onclick="spaNavigate(\'/\', \'Ana Sayfa\')">Ana Sayfa</a><a id="link-shop" onclick="spaNavigate(\'/shop\', \'Ürünler\')">Ürünler</a><a id="link-prod" onclick="spaNavigate(\'/vektor-horizon-akll-bileklik\', \'Vektor Horizon\')">Vektor Horizon</a><a id="link-full-prod" href="/vektor-novabuds-pro-kulak-st-kulaklk">Full-Page NovaBuds</a></nav><div class="content" id="main-content"><h1>' + title + '</h1><p>Current Route: <span id="route-path">' + routePath + '</span></p></div><script src="/web-chat.js" data-widget-key="wch_staging_task8_demo"></script><script>function spaNavigate(newPath, newTitle) { history.pushState({}, newTitle, newPath); document.title = newTitle; document.getElementById("route-path").textContent = newPath; document.querySelector("h1").textContent = newTitle; }</script></body></html>';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/web-chat.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(webChatJs);
      return;
    }
    if (url.pathname === '/api/chat/bootstrap') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session: 'mock_session_123',
        appearance: mockAppearance,
        behavior: { language: 'tr', cooldown_seconds: 300, dwell_threshold_seconds: 15 },
        history: []
      }));
      return;
    }
    if (url.pathname === '/api/chat/page-context') {
      const isProduct = url.searchParams.get('product') || (req.headers.referer && req.headers.referer.includes('vektor'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        proactive_engagement: {
          should_nudge: Boolean(isProduct),
          intent_state: isProduct ? 'MEDIUM' : 'LOW'
        }
      }));
      return;
    }

    let pageTitle = 'Ana Sayfa';
    if (url.pathname === '/shop') pageTitle = 'Ürünler';
    if (url.pathname.includes('vektor-horizon')) pageTitle = 'Vektor Horizon Akıllı Bileklik';
    if (url.pathname.includes('vektor-novabuds')) pageTitle = 'Vektor NovaBuds Pro Kulak Üstü Kulaklık';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageHtml(pageTitle, url.pathname));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, origin: 'http://127.0.0.1:' + port });
    });
  });
}
