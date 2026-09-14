/**
 * Canonical Web Chat Design Contract & Shared Renderer Primitives
 * AUTO-EXTRACTED DIRECTLY FROM public/web-chat.js
 * Guarantees 100% visual parity across public widget and dashboard live preview.
 */

export const CANONICAL_WIDGET_CSS_A: string[] = [
    ':host { all: initial; position: fixed !important; bottom: 0 !important; right: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483640 !important; pointer-events: none !important; overflow: visible !important; display: block !important; isolation: isolate !important; contain: none !important; }',
    '.samche-wrap { all: initial; position: fixed !important; bottom: 0 !important; right: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483640 !important; pointer-events: none !important; overflow: visible !important; isolation: isolate !important; contain: none !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--chat-text, #F8FAFC); font-size: 14px; line-height: 1.5; text-align: left; letter-spacing: normal; direction: ltr; }',
    '.samche-pos-left.samche-wrap { right: auto !important; left: 0 !important; }',
    '*, *::before, *::after { box-sizing: border-box !important; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }',
    'svg { display: block; flex-shrink: 0; box-sizing: content-box; }',
    'button { background: none; border: none; outline: none; cursor: pointer; padding: 0; margin: 0; font-family: inherit; color: inherit; line-height: 1; }',
    'textarea, input { font-family: inherit; font-size: 14px; line-height: 1.4; box-sizing: border-box; }',
    '.samche-launcher { position: fixed !important; bottom: 24px !important; right: 24px !important; min-height: 54px !important; height: 54px !important; max-width: calc(100vw - 48px) !important; border-radius: 9999px !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; pointer-events: auto !important; transition: transform .22s cubic-bezier(.16,1,.3,1), box-shadow .22s ease, opacity .2s ease, background .2s ease !important; outline: none !important; z-index: 2147483641 !important; margin: 0 !important; box-sizing: border-box !important; user-select: none !important; direction: ltr !important; overflow: visible !important; contain: none !important; background-color: var(--chat-launcher-bg, #0F172A) !important; background: var(--chat-launcher-bg, linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.98) 100%)) !important; color: var(--chat-launcher-text, #FFFFFF) !important; border: 1px solid var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.45) var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))), 0 0 var(--chat-glow-halo, 42px) var(--chat-launcher-glow, var(--chat-glow, rgba(56, 189, 248, 0.4))), 0 8px 28px -4px var(--chat-glow-soft, rgba(56, 189, 248, 0.2)), 0 4px 16px rgba(0, 0, 0, 0.35) !important; animation: samche-glow-breathe var(--chat-pulse-duration, 3.6s) infinite ease-in-out; }',
    '.samche-launcher.samche-launcher-hidden { opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; transform: scale(0.85) !important; transition: opacity .2s ease, transform .2s ease !important; }',
    '.samche-launcher.samche-style-pill { padding: 4px 18px 4px 6px !important; gap: 10px; background-color: var(--chat-launcher-bg, #0F172A) !important; background: var(--chat-launcher-bg, linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.98) 100%)) !important; border: 1px solid var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))) !important; color: var(--chat-launcher-text, #FFFFFF) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.45) var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))), 0 0 var(--chat-glow-halo, 42px) var(--chat-launcher-glow, var(--chat-glow, rgba(56, 189, 248, 0.4))), 0 8px 28px -4px var(--chat-glow-soft, rgba(56, 189, 248, 0.2)), 0 4px 16px rgba(0, 0, 0, 0.35); }',
    '.samche-launcher.samche-style-circular { width: 62px !important; height: 62px !important; min-width: 62px !important; min-height: 62px !important; max-width: 62px !important; max-height: 62px !important; border-radius: 50% !important; padding: 5px !important; background-color: var(--chat-launcher-bg, #0F172A) !important; background: var(--chat-launcher-bg, radial-gradient(circle at center, rgba(30, 41, 59, 0.9) 0%, rgba(2, 6, 23, 0.98) 100%)) !important; border: 1px solid var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.85))) !important; color: var(--chat-launcher-text, #FFFFFF) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.6) var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.8))), 0 0 var(--chat-glow-halo, 42px) var(--chat-launcher-glow, var(--chat-glow, rgba(56, 189, 248, 0.45))), 0 10px 30px -4px var(--chat-glow-soft, rgba(56, 189, 248, 0.25)), 0 4px 18px rgba(0, 0, 0, 0.4); }',
    '.samche-launcher.samche-style-minimal { width: 52px !important; height: 52px !important; min-width: 52px !important; min-height: 52px !important; max-width: 52px !important; max-height: 52px !important; border-radius: 50% !important; padding: 4px !important; background: var(--chat-launcher-bg, #111827) !important; background-color: var(--chat-launcher-bg, #111827) !important; color: var(--chat-launcher-text, #FFFFFF) !important; border: 1px solid var(--chat-launcher-border, var(--chat-border, rgba(255, 255, 255, 0.15))) !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 0 calc(var(--chat-glow-spread, 24px) * 0.2) var(--chat-glow-soft, rgba(56, 189, 248, 0.2)); animation: none !important; }',
    '.samche-launcher.samche-style-glass { padding: 4px 18px 4px 6px !important; gap: 10px; background: var(--chat-launcher-bg, rgba(17, 24, 39, 0.68)) !important; background-color: var(--chat-launcher-bg, rgba(17, 24, 39, 0.68)) !important; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid var(--chat-launcher-border, rgba(255, 255, 255, 0.22)) !important; color: var(--chat-launcher-text, #FFFFFF) !important; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 0 14px rgba(255, 255, 255, 0.08), 0 0 calc(var(--chat-glow-spread, 24px) * 0.45) var(--chat-glow-soft, rgba(56, 189, 248, 0.3)); }',
    '.samche-launcher.samche-style-neon-pulse, .samche-launcher.samche-style-neon_pulse { padding: 4px 18px 4px 6px !important; gap: 10px; background: var(--chat-launcher-bg, radial-gradient(circle at center, rgba(15, 23, 42, 0.95) 0%, rgba(2, 6, 23, 1) 100%)) !important; background-color: var(--chat-launcher-bg, #0F172A) !important; border: 1px solid var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.95))) !important; color: var(--chat-launcher-text, #FFFFFF) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.7) var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.9))), 0 0 var(--chat-glow-halo, 42px) var(--chat-launcher-glow, var(--chat-glow, rgba(56, 189, 248, 0.55))), 0 0 calc(var(--chat-glow-halo, 42px) * 1.5) var(--chat-glow-soft, rgba(56, 189, 248, 0.3)), 0 10px 32px rgba(0, 0, 0, 0.4) !important; animation: samche-glow-pulse-strong var(--chat-pulse-duration, 3.6s) infinite ease-in-out !important; }',
    '.samche-launcher.samche-style-custom { padding: 4px 18px 4px 6px !important; gap: 10px; background-color: var(--chat-launcher-bg, #0F172A) !important; background: var(--chat-launcher-bg, linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.98) 100%)) !important; border: 1px solid var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))) !important; color: var(--chat-launcher-text, #FFFFFF) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.45) var(--chat-launcher-border, var(--chat-glow-ring, rgba(56, 189, 248, 0.7))), 0 0 var(--chat-glow-halo, 42px) var(--chat-launcher-glow, var(--chat-glow, rgba(56, 189, 248, 0.4))), 0 8px 28px -4px var(--chat-glow-soft, rgba(56, 189, 248, 0.2)), 0 4px 16px rgba(0, 0, 0, 0.35); }',
    '.samche-launcher.samche-launcher-circle, .samche-launcher.samche-launcher-circle.samche-style-pill { width: 60px !important; height: 60px !important; min-width: 60px !important; min-height: 60px !important; max-width: 60px !important; max-height: 60px !important; border-radius: 50% !important; padding: 0 !important; box-sizing: border-box !important; }',
    '.samche-launcher.samche-pulse-none { animation: none !important; }',
    '.samche-launcher.samche-pulse-subtle { animation: samche-glow-pulse-subtle var(--chat-pulse-duration, 3.6s) infinite ease-in-out !important; }',
    '.samche-launcher.samche-pulse-normal { animation: samche-glow-breathe var(--chat-pulse-duration, 3.6s) infinite ease-in-out !important; }',
    '.samche-launcher.samche-pulse-strong { animation: samche-glow-pulse-strong var(--chat-pulse-duration, 3.6s) infinite ease-in-out !important; }',
    '.samche-launcher-label { font-size: 14px; font-weight: 600; color: var(--chat-launcher-text, inherit) !important; white-space: nowrap; line-height: 1; letter-spacing: -0.01em; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }',
    '.samche-launcher-badge { width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: 50%; background: radial-gradient(circle at center, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%); border: 1.5px solid var(--chat-glow-ring, rgba(56, 189, 248, 0.8)); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; padding: 6px; box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 0 12px var(--chat-glow-soft, rgba(56, 189, 248, 0.3)); }',
    '.samche-launcher.samche-launcher-circle .samche-launcher-badge { width: 100%; height: 100%; border: none; background: transparent; box-shadow: none; padding: 6px; }',
    '.samche-launcher-badge img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; user-select: none; pointer-events: none; }',
    '.samche-launcher-badge svg { width: 24px !important; height: 24px !important; max-width: 24px !important; max-height: 24px !important; fill: currentColor; color: var(--chat-launcher-text, #FFFFFF) !important; }',
    '.samche-pos-left .samche-launcher { right: auto !important; left: 24px !important; }',
    '.samche-launcher:hover { transform: translateY(-2px) scale(1.02); }',
    '.samche-launcher:active { transform: translateY(0) scale(0.98); }',
    '.samche-launcher:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); outline-offset: 3px; }',
    '.samche-launcher-icon { width: 24px !important; height: 24px !important; display: flex; align-items: center; justify-content: center; fill: currentColor; flex-shrink: 0; }',
    '.samche-launcher-icon svg { width: 24px !important; height: 24px !important; max-width: 24px !important; max-height: 24px !important; fill: currentColor; }',
    '.samche-launcher-logo { max-width: 100%; max-height: 100%; object-fit: contain; flex-shrink: 0; }',
    '.samche-launcher.samche-intent-pulse { animation: samche-intent-pulse 2s ease-in-out 3 !important; }',
    '@keyframes samche-glow-breathe { 0%, 100% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.45) var(--chat-glow-ring, rgba(56, 189, 248, 0.7)), 0 0 var(--chat-glow-halo, 42px) var(--chat-glow, rgba(56, 189, 248, 0.4)), 0 8px 28px -4px var(--chat-glow-soft, rgba(56, 189, 248, 0.2)), 0 4px 16px rgba(0, 0, 0, 0.5); transform: scale(1); } 50% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.7) var(--chat-glow-ring, rgba(56, 189, 248, 0.9)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.3) var(--chat-glow, rgba(56, 189, 248, 0.55)), 0 12px 36px -2px var(--chat-glow-soft, rgba(56, 189, 248, 0.35)), 0 6px 20px rgba(0, 0, 0, 0.6); transform: scale(1.025); } }',
    '@keyframes samche-glow-pulse-strong { 0%, 100% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.5) var(--chat-glow-ring, rgba(56, 189, 248, 0.8)), 0 0 var(--chat-glow-halo, 42px) var(--chat-glow, rgba(56, 189, 248, 0.5)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.6) var(--chat-glow-soft, rgba(56, 189, 248, 0.3)), 0 8px 30px rgba(0, 0, 0, 0.6); transform: scale(1); } 50% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.9) var(--chat-glow-ring, rgba(56, 189, 248, 1)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.5) var(--chat-glow, rgba(56, 189, 248, 0.75)), 0 0 calc(var(--chat-glow-halo, 42px) * 2.2) var(--chat-glow-soft, rgba(56, 189, 248, 0.45)), 0 14px 40px rgba(0, 0, 0, 0.7); transform: scale(1.04); } }',
    '@keyframes samche-glow-pulse-subtle { 0%, 100% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.35) var(--chat-glow-ring, rgba(56, 189, 248, 0.6)), 0 0 var(--chat-glow-halo, 42px) var(--chat-glow, rgba(56, 189, 248, 0.3)), 0 6px 20px rgba(0, 0, 0, 0.4); transform: scale(1); } 50% { box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.5) var(--chat-glow-ring, rgba(56, 189, 248, 0.75)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.15) var(--chat-glow, rgba(56, 189, 248, 0.42)), 0 8px 24px rgba(0, 0, 0, 0.45); transform: scale(1.015); } }',
    '@keyframes samche-intent-pulse { 0% { transform: scale(1); box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.5) var(--chat-glow-ring, rgba(56, 189, 248, 0.8)), 0 0 var(--chat-glow-halo, 42px) var(--chat-glow, rgba(56, 189, 248, 0.5)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.6) var(--chat-glow-soft, rgba(56, 189, 248, 0.3)), 0 8px 30px rgba(0, 0, 0, 0.6), 0 0 0 0 var(--chat-glow-ring, rgba(56, 189, 248, 0.7)); } 50% { transform: scale(1.04); box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.9) var(--chat-glow-ring, rgba(56, 189, 248, 1)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.5) var(--chat-glow, rgba(56, 189, 248, 0.75)), 0 0 calc(var(--chat-glow-halo, 42px) * 2.2) var(--chat-glow-soft, rgba(56, 189, 248, 0.45)), 0 14px 40px rgba(0, 0, 0, 0.7), 0 0 0 16px rgba(56, 189, 248, 0); } 100% { transform: scale(1); box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.5) var(--chat-glow-ring, rgba(56, 189, 248, 0.8)), 0 0 var(--chat-glow-halo, 42px) var(--chat-glow, rgba(56, 189, 248, 0.5)), 0 0 calc(var(--chat-glow-halo, 42px) * 1.6) var(--chat-glow-soft, rgba(56, 189, 248, 0.3)), 0 8px 30px rgba(0, 0, 0, 0.6), 0 0 0 0 rgba(56, 189, 248, 0); } }',
    '.samche-panel { position: fixed; bottom: 96px; right: 24px; width: 400px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 120px); border-radius: 20px; background: var(--chat-surface-glass, rgba(18,20,26,0.92)); color: var(--chat-text, #F8FAFC) !important; backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1.5px solid var(--chat-border, rgba(255,255,255,0.12)); box-shadow: 0 24px 64px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--chat-border, rgba(255,255,255,0.08)); display: flex; flex-direction: column; overflow: hidden; pointer-events: none; opacity: 0; transform: translateY(16px) scale(0.96); visibility: hidden; transition: transform .28s cubic-bezier(.16,1,.3,1), opacity .25s ease-out, border-color .2s ease; z-index: 2147483642; }',
    '.samche-pos-left .samche-panel { right: auto; left: 24px; }',
    '.samche-panel.samche-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible !important; pointer-events: auto; border: 1.5px solid var(--chat-glow-ring, rgba(56, 189, 248, 0.45)); box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.75) var(--chat-glow-soft, rgba(56, 189, 248, 0.25)), 0 24px 60px -12px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.5); }',
    '@supports not (backdrop-filter: blur(10px)) { .samche-panel { background: var(--chat-surface-solid, #12141a) !important; } }'
  ];

export const CANONICAL_WIDGET_CSS_B: string[] = [
    '.samche-header { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(255,255,255,0.03); flex-shrink: 0; }',
    '.samche-header-info { display: flex; align-items: center; gap: 12px; }',
    '.samche-header-avatar { width: 36px; height: 36px; border-radius: 10px; background: var(--chat-surface-tint, #1E293B); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }',
    '.samche-header-avatar img { width: 100%; height: 100%; object-fit: contain; }',
    '.samche-header-avatar svg, .samche-avatar-icon svg { width: 20px !important; height: 20px !important; max-width: 20px !important; max-height: 20px !important; fill: var(--chat-primary, #2563EB); }',
    '.samche-header-titles { display: flex; flex-direction: column; }',
    '.samche-header-title { font-size: 15px; font-weight: 600; color: var(--chat-text, #F8FAFC); line-height: 1.25; }',
    '.samche-header-status { font-size: 12px; color: var(--chat-muted, #94A3B8); display: flex; align-items: center; gap: 5px; margin-top: 2px; }',
    '.samche-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 8px #22C55E; display: inline-block; }',
    '.samche-header-context-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: rgba(96,165,250,0.15); color: var(--chat-accent, #60A5FA); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }',
    '.samche-close-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease; flex-shrink: 0; padding: 0; }',
    '.samche-close-btn:hover { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-close-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-close-btn svg { width: 14px !important; height: 14px !important; max-width: 14px !important; max-height: 14px !important; }',
    '.samche-minimize-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease; flex-shrink: 0; padding: 0; }',
    '.samche-minimize-btn:hover { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-minimize-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-minimize-btn svg { width: 14px !important; height: 14px !important; max-width: 14px !important; max-height: 14px !important; }',
    '.samche-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }',
    '.samche-clear-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--chat-border, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.05); color: var(--chat-muted, #94A3B8); cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none; transition: background .15s ease, color .15s ease, opacity .15s ease; flex-shrink: 0; padding: 0; }',
    '.samche-clear-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: var(--chat-text, #F8FAFC); }',
    '.samche-clear-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); }',
    '.samche-clear-btn:disabled { opacity: 0.35; cursor: not-allowed; }',
    '.samche-clear-btn svg { width: 15px !important; height: 15px !important; max-width: 15px !important; max-height: 15px !important; }',
    '.samche-confirm-dialog { position: absolute; inset: 0; background: rgba(10, 12, 16, 0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 100; animation: samche-msg-fadein .18s ease-out; }',
    '.samche-confirm-content { background: var(--chat-surface-solid, #1E2330); border: 1px solid var(--chat-border, rgba(255,255,255,0.15)); border-radius: 16px; padding: 20px 18px 16px; width: 100%; max-width: 300px; box-shadow: 0 16px 36px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; }',
    '.samche-confirm-message { font-size: 13.5px; font-weight: 500; color: var(--chat-text, #F8FAFC); line-height: 1.45; margin: 0; }',
    '.samche-confirm-buttons { display: flex; gap: 10px; width: 100%; margin-top: 4px; }',
    '.samche-confirm-btn { flex: 1; padding: 9px 12px; font-size: 13px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; justify-content: center; outline: none; }',
    '.samche-confirm-cancel { background: rgba(255,255,255,0.08); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); color: var(--chat-muted, #94A3B8); }',
    '.samche-confirm-cancel:hover:not(:disabled) { background: rgba(255,255,255,0.14); color: var(--chat-text, #F8FAFC); }',
    '.samche-confirm-proceed { background: #DC2626; border: 1px solid rgba(220, 38, 38, 0.4); color: #FFFFFF; }',
    '.samche-confirm-proceed:hover:not(:disabled) { background: #B91C1C; }',
    '.samche-confirm-btn:focus-visible { outline: 2px solid var(--chat-accent, #60A5FA); outline-offset: 2px; }',
    '.samche-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '.samche-panel[dir="rtl"] .samche-confirm-buttons { flex-direction: row-reverse; }',
    '.samche-panel[dir="rtl"] .samche-header-actions { flex-direction: row-reverse; }',
    '.samche-messages { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }',
    '.samche-msg { animation: samche-msg-fadein .24s cubic-bezier(.16,1,.3,1); max-width: 85%; font-size: 14px; line-height: 1.5; word-break: break-word; }',
    '.samche-msg-user { align-self: flex-end; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFFFFF) !important; padding: 10px 14px; border-radius: 16px 16px 4px 16px; box-shadow: 0 4px 14px -3px var(--chat-glow, rgba(37,99,235,0.3)); font-weight: 500; }',
    '.samche-msg-bot { align-self: flex-start; background: var(--chat-bot-bubble-bg, rgba(255,255,255,0.07)); color: var(--chat-text, #F8FAFC) !important; border: 1px solid var(--chat-bot-bubble-border, var(--chat-border, rgba(255,255,255,0.08))); padding: 12px 16px; border-radius: 16px 16px 16px 4px; }',
    '.samche-msg-bot a { color: var(--chat-accent, #60A5FA); text-decoration: underline; }',
    '.samche-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.06)); background: rgba(0,0,0,0.1); max-height: 90px; overflow-y: auto; flex-shrink: 0; }',
    '.samche-chip { font-size: 12px; padding: 6px 12px; border-radius: 9999px; background: rgba(255,255,255,0.08); color: var(--chat-text, #F8FAFC); border: 1px solid var(--chat-border, rgba(255,255,255,0.12)); cursor: pointer; transition: background .15s ease, transform .15s ease; outline: none; white-space: nowrap; }',
    '.samche-chip:hover { background: rgba(255,255,255,0.15); transform: translateY(-1px); }',
    '.samche-composer { padding: 14px 16px; border-top: 1px solid var(--chat-border, rgba(255,255,255,0.08)); background: rgba(0,0,0,0.15); display: flex; align-items: flex-end; gap: 10px; flex-shrink: 0; }',
    '.samche-composer-input { flex: 1; background: var(--chat-input-bg, rgba(255,255,255,0.06)); border: 1px solid var(--chat-input-border, rgba(255,255,255,0.14)); border-radius: 12px; color: var(--chat-text, #F8FAFC) !important; padding: 10px 14px; font-size: 14px; line-height: 1.4; resize: none; max-height: 110px; min-height: 42px; outline: none; }',
    '.samche-composer-input:focus { border-color: var(--chat-accent, #60A5FA); }',
    '.samche-composer-input::placeholder { color: var(--chat-muted, #94A3B8) !important; }',
    '.samche-send-btn { width: 42px !important; height: 42px !important; border-radius: 12px; background: var(--chat-primary, #2563EB); color: var(--chat-primary-foreground, #FFFFFF) !important; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; outline: none; transition: opacity .15s, transform .15s; padding: 0; }',
    '.samche-send-btn:hover:not(:disabled) { transform: scale(1.05); }',
    '.samche-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }',
    '.samche-send-btn svg { width: 18px !important; height: 18px !important; max-width: 18px !important; max-height: 18px !important; fill: currentColor; }',
    '.msg-typing-indicator { display: inline-flex !important; align-items: center; gap: 4px; min-height: 20px; padding: 0.6rem 0.9rem !important; }',
    '.typing-dots { display: inline-flex; align-items: center; gap: 4px; }',
    '.typing-dot { width: 6px; height: 6px; border-radius: 50%; background-color: var(--chat-muted, #94a3b8); display: inline-block; animation: samche-typing-bounce 1.4s infinite ease-in-out both; }',
    '.typing-dot:nth-child(1) { animation-delay: -0.32s; }',
    '.typing-dot:nth-child(2) { animation-delay: -0.16s; }',
    '.typing-dot:nth-child(3) { animation-delay: 0s; }',
    '@keyframes samche-typing-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.1); opacity: 1; } }',
    '@keyframes samche-msg-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }',
    '.samche-widget-inline .samche-wrap { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }',
    '.samche-widget-inline .samche-launcher { position: absolute !important; bottom: 16px !important; right: 16px !important; }',
    '.samche-widget-inline .samche-panel { position: absolute !important; bottom: 84px !important; right: 16px !important; width: calc(100% - 32px) !important; max-width: 360px !important; height: calc(100% - 100px) !important; max-height: 480px !important; }',
    '.samche-preview-mount .samche-wrap { position: relative !important; inset: auto !important; width: 100% !important; height: auto !important; z-index: 10 !important; }',
    '.samche-preview-mount .samche-launcher { position: relative !important; bottom: auto !important; right: auto !important; z-index: 10 !important; }',
    '.samche-preview-mount .samche-panel { position: relative !important; bottom: auto !important; right: auto !important; z-index: 10 !important; width: 400px !important; height: 600px !important; max-width: 100% !important; max-height: 100% !important; }',
    '.samche-preview-mobile .samche-panel { position: relative !important; bottom: auto !important; right: auto !important; left: auto !important; top: auto !important; z-index: 20 !important; width: 100% !important; max-width: 328px !important; height: 500px !important; max-height: 500px !important; border-radius: 18px !important; border: 1.5px solid var(--chat-glow-ring, rgba(56, 189, 248, 0.45)) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.75) var(--chat-glow-soft, rgba(56, 189, 248, 0.25)), 0 20px 48px -8px rgba(0, 0, 0, 0.75), 0 10px 24px rgba(0, 0, 0, 0.45) !important; }',
    '@media (max-width: 640px) { .samche-launcher { bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; right: calc(16px + env(safe-area-inset-right, 0px)) !important; min-height: 48px !important; height: 50px !important; max-width: calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) !important; padding: 4px 14px 4px 6px !important; gap: 8px !important; } .samche-launcher.samche-launcher-circle, .samche-launcher.samche-style-circular, .samche-launcher.samche-style-minimal { width: 50px !important; height: 50px !important; min-width: 50px !important; min-height: 50px !important; max-width: 50px !important; max-height: 50px !important; border-radius: 50% !important; padding: 0 !important; } .samche-pos-left .samche-launcher { right: auto !important; left: calc(16px + env(safe-area-inset-left, 0px)) !important; } .samche-panel { bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; right: calc(16px + env(safe-area-inset-right, 0px)) !important; left: auto !important; top: auto !important; width: calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) !important; max-width: 400px !important; height: min(520px, calc(100vh - 80px)) !important; height: min(520px, calc(var(--samche-vv-height, 100dvh) - 80px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))) !important; max-height: min(560px, calc(100vh - 64px)) !important; max-height: min(560px, calc(var(--samche-vv-height, 100dvh) - 64px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))) !important; min-height: min(340px, calc(100dvh - 64px)) !important; border-radius: 18px !important; margin: 0 !important; overflow: hidden !important; } .samche-pos-left .samche-panel { right: auto !important; left: calc(16px + env(safe-area-inset-left, 0px)) !important; } .samche-panel.samche-open { position: fixed !important; inset: auto !important; bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; right: calc(16px + env(safe-area-inset-right, 0px)) !important; width: calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) !important; max-width: 400px !important; height: min(520px, calc(100vh - 80px)) !important; height: min(520px, calc(var(--samche-vv-height, 100dvh) - 80px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))) !important; max-height: min(560px, calc(100vh - 64px)) !important; max-height: min(560px, calc(var(--samche-vv-height, 100dvh) - 64px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))) !important; min-height: min(340px, calc(100dvh - 64px)) !important; border-radius: 18px !important; border: 1.5px solid var(--chat-glow-ring, rgba(56, 189, 248, 0.45)) !important; box-shadow: 0 0 calc(var(--chat-glow-spread, 24px) * 0.75) var(--chat-glow-soft, rgba(56, 189, 248, 0.25)), 0 20px 48px -8px rgba(0, 0, 0, 0.75), 0 10px 24px rgba(0, 0, 0, 0.45) !important; } .samche-pos-left .samche-panel.samche-open { right: auto !important; left: calc(16px + env(safe-area-inset-left, 0px)) !important; } .samche-header { padding: 12px 14px !important; } .samche-header-avatar { width: 32px !important; height: 32px !important; } .samche-header-title { font-size: 14px !important; } .samche-header-status { font-size: 11px !important; } .samche-header-actions { gap: 6px !important; } .samche-close-btn, .samche-minimize-btn, .samche-clear-btn { width: 30px !important; height: 30px !important; } .samche-messages { padding: 12px 14px !important; gap: 10px !important; overscroll-behavior: contain !important; -webkit-overflow-scrolling: touch !important; } .samche-msg { max-width: 88% !important; padding: 10px 13px !important; font-size: 13.5px !important; } .samche-composer { padding: 10px 12px !important; gap: 8px !important; } .samche-composer-input { padding: 8px 12px !important; font-size: 16px !important; min-height: 40px !important; } .samche-send-btn { width: 40px !important; height: 40px !important; min-width: 40px !important; min-height: 40px !important; } }',
    '@media (max-width: 340px) { .samche-launcher-label { display: none !important; } .samche-launcher { width: 48px !important; height: 48px !important; min-width: 48px !important; min-height: 48px !important; max-width: 48px !important; max-height: 48px !important; border-radius: 50% !important; padding: 0 !important; } }',
    '@media (max-height: 500px) and (orientation: landscape) { .samche-panel { bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important; right: calc(16px + env(safe-area-inset-right, 0px)) !important; left: auto !important; top: auto !important; width: min(380px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))) !important; max-width: 380px !important; height: calc(100vh - 20px) !important; height: calc(var(--samche-vv-height, 100dvh) - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important; max-height: calc(var(--samche-vv-height, 100dvh) - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important; border-radius: 16px !important; } .samche-pos-left .samche-panel { right: auto !important; left: calc(16px + env(safe-area-inset-left, 0px)) !important; } .samche-panel.samche-open { position: fixed !important; inset: auto !important; bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important; right: calc(16px + env(safe-area-inset-right, 0px)) !important; width: min(380px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))) !important; max-width: 380px !important; height: calc(100vh - 20px) !important; height: calc(var(--samche-vv-height, 100dvh) - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important; max-height: calc(var(--samche-vv-height, 100dvh) - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important; border-radius: 16px !important; border: 1.5px solid var(--chat-glow-ring, rgba(56, 189, 248, 0.45)) !important; } .samche-pos-left .samche-panel.samche-open { right: auto !important; left: calc(16px + env(safe-area-inset-left, 0px)) !important; } }',
    '.samche-panel[dir="rtl"], .samche-wrap[dir="rtl"] { direction: rtl; text-align: right; }',
    '.samche-panel[dir="rtl"] .samche-msg-user { align-self: flex-start; border-radius: 16px 16px 16px 4px; }',
    '.samche-panel[dir="rtl"] .samche-msg-bot { align-self: flex-end; border-radius: 16px 16px 4px 16px; }',
    '.samche-panel[dir="rtl"] .samche-composer-input { text-align: right; }',
    '.samche-panel[dir="rtl"] .samche-send-btn svg { transform: scaleX(-1); }',
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } .samche-launcher, .samche-intent-pulse { animation: none !important; transition: none !important; } .samche-panel { transition: none !important; } }'
  ];

export const CANONICAL_WIDGET_CSS = CANONICAL_WIDGET_CSS_A.join('\n') + '\n' + CANONICAL_WIDGET_CSS_B.join('\n');

export const CHAT_ICON_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.5 21.5l4.646-.82A9.957 9.957 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.07-1.11l-.29-.17-2.76.49.5-2.69-.19-.3A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>';
export const CLOSE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
export const MINIMIZE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
export const SEND_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
export const TRASH_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

export interface LocaleDict {
  defaultTitle: string;
  defaultStatus: string;
  defaultLauncherLabel: string;
  clearBtnLabel: string;
  minimizeBtnLabel: string;
  closeBtnLabel: string;
  composerPlaceholder: string;
  sendLabel: string;
  confirmText: string;
  cancelBtn: string;
  clearBtn: string;
  clearingText: string;
  cannotClearHuman: string;
  cannotClearSending: string;
  browsingPrefix: string;
  botGreeting: string;
  userSample: string;
}

export const CANONICAL_I18N: Record<'tr' | 'en' | 'ar', LocaleDict> = {
  tr: {
    defaultTitle: 'Canlı Destek',
    defaultStatus: 'Çevrimiçi',
    defaultLauncherLabel: 'Canlı Destek',
    clearBtnLabel: 'Sohbeti Temizle',
    minimizeBtnLabel: 'Küçült',
    closeBtnLabel: 'Kapat',
    composerPlaceholder: 'Mesajınızı yazın...',
    sendLabel: 'Mesaj Gönder',
    confirmText: 'Sohbet geçmişini temizlemek istediğinize emin misiniz?',
    cancelBtn: 'İptal',
    clearBtn: 'Temizle',
    clearingText: 'Temizleniyor...',
    cannotClearHuman: 'Canlı destek temsilcisi görüşmesinde sohbet temizlenemez.',
    cannotClearSending: 'Mesaj iletilirken sohbet temizlenemez.',
    browsingPrefix: 'Gözatılan: ',
    botGreeting: 'Merhaba! Size nasıl yardımcı olabilirim?',
    userSample: 'Kargo ve teslimat süreleri hakkında bilgi alabilir miyim?',
  },
  en: {
    defaultTitle: 'Live Support',
    defaultStatus: 'Online',
    defaultLauncherLabel: 'Live Support',
    clearBtnLabel: 'Clear Conversation',
    minimizeBtnLabel: 'Minimize',
    closeBtnLabel: 'Close',
    composerPlaceholder: 'Type a message...',
    sendLabel: 'Send message',
    confirmText: 'Are you sure you want to clear this conversation?',
    cancelBtn: 'Cancel',
    clearBtn: 'Clear',
    clearingText: 'Clearing...',
    cannotClearHuman: 'Cannot clear conversation while human support is active.',
    cannotClearSending: 'Cannot clear conversation while sending a message.',
    browsingPrefix: 'Viewing: ',
    botGreeting: 'Hello! How can I help you today?',
    userSample: 'Can I get information about shipping and delivery times?',
  },
  ar: {
    defaultTitle: 'الدعم المباشر',
    defaultStatus: 'متصل',
    defaultLauncherLabel: 'الدعم المباشر',
    clearBtnLabel: 'مسح المحادثة',
    minimizeBtnLabel: 'تصغير',
    closeBtnLabel: 'إغلاق',
    composerPlaceholder: 'اكتب رسالة...',
    sendLabel: 'إرسال',
    confirmText: 'هل أنت متأكد أنك تريد مسح هذه المحادثة؟',
    cancelBtn: 'إلغاء',
    clearBtn: 'مسح',
    clearingText: 'جارٍ المسح...',
    cannotClearHuman: 'لا يمكن مسح المحادثة أثناء اتصال الدعم البشري.',
    cannotClearSending: 'لا يمكن مسح المحادثة أثناء إرسال الرسالة.',
    browsingPrefix: 'المعروض: ',
    botGreeting: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
    userSample: 'هل يمكنني الحصول على معلومات حول أوقات الشحن والتسليم؟',
  },
};

export function getEffectiveLocale(language?: string): 'tr' | 'en' | 'ar' {
  if (!language) return 'tr';
  const l = language.toLowerCase().trim();
  if (l === 'auto') {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const nav = navigator.language.toLowerCase();
      if (nav.startsWith('ar')) return 'ar';
      if (nav.startsWith('en')) return 'en';
    }
    return 'tr';
  }
  if (l.startsWith('ar')) return 'ar';
  if (l.startsWith('en')) return 'en';
  return 'tr';
}

export function normalizeHex(color?: string | null, fallback = '#2563EB'): string {
  if (!color || typeof color !== 'string') return fallback.toUpperCase();
  const trimmed = color.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (!hexMatch.test(trimmed)) return fallback.toUpperCase();
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return [r, g, b];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (val: number) => clamp(val).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = relativeLuminance(colorA);
  const lumB = relativeLuminance(colorB);
  const high = Math.max(lumA, lumB);
  const low = Math.min(lumA, lumB);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
}

export function hexToRgba(hex: string, alpha = 1): string {
  try {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch {
    return `rgba(37, 99, 235, ${alpha})`;
  }
}

export function getAccessibleForeground(backgroundColor: string): string {
  const whiteRatio = contrastRatio(backgroundColor, '#FFFFFF');
  const darkRatio = contrastRatio(backgroundColor, '#0F172A');
  if (whiteRatio >= 4.5) return '#FFFFFF';
  if (darkRatio >= 4.5) return '#0F172A';
  return whiteRatio >= darkRatio ? '#FFFFFF' : '#0F172A';
}

export function mixColors(colorA: string, colorB: string, ratio = 0.5): string {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  const r = rgbA[0] * (1 - ratio) + rgbB[0] * ratio;
  const g = rgbA[1] * (1 - ratio) + rgbB[1] * ratio;
  const b = rgbA[2] * (1 - ratio) + rgbB[2] * ratio;
  return rgbToHex([r, g, b]);
}

export function deriveCanonicalDesignTokens(params: {
  primaryColor?: string;
  accentColor?: string | null;
  mode?: 'dark' | 'light' | 'auto';
  glowIntensity?: number;
  glowSpread?: number;
  pulseAnimation?: string;
  animationSpeed?: string;
  launcherStyle?: string;
  launcherThemeMode?: 'auto_brand' | 'follow_theme' | 'custom';
  launcherBg?: string | null;
  launcherText?: string | null;
  launcherBorder?: string | null;
  launcherGlow?: string | null;
}) {
  const effectiveMode = params.mode === 'light' ? 'light' : 'dark';
  const rawPrimary = normalizeHex(params.primaryColor, '#2563EB');
  const safePrimary = rawPrimary;

  const rawAccent = params.accentColor
    ? normalizeHex(params.accentColor, safePrimary)
    : mixColors(safePrimary, effectiveMode === 'dark' ? '#FFFFFF' : '#000000', 0.18);
  const safeAccent = rawAccent;

  const isDark = effectiveMode === 'dark';
  const surfaceSolid = isDark ? '#111827' : '#FFFFFF';
  const surfaceTint = isDark
    ? mixColors('#0F172A', safePrimary, 0.10)
    : mixColors('#F8FAFC', safePrimary, 0.04);
  const surfaceGlass = isDark
    ? hexToRgba(mixColors('#0B0F19', safePrimary, 0.08), 0.82)
    : hexToRgba(mixColors('#FFFFFF', safePrimary, 0.03), 0.90);

  const textColor = isDark ? '#F8FAFC' : '#0F172A';
  const mutedColor = isDark ? '#94A3B8' : '#64748B';
  const borderColor = isDark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(15, 23, 42, 0.10)';

  const primaryForeground = getAccessibleForeground(safePrimary);
  const accentForeground = getAccessibleForeground(safeAccent);

  const clampedIntensity = Math.max(0, Math.min(100, Math.round(Number(params.glowIntensity ?? 80) || 0)));
  const clampedSpread = Math.max(0, Math.min(100, Math.round(Number(params.glowSpread ?? 70) || 0)));
  const intensityFactor = clampedIntensity / 80;
  const spreadFactor = clampedSpread / 70;

  const glowRing = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.65)).toFixed(2)));
  const glowColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.35)).toFixed(2)));
  const glowSoftColor = hexToRgba(safePrimary, Number(Math.min(1, Math.max(0, intensityFactor * 0.18)).toFixed(2)));
  const glowSpreadPx = Math.round(Math.max(4, spreadFactor * 24));
  const glowHaloPx = Math.round(Math.max(10, spreadFactor * 42));

  const normSpeed = String(params.animationSpeed || 'normal').toLowerCase();
  const pulseDuration = normSpeed === 'slow' ? '5.5s' : normSpeed === 'fast' ? '2.2s' : '3.6s';

  const effectiveLauncherThemeMode = ['auto_brand', 'follow_theme', 'custom'].includes(String(params.launcherThemeMode || '').toLowerCase())
    ? String(params.launcherThemeMode).toLowerCase()
    : 'follow_theme';

  let computedLauncherBg: string;
  let computedLauncherText: string;
  let computedLauncherBorder: string;
  let computedLauncherGlow: string;

  if (effectiveLauncherThemeMode === 'auto_brand') {
    computedLauncherBg = safePrimary;
    computedLauncherText = getAccessibleForeground(safePrimary);
    computedLauncherBorder = glowRing;
    computedLauncherGlow = glowColor;
  } else if (effectiveLauncherThemeMode === 'custom') {
    computedLauncherBg = params.launcherBg ? normalizeHex(params.launcherBg, isDark ? '#0F172A' : '#FFFFFF') : (isDark ? '#0F172A' : '#FFFFFF');
    computedLauncherGlow = params.launcherGlow ? normalizeHex(params.launcherGlow, safePrimary) : glowColor;
    computedLauncherBorder = params.launcherBorder ? normalizeHex(params.launcherBorder, glowRing) : glowRing;

    if (params.launcherText && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(params.launcherText).trim())) {
      const normText = normalizeHex(params.launcherText);
      const ratio = contrastRatio(computedLauncherBg, normText);
      computedLauncherText = ratio >= 4.5 ? normText : getAccessibleForeground(computedLauncherBg);
    } else {
      computedLauncherText = getAccessibleForeground(computedLauncherBg);
    }
  } else {
    // follow_theme: panel-matched launcher mode
    if (isDark) {
      computedLauncherBg = '#0F172A';
      computedLauncherText = '#FFFFFF';
      computedLauncherBorder = glowRing;
      computedLauncherGlow = glowColor;
    } else {
      computedLauncherBg = '#FFFFFF';
      computedLauncherText = '#0F172A';
      computedLauncherBorder = 'rgba(15, 23, 42, 0.12)';
      computedLauncherGlow = glowColor;
    }
  }

  const contrastLauncher = contrastRatio(computedLauncherBg, computedLauncherText);

  const inputBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.04)';
  const inputBorder = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.12)';
  const botBubbleBg = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.05)';
  const botBubbleBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';

  return {
    mode: effectiveMode,
    primary: safePrimary,
    primary_foreground: primaryForeground,
    accent: safeAccent,
    accent_foreground: accentForeground,
    surface_tint: surfaceTint,
    surface_solid: surfaceSolid,
    surface_glass: surfaceGlass,
    glow: glowColor,
    glow_soft: glowSoftColor,
    glow_ring: glowRing,
    glow_spread_px: glowSpreadPx,
    glow_halo_px: glowHaloPx,
    pulse_duration: pulseDuration,
    launcher_text: computedLauncherText,
    launcher_theme_mode: effectiveLauncherThemeMode,
    launcher_bg: computedLauncherBg,
    launcher_border: computedLauncherBorder,
    launcher_glow: computedLauncherGlow,
    text: textColor,
    muted: mutedColor,
    border: borderColor,
    input_bg: inputBg,
    input_border: inputBorder,
    bot_bubble_bg: botBubbleBg,
    bot_bubble_border: botBubbleBorder,
    contrast: {
      launcher: contrastLauncher,
    },
  };
}
