function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function response(status, body, headers = {}) {
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body,
  };
}

function parseBody(body) {
  if (body == null) return {};
  if (typeof body === 'object') return body;
  return Object.fromEntries(new URLSearchParams(String(body)));
}

const ICONS = {
  chat: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  objectives: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  approvals: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  automations: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  connectors: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  history: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
  media: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  settings: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  arrowUp: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  chevronRight: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  sparkle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"/></svg>`,
  mic: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
};

function navLabel(key) {
  const map = {
    chat: 'Assistente',
    objectives: 'Objetivos',
    approvals: 'Aprovações',
    automations: 'Automações',
    connectors: 'Conexões',
    history: 'Histórico',
    media: 'Arquivos',
    settings: 'Ajustes',
  };
  return map[key] || key;
}

function statusColor(status = '') {
  const s = String(status).toUpperCase();
  if (s.includes('COMPLETED') || s.includes('SUCCESS') || s.includes('CONNECTED')) return 'var(--ios-green)';
  if (s.includes('WAITING') || s.includes('PENDING') || s.includes('RUNNING')) return 'var(--ios-orange)';
  if (s.includes('FAILED') || s.includes('OVERDUE') || s.includes('ERROR') || s.includes('CANCELLED')) return 'var(--ios-red)';
  return 'var(--ios-blue)';
}

function statusBadge(status = '') {
  const color = statusColor(status);
  return `<span class="badge" style="color: ${color}; border-color: color-mix(in srgb, ${color} 35%, transparent); background: color-mix(in srgb, ${color} 10%, transparent);">${esc(status || 'PENDENTE')}</span>`;
}

function layout({ title = 'NaIA', active = 'chat', body = '', state = 'online', subtitle = '' } = {}) {
  const nav = ['chat', 'objectives', 'approvals', 'automations', 'connectors', 'history', 'media', 'settings'];

  const sidebarLinks = nav.map((item) => {
    const isAct = active === item;
    return `
      <a data-nav="${item}" class="sidebar-item ${isAct ? 'active' : ''}" ${isAct ? 'aria-current="page"' : ''} href="/surface/${item}">
        <span class="sidebar-icon icon-${item}">${ICONS[item] || ''}</span>
        <span class="sidebar-label">${esc(navLabel(item))}</span>
        <span class="sidebar-nav-name" style="display:none">${esc(item)}</span>
      </a>
    `;
  }).join('');

  const tabbarLinks = nav.slice(0, 5).map((item) => {
    const isAct = active === item;
    return `
      <a data-nav="${item}" class="tab-item ${isAct ? 'active' : ''}" ${isAct ? 'aria-current="page"' : ''} href="/surface/${item}">
        <span class="tab-icon">${ICONS[item] || ''}</span>
        <span class="tab-label">${esc(navLabel(item))}</span>
      </a>
    `;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="Deterministic personal intelligence agent with durable objective planning, approval controls, and multi-surface web interface.">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="Deterministic personal intelligence agent with durable objective planning, approval controls, and multi-surface web interface.">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
  <style>
    :root {
      --ios-bg: #F2F2F7;
      --ios-card: rgba(255, 255, 255, 0.88);
      --ios-card-solid: #FFFFFF;
      --ios-card-secondary: #F8F8FC;
      --ios-text: #000000;
      --ios-subtext: #8E8E93;
      --ios-separator: rgba(60, 60, 67, 0.14);
      --ios-separator-light: rgba(60, 60, 67, 0.08);
      --ios-blue: #007AFF;
      --ios-blue-tint: rgba(0, 122, 255, 0.12);
      --ios-green: #34C759;
      --ios-orange: #FF9500;
      --ios-red: #FF3B30;
      --ios-purple: #AF52DE;
      --ios-teal: #5AC8FA;
      --ios-fill: rgba(120, 120, 128, 0.16);
      --ios-blur: blur(28px) saturate(190%);
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --radius-full: 9999px;
      --shadow-subtle: 0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.03);
      --shadow-hover: 0 8px 28px -4px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      color-scheme: light dark;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --ios-bg: #000000;
        --ios-card: rgba(28, 28, 30, 0.85);
        --ios-card-solid: #1C1C1E;
        --ios-card-secondary: #2C2C2E;
        --ios-text: #FFFFFF;
        --ios-subtext: #98989D;
        --ios-separator: rgba(84, 84, 88, 0.45);
        --ios-separator-light: rgba(84, 84, 88, 0.22);
        --ios-fill: rgba(120, 120, 128, 0.32);
        --shadow-subtle: 0 4px 24px -2px rgba(0, 0, 0, 0.4);
        --shadow-hover: 0 8px 32px -4px rgba(0, 0, 0, 0.55);
      }
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      margin: 0;
      padding: 0;
      background: var(--ios-bg);
      color: var(--ios-text);
      min-height: 100vh;
      font-size: 15px;
      line-height: 1.45;
    }

    .app, .app-container {
      display: flex;
      min-height: 100vh;
      width: 100%;
    }

    /* iPadOS / macOS Style Sidebar */
    .sidebar {
      width: 260px;
      flex-shrink: 0;
      background: var(--ios-card);
      backdrop-filter: var(--ios-blur);
      -webkit-backdrop-filter: var(--ios-blur);
      border-right: 1px solid var(--ios-separator);
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 20px 14px;
      z-index: 30;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 12px 18px;
      text-decoration: none;
      color: var(--ios-text);
    }

    .sidebar-avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #007AFF 0%, #AF52DE 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 16px;
      box-shadow: 0 2px 8px rgba(0, 122, 255, 0.35);
    }

    .sidebar-title-group h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .sidebar-title-group p {
      margin: 0;
      font-size: 11px;
      color: var(--ios-subtext);
      font-weight: 500;
    }

    .sidebar-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ios-subtext);
      padding: 12px 12px 6px;
      margin: 0;
    }

    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      overflow-y: auto;
    }

    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      text-decoration: none;
      color: var(--ios-text);
      font-size: 14px;
      font-weight: 500;
      transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .sidebar-item:hover {
      background: var(--ios-fill);
    }

    .sidebar-item.active {
      background: var(--ios-blue);
      color: #FFFFFF;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0, 122, 255, 0.3);
    }

    .sidebar-item.active .sidebar-icon {
      color: #FFFFFF;
    }

    .sidebar-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ios-blue);
      transition: color 0.16s ease;
    }

    .sidebar-item:not(.active) .icon-approvals { color: var(--ios-orange); }
    .sidebar-item:not(.active) .icon-automations { color: var(--ios-purple); }
    .sidebar-item:not(.active) .icon-connectors { color: var(--ios-teal); }
    .sidebar-item:not(.active) .icon-settings { color: var(--ios-subtext); }

    .sidebar-footer {
      padding: 14px 12px 6px;
      border-top: 1px solid var(--ios-separator);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--ios-subtext);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ios-green);
      box-shadow: 0 0 6px var(--ios-green);
    }

    .status-dot.offline {
      background: var(--ios-orange);
      box-shadow: 0 0 6px var(--ios-orange);
    }

    /* Main Content Surface */
    .main-viewport {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-width: 100%;
    }

    /* iOS Navigation Bar */
    .ios-navbar {
      position: sticky;
      top: 0;
      z-index: 25;
      background: var(--ios-card);
      backdrop-filter: var(--ios-blur);
      -webkit-backdrop-filter: var(--ios-blur);
      border-bottom: 1px solid var(--ios-separator);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 56px;
    }

    .ios-navbar-title-group {
      display: flex;
      flex-direction: column;
    }

    .ios-navbar-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .ios-navbar-subtitle {
      margin: 0;
      font-size: 12px;
      color: var(--ios-subtext);
    }

    .content-canvas {
      padding: 28px 32px 60px;
      max-width: 1040px;
      width: 100%;
      margin: 0 auto;
    }

    /* iOS Inset Grouped Cards */
    .ios-group {
      margin-bottom: 24px;
    }

    .ios-group-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ios-subtext);
      margin: 0 0 8px 14px;
    }

    .card, .ios-card {
      background: var(--ios-card-solid);
      border: 1px solid var(--ios-separator);
      border-radius: var(--radius-lg);
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-subtle);
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }

    .card:hover, .ios-card:hover {
      box-shadow: var(--shadow-hover);
    }

    .ios-inset-list {
      background: var(--ios-card-solid);
      border: 1px solid var(--ios-separator);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-subtle);
      margin-bottom: 20px;
    }

    .ios-list-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      text-decoration: none;
      color: var(--ios-text);
      border-bottom: 1px solid var(--ios-separator-light);
      transition: background 0.12s ease;
    }

    .ios-list-row:last-child {
      border-bottom: none;
    }

    .ios-list-row:hover {
      background: var(--ios-fill);
    }

    .ios-row-main {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      flex: 1;
    }

    .ios-row-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
      flex-shrink: 0;
    }

    .ios-row-text {
      min-width: 0;
    }

    .ios-row-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ios-row-subtitle {
      font-size: 12px;
      color: var(--ios-subtext);
      margin: 2px 0 0;
    }

    .ios-row-action {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      color: var(--ios-subtext);
    }

    /* iOS Buttons & Inputs */
    button, .btn {
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--ios-blue);
      color: #FFFFFF;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 2px 8px rgba(0, 122, 255, 0.25);
    }

    button:hover, .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 122, 255, 0.35);
    }

    button:active, .btn:active {
      transform: scale(0.97);
    }

    .btn-secondary {
      background: var(--ios-fill);
      color: var(--ios-text);
      box-shadow: none;
    }

    .btn-secondary:hover {
      background: color-mix(in srgb, var(--ios-fill) 85%, var(--ios-text));
      box-shadow: none;
    }

    .btn-danger {
      background: var(--ios-red);
      color: white;
      box-shadow: 0 2px 8px rgba(255, 59, 48, 0.25);
    }

    input, textarea {
      font-family: inherit;
      font-size: 15px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      border: 1px solid var(--ios-separator);
      background: var(--ios-card-secondary);
      color: var(--ios-text);
      outline: none;
      transition: border-color 0.16s ease, box-shadow 0.16s ease;
    }

    input:focus, textarea:focus {
      border-color: var(--ios-blue);
      box-shadow: 0 0 0 3px var(--ios-blue-tint);
    }

    /* iOS Siri Style Assistant Input Bar */
    .assistant-hero {
      background: linear-gradient(135deg, rgba(0, 122, 255, 0.08) 0%, rgba(175, 82, 222, 0.08) 100%);
      border: 1px solid var(--ios-separator);
      border-radius: var(--radius-lg);
      padding: 28px 24px;
      margin-bottom: 28px;
      position: relative;
      overflow: hidden;
    }

    .assistant-glow {
      position: absolute;
      top: -30px;
      right: -30px;
      width: 140px;
      height: 140px;
      background: radial-gradient(circle, rgba(0, 122, 255, 0.3) 0%, rgba(175, 82, 222, 0.15) 50%, transparent 70%);
      pointer-events: none;
      filter: blur(20px);
    }

    .prompt-form {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    .prompt-input-wrapper {
      position: relative;
      flex: 1;
    }

    .prompt-input {
      width: 100%;
      padding: 14px 44px 14px 18px;
      font-size: 15px;
      border-radius: var(--radius-full);
      background: var(--ios-card-solid);
      border: 1px solid var(--ios-separator);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
    }

    .prompt-submit-btn {
      width: 46px;
      height: 46px;
      border-radius: var(--radius-full);
      padding: 0;
      flex-shrink: 0;
    }

    .suggestion-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }

    .suggestion-chip {
      background: var(--ios-card-solid);
      border: 1px solid var(--ios-separator);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 500;
      color: var(--ios-text);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.14s ease;
    }

    .suggestion-chip:hover {
      border-color: var(--ios-blue);
      color: var(--ios-blue);
      transform: translateY(-1px);
    }

    /* Siri-style wave animation keys */
    .siri-wave-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 24px;
      padding: 0 8px;
      opacity: 0.85;
      vertical-align: middle;
    }
    .siri-bar {
      width: 3px;
      height: 4px;
      background: linear-gradient(180deg, var(--ios-blue) 0%, var(--ios-purple) 100%);
      border-radius: var(--radius-full);
      animation: bounce 1s ease-in-out infinite alternate;
    }
    .siri-bar:nth-child(2) { height: 8px; animation-delay: 0.15s; background: linear-gradient(180deg, var(--ios-purple) 0%, var(--ios-teal) 100%); }
    .siri-bar:nth-child(3) { height: 14px; animation-delay: 0.3s; background: linear-gradient(180deg, var(--ios-teal) 0%, var(--ios-green) 100%); }
    .siri-bar:nth-child(4) { height: 18px; animation-delay: 0.45s; background: linear-gradient(180deg, #FF2D55 0%, var(--ios-orange) 100%); }
    .siri-bar:nth-child(5) { height: 10px; animation-delay: 0.6s; background: linear-gradient(180deg, var(--ios-orange) 0%, var(--ios-blue) 100%); }
    @keyframes bounce {
      0% { transform: scaleY(0.3); }
      100% { transform: scaleY(1.3); }
    }

    /* Live Activity Widget Styling */
    .ios-live-activity {
      border: 1px solid var(--ios-separator);
      background: linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(240,240,255,0.7) 100%);
      position: relative;
      border-radius: 18px;
      padding: 16px;
      margin-bottom: 24px;
      box-shadow: var(--shadow-subtle);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    @media (prefers-color-scheme: dark) {
      .ios-live-activity {
        background: linear-gradient(135deg, rgba(28,28,30,0.7) 0%, rgba(44,44,46,0.7) 100%);
      }
    }

    /* Badges & Pills */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--radius-full);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      border: 1px solid currentColor;
      text-transform: uppercase;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }

    .error, .offline {
      border-left: 4px solid var(--ios-red);
      background: color-mix(in srgb, var(--ios-red) 8%, var(--ios-card-solid));
      border-radius: var(--radius-md);
      padding: 14px 18px;
      margin-bottom: 16px;
    }

    .offline {
      border-left-color: var(--ios-orange);
      background: color-mix(in srgb, var(--ios-orange) 8%, var(--ios-card-solid));
    }

    .muted { color: var(--ios-subtext); }

    /* Timeline / Steps */
    .step-timeline {
      list-style: none;
      padding: 0;
      margin: 16px 0;
    }

    .step-item {
      display: flex;
      gap: 14px;
      padding: 12px 0;
      border-bottom: 1px solid var(--ios-separator-light);
    }

    .step-item:last-child {
      border-bottom: none;
    }

    .step-bullet {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--ios-fill);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      color: var(--ios-subtext);
    }

    .step-bullet.completed {
      background: var(--ios-green);
      color: white;
    }

    .step-bullet.running {
      background: var(--ios-blue);
      color: white;
      animation: pulse 1.5s infinite;
    }

    .step-bullet.failed {
      background: var(--ios-red);
      color: white;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.92); }
    }

    /* Fixed Bottom Tab Bar for Mobile */
    .mobile-tabbar {
      display: none;
    }

    /* Mobile Responsive Overrides */
    @media (max-width:720px){
      .app, .app-container {
        grid-template-columns:1fr;
        flex-direction: column;
      }
      .sidebar {
        display: none;
      }
      .ios-navbar {
        padding: 12px 18px;
      }
      .content-canvas {
        padding: 16px 16px 88px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .mobile-tabbar {
        display: flex;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 64px;
        padding-bottom: env(safe-area-inset-bottom, 8px);
        background: var(--ios-card);
        backdrop-filter: var(--ios-blur);
        -webkit-backdrop-filter: var(--ios-blur);
        border-top: 1px solid var(--ios-separator);
        z-index: 40;
        justify-content: space-around;
        align-items: center;
      }
      .tab-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        color: var(--ios-subtext);
        font-size: 10px;
        font-weight: 500;
        flex: 1;
        height: 100%;
        gap: 3px;
        transition: color 0.12s ease;
      }
      .tab-item.active {
        color: var(--ios-blue);
        font-weight: 600;
      }
      .tab-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }
  </style>
</head>
<body data-app-state="${esc(state)}">
  <div class="app app-container">
    <!-- iPadOS Sidebar -->
    <aside class="sidebar">
      <a href="/" class="sidebar-brand">
        <div class="sidebar-avatar">N</div>
        <div class="sidebar-title-group">
          <h2>NaIA</h2>
          <p>Inteligência Pessoal</p>
        </div>
      </a>

      <p class="sidebar-section-title">Navegação</p>
      <nav class="sidebar-nav" aria-label="Navegação principal">
        ${sidebarLinks}
      </nav>

      <div class="sidebar-footer">
        <div class="status-indicator">
          <span class="status-dot ${state === 'offline' ? 'offline' : ''}"></span>
          <span>${state === 'offline' ? 'Offline' : 'Online'}</span>
        </div>
        <span class="muted" style="font-size: 11px;">v2.6</span>
      </div>
    </aside>

    <!-- Main Viewport Area -->
    <div class="main-viewport">
      <header class="ios-navbar">
        <div class="ios-navbar-title-group">
          <h1 class="ios-navbar-title">${esc(title)}</h1>
          ${subtitle ? `<p class="ios-navbar-subtitle">${esc(subtitle)}</p>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <a href="/surface/settings" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">
            ${ICONS.settings}
            <span>Ajustes</span>
          </a>
        </div>
      </header>

      <main class="content-canvas">
        ${body}
      </main>
    </div>

    <!-- iOS Bottom Tab Bar (Mobile) -->
    <nav class="mobile-tabbar" aria-label="Navegação móvel">
      ${tabbarLinks}
    </nav>
  </div>
</body>
</html>`;
}

function objectiveCard(row = {}) {
  return `
    <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 12px;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
          <h3 style="margin: 0; font-size: 15px; font-weight: 600; word-break: break-word;">${esc(row.title ?? row.id)}</h3>
          ${statusBadge(row.status)}
        </div>
        <p class="muted" style="font-size: 12px; margin: 0;">ID: ${esc(row.id)}</p>
      </div>
      <div style="display: flex; justify-content: flex-end; padding-top: 4px;">
        <a href="/objective/${encodeURIComponent(row.id)}" class="btn btn-secondary" style="padding: 6px 14px; font-size: 13px;">
          Abrir ${ICONS.chevronRight}
        </a>
      </div>
    </div>
  `;
}

function chatView(history = {}) {
  const recent = (history.objectives ?? []).slice(0, 6);
  const runningObjective = (history.objectives ?? []).find(o => o.status === 'RUNNING' || o.status === 'WAITING_APPROVAL' || o.status === 'WAITING_CONFIRMATION');

  let liveActivityHtml = '';
  if (runningObjective) {
    liveActivityHtml = `
      <div class="ios-live-activity" style="display: flex; align-items: center; justify-content: space-between; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--ios-blue-tint); color: var(--ios-blue); display: flex; align-items: center; justify-content: center; position: relative;">
            ${ICONS.sparkle}
            <span style="position: absolute; top: -1px; right: -1px; width: 10px; height: 10px; background: var(--ios-orange); border: 2px solid var(--ios-card-solid); border-radius: 50%;"></span>
          </div>
          <div>
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ios-subtext);">Atividade em Tempo Real</div>
            <strong style="font-size: 14px; display: block; margin-top: 1px;">${esc(runningObjective.title)}</strong>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${statusBadge(runningObjective.status)}
          <a href="/objective/${encodeURIComponent(runningObjective.id)}" class="btn" style="padding: 6px 12px; font-size: 12px; border-radius: 12px;">
            Acompanhar
          </a>
        </div>
      </div>
    `;
  }

  return `
    ${liveActivityHtml}

    <section class="assistant-hero">
      <div class="assistant-glow"></div>
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
        <span style="color: var(--ios-blue); display: flex;">${ICONS.sparkle}</span>
        <h2 style="margin: 0; font-size: 18px; font-weight: 700;">Como posso ajudar você hoje?</h2>
      </div>
      <p class="muted" style="margin: 0; font-size: 13px;">Planeje objetivos duráveis, agende tarefas e orquestre automações.</p>
      
      <form method="post" action="/submit" class="prompt-form">
        <div class="prompt-input-wrapper" style="display: flex; align-items: center; position: relative;">
          <input name="text" class="prompt-input" required placeholder="Digite seu comando ou objetivo..." autocomplete="off" style="padding-left: 44px; padding-right: 48px;">
          <button type="button" aria-label="Ativar entrada por voz" style="position: absolute; left: 12px; color: var(--ios-subtext); display: flex; align-items: center; background: none; border: none; padding: 4px; cursor: pointer;" onclick="document.querySelector('.siri-wave-container').style.display='inline-flex'">
            ${ICONS.mic}
          </button>
          <div class="siri-wave-container" style="display: none; position: absolute; right: 14px;">
            <div class="siri-bar"></div>
            <div class="siri-bar"></div>
            <div class="siri-bar"></div>
            <div class="siri-bar"></div>
            <div class="siri-bar"></div>
          </div>
        </div>
        <button type="submit" class="prompt-submit-btn" aria-label="Enviar comando" title="Enviar" style="background: linear-gradient(135deg, var(--ios-blue) 0%, var(--ios-purple) 100%);">
          ${ICONS.arrowUp}
        </button>
      </form>

      <div class="suggestion-chips">
        <button type="button" onclick="document.querySelector('input[name=text]').value='Organizar despesas e contas pendentes deste mês'; document.querySelector('.siri-wave-container').style.display='inline-flex'" class="suggestion-chip">💡 Organizar contas do mês</button>
        <button type="button" onclick="document.querySelector('input[name=text]').value='Agendar lembrete diário para revisão de prioridades às 09:00'; document.querySelector('.siri-wave-container').style.display='inline-flex'" class="suggestion-chip">⏰ Agendar rotina diária</button>
        <button type="button" onclick="document.querySelector('input[name=text]').value='Sincronizar arquivos e verificar fotos duplicadas'; document.querySelector('.siri-wave-container').style.display='inline-flex'" class="suggestion-chip">📂 Sincronizar arquivos</button>
      </div>
    </section>

    <div class="ios-group">
      <h3 class="ios-group-title">Objetivos Recentes</h3>
      ${recent.length > 0
        ? `<div class="grid">${recent.map(objectiveCard).join('')}</div>`
        : `<div class="card muted" style="text-align: center; padding: 32px;">Nenhum objetivo recente iniciado. Faça seu primeiro pedido acima!</div>`
      }
    </div>
  `;
}

function objectiveView(o = {}) {
  const steps = o.steps ?? [];
  return `
    <div style="margin-bottom: 16px;">
      <a href="/surface/chat" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px; margin-bottom: 14px;">
        ← Voltar ao Início
      </a>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
        <div>
          <h1 style="margin: 0 0 6px; font-size: 22px; font-weight: 700;">${esc(o.title ?? o.id)}</h1>
          <p class="muted" style="margin: 0; font-size: 13px;">ID: ${esc(o.id)}</p>
        </div>
        ${statusBadge(o.status)}
      </div>
      ${o.description ? `<p style="margin: 12px 0 0; font-size: 14px;">${esc(o.description)}</p>` : ''}
    </div>

    <div class="ios-group">
      <h3 class="ios-group-title">Plano de Execução & Etapas</h3>
      <div class="card" style="padding: 10px 20px;">
        ${steps.length > 0 ? `
          <ul class="step-timeline">
            ${steps.map((s, idx) => {
              const isDone = s.status === 'COMPLETED';
              const isRun = s.status === 'RUNNING' || s.status === 'AWAITING_APPROVAL';
              const isFail = s.status === 'FAILED';
              const bulletClass = isDone ? 'completed' : isRun ? 'running' : isFail ? 'failed' : '';
              return `
                <li class="step-item">
                  <div class="step-bullet ${bulletClass}">${isDone ? ICONS.check : (idx + 1)}</div>
                  <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                      <strong style="font-size: 14px;">${esc(s.kind)} ${s.tool ? `· <span class="muted">${esc(s.tool)}</span>` : ''}</strong>
                      ${statusBadge(s.status)}
                    </div>
                    ${s.risk ? `<p style="margin: 4px 0 0; font-size: 12px; color: var(--ios-orange);">Risco: ${esc(s.risk)}</p>` : ''}
                    ${s.error ? `<p style="margin: 4px 0 0; font-size: 12px; color: var(--ios-red);">${esc(s.error)}</p>` : ''}
                  </div>
                </li>
              `;
            }).join('')}
          </ul>
        ` : `<p class="muted">Nenhuma etapa registrada no plano.</p>`}
      </div>
    </div>

    <div style="display: flex; gap: 10px; margin-top: 20px;">
      <form method="post" action="/resume">
        <input type="hidden" name="objectiveId" value="${esc(o.id)}">
        <button type="submit" class="btn">
          <span>Retry / Resume</span>
        </button>
      </form>
    </div>
  `;
}

function approvalsView(data = {}) {
  const approvals = data.approvals ?? [];
  const confirmations = data.confirmations ?? [];

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Approvals</h1>
    </div>

    ${approvals.length === 0 && confirmations.length === 0 ? `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--ios-blue-tint); color: var(--ios-blue); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;">
          ${ICONS.approvals}
        </div>
        <h3 style="margin: 0 0 6px; font-size: 17px;">Tudo em dia!</h3>
        <p class="muted" style="margin: 0; font-size: 14px;">No pending approvals.</p>
      </div>
    ` : ''}

    ${approvals.length > 0 ? `
      <div class="ios-group">
        <h3 class="ios-group-title">Aprovações de Segurança Pendentes (${approvals.length})</h3>
        <div class="grid">
          ${approvals.map((item) => `
            <div class="card" style="border-left: 4px solid var(--ios-orange);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <strong style="font-size: 15px;">${esc(item.tool)}</strong>
                <span class="badge" style="color: var(--ios-orange); border-color: currentColor;">${esc(item.risk ?? 'HIGH')}</span>
              </div>
              <p class="muted" style="font-size: 12px; margin: 0 0 14px;">Objetivo: ${esc(item.objectiveId)}</p>
              <form method="post" action="/approve">
                <input type="hidden" name="objectiveId" value="${esc(item.objectiveId)}">
                <input type="hidden" name="tool" value="${esc(item.tool)}">
                <button type="submit" class="btn" style="width: 100%;">
                  ${ICONS.check} Approve
                </button>
              </form>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${confirmations.length > 0 ? `
      <div class="ios-group">
        <h3 class="ios-group-title">Confirmações do Usuário (${confirmations.length})</h3>
        <div class="grid">
          ${confirmations.map((item) => `
            <div class="card" style="border-left: 4px solid var(--ios-blue);">
              <strong style="font-size: 15px; display: block; margin-bottom: 6px;">Confirmation ${esc(item.confirmationId)}</strong>
              <p class="muted" style="font-size: 12px; margin: 0 0 14px;">Objetivo: ${esc(item.objectiveId)}</p>
              <form method="post" action="/confirm">
                <input type="hidden" name="objectiveId" value="${esc(item.objectiveId)}">
                <input type="hidden" name="confirmationId" value="${esc(item.confirmationId)}">
                <button type="submit" class="btn" style="width: 100%;">
                  ${ICONS.check} Confirm
                </button>
              </form>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function automationsView(data = {}) {
  const items = data.items ?? [];
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Automations</h1>
    </div>

    ${data.available === false ? `
      <div class="card offline"><p>Automation service unavailable.</p></div>
    ` : items.length === 0 ? `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(175, 82, 222, 0.12); color: var(--ios-purple); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;">
          ${ICONS.automations}
        </div>
        <h3 style="margin: 0 0 6px; font-size: 17px;">Nenhuma rotina ativa</h3>
        <p class="muted" style="margin: 0;">No automations.</p>
      </div>
    ` : `
      <div class="ios-inset-list">
        ${items.map((item) => `
          <div class="ios-list-row">
            <div class="ios-row-main">
              <div class="ios-row-icon" style="background: linear-gradient(135deg, #AF52DE 0%, #5856D6 100%);">
                ${ICONS.automations}
              </div>
              <div class="ios-row-text">
                <div class="ios-row-title">${esc(item.title ?? item.name ?? item.id)}</div>
                <div class="ios-row-subtitle">${esc(item.userState ?? item.status ?? 'ACTIVE')}</div>
              </div>
            </div>
            <div class="ios-row-action">
              <form method="post" action="/automation/cancel" style="margin: 0;">
                <input type="hidden" name="id" value="${esc(item.id)}">
                <button type="submit" class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;">
                  Cancel
                </button>
              </form>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function connectorsView(data = {}) {
  const list = data.connectors ?? [];
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Connectors</h1>
    </div>

    ${data.available === false ? `
      <div class="card offline"><p>Connector service unavailable.</p></div>
    ` : list.length === 0 ? `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <p class="muted">No connectors.</p>
      </div>
    ` : `
      <div class="ios-inset-list">
        ${list.map((item) => `
          <div class="ios-list-row">
            <div class="ios-row-main">
              <div class="ios-row-icon" style="background: linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%);">
                ${ICONS.connectors}
              </div>
              <div class="ios-row-text">
                <div class="ios-row-title">${esc(item.provider ?? item.kind ?? item.id)}</div>
                <div class="ios-row-subtitle">ID: ${esc(item.id)}</div>
              </div>
            </div>
            <div class="ios-row-action">
              ${statusBadge(item.state ?? 'AVAILABLE')}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function historyView(history = {}, advanced = {}) {
  const rows = advanced.available ? (advanced.items ?? []) : (history.objectives ?? []);
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">History</h1>
    </div>

    ${rows.length === 0 ? `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <p class="muted">No history.</p>
      </div>
    ` : `
      <div class="grid">
        ${rows.map(objectiveCard).join('')}
      </div>
    `}
  `;
}

function mediaView(data = {}) {
  const items = data.items ?? [];
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Media</h1>
    </div>

    ${data.available === false ? `
      <div class="card offline"><p class="muted">Media inventory unavailable.</p></div>
    ` : items.length === 0 ? `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <p class="muted">Nenhum arquivo ou foto sincronizado.</p>
      </div>
    ` : `
      <div class="grid">
        ${items.map((item) => `
          <div class="card" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(0, 122, 255, 0.12); color: var(--ios-blue); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                ${ICONS.media}
              </div>
              <div style="min-width: 0; flex: 1;">
                <strong style="display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(item.displayName ?? item.id)}</strong>
                <span class="muted" style="font-size: 11px;">${esc(item.mediaType ?? item.fileKind ?? item.mimeType ?? 'Arquivo')}</span>
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 12px;">
              <span class="muted">${esc(item.sourceType ?? 'device')}</span>
              <span class="badge" style="color: var(--ios-blue); border-color: currentColor;">Sincronizado</span>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function settingsView(data = {}) {
  const plan = data.plan ?? null;
  const usage = data.usage ?? [];

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Settings</h1>
    </div>

    ${data.available === false ? `
      <div class="card offline"><p class="muted">Premium state unavailable.</p></div>
    ` : `
      <div class="ios-group">
        <h3 class="ios-group-title">Assinatura & Plano</h3>
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <h2 style="margin: 0; font-size: 18px; font-weight: 700;">Plan ${esc(plan?.id ?? 'FREE')}</h2>
              <p class="muted" style="margin: 4px 0 0; font-size: 13px;">Status: ${esc(plan?.billingState ?? 'ACTIVE')}</p>
            </div>
            <span class="badge" style="color: var(--ios-green); border-color: currentColor;">Ativo</span>
          </div>
        </div>
      </div>

      <div class="ios-group">
        <h3 class="ios-group-title">Uso & Cotas</h3>
        <div class="ios-inset-list">
          ${usage.map((u) => `
            <div class="ios-list-row">
              <div class="ios-row-main">
                <div class="ios-row-text">
                  <strong class="ios-row-title">${esc(u.metric)}</strong>
                  <div class="ios-row-subtitle">Consumo acumulado</div>
                </div>
              </div>
              <div class="ios-row-action">
                <span style="font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums;">
                  ${esc(u.used)} / ${esc(u.limit ?? '∞')}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `}
  `;
}

export function createProductionWebUi({ api } = {}) {
  if (!api || typeof api.shell !== 'function') throw new Error('frontend api is required');

  async function shellSafe() {
    try {
      const data = await api.shell();
      return data?.ok === false
        ? { ok: false, data, error: { message: 'One or more frontend surfaces failed', retryable: true } }
        : { ok: true, data };
    } catch (error) {
      return { ok: false, error: { message: error?.message ?? String(error), retryable: true } };
    }
  }

  return {
    async handle({ method = 'GET', path = '/', body = null } = {}) {
      const verb = String(method).toUpperCase();
      try {
        if (verb === 'GET' && (path === '/' || path.startsWith('/surface/'))) {
          const active = path === '/' ? 'chat' : decodeURIComponent(path.slice('/surface/'.length));
          const shell = await shellSafe();

          if (!shell.ok) {
            return response(
              503,
              layout({
                title: 'NaIA offline',
                active,
                state: 'offline',
                body: `
                  <div class="offline error">
                    <strong style="font-size: 16px; display: block; margin-bottom: 6px;">Offline / degraded</strong>
                    <p style="margin: 0 0 12px;">${esc(shell.error?.message)}</p>
                    <a href="${esc(path)}" class="btn btn-secondary" style="padding: 6px 14px; font-size: 13px;">Retry</a>
                  </div>
                `,
              })
            );
          }

          const s = shell.data.surfaces ?? {};
          let view;
          let title = `NaIA · ${navLabel(active)}`;

          if (active === 'chat' || active === 'objectives') {
            view = chatView(s.history ?? {});
            title = 'NaIA';
          } else if (active === 'approvals') {
            view = approvalsView(s.approvals ?? {});
            title = 'Approvals';
          } else if (active === 'automations') {
            view = automationsView(s.automations ?? {});
            title = 'Automations';
          } else if (active === 'connectors') {
            view = connectorsView(s.connectors ?? {});
            title = 'Connectors';
          } else if (active === 'history') {
            view = historyView(s.history ?? {}, s.advancedHistory ?? {});
            title = 'History';
          } else if (active === 'media') {
            view = mediaView(s.media ?? {});
            title = 'Media';
          } else if (active === 'settings') {
            view = settingsView(s.premium ?? {});
            title = 'Settings';
          } else {
            return response(404, layout({ title: 'Not found', active: 'chat', body: '<h1>Not found</h1>' }));
          }

          return response(200, layout({ title, active, body: view }));
        }

        if (verb === 'GET' && path.startsWith('/objective/')) {
          const id = decodeURIComponent(path.slice('/objective/'.length));
          const result = await api.objective(id);
          return response(
            result.ok ? 200 : 404,
            layout({
              title: result.ok ? (result.objective?.title ?? 'Objective') : 'Objective',
              active: 'objectives',
              body: result.ok
                ? objectiveView(result.objective)
                : `<div class="error">${esc(result.error?.message)}</div>`,
            })
          );
        }

        const input = parseBody(body);

        if (verb === 'POST' && path === '/submit') {
          const r = await api.submit({ text: input.text ?? '', description: input.description ?? '' });
          return response(
            r.ok ? 200 : 400,
            layout({
              title: 'NaIA',
              active: 'chat',
              body: r.ok ? objectiveView(r.objective) : `<div class="error">${esc(r.error?.message)}</div>`,
            })
          );
        }

        if (verb === 'POST' && path === '/approve') {
          const r = await api.approve({ objectiveId: input.objectiveId, tool: input.tool });
          return response(
            r.ok ? 200 : 400,
            layout({
              title: 'Approval',
              active: 'approvals',
              body: r.ok ? objectiveView(r.objective) : `<div class="error">${esc(r.error?.message)}</div>`,
            })
          );
        }

        if (verb === 'POST' && path === '/confirm') {
          const r = await api.confirm({ objectiveId: input.objectiveId, confirmationId: input.confirmationId });
          return response(
            r.ok ? 200 : 400,
            layout({
              title: 'Confirmation',
              active: 'approvals',
              body: r.ok ? objectiveView(r.objective) : `<div class="error">${esc(r.error?.message)}</div>`,
            })
          );
        }

        if (verb === 'POST' && path === '/resume') {
          const r = await api.resume(input.objectiveId);
          return response(
            r.ok ? 200 : 400,
            layout({
              title: 'Resume',
              active: 'objectives',
              body: r.ok ? objectiveView(r.objective) : `<div class="error">${esc(r.error?.message)}</div>`,
            })
          );
        }

        if (verb === 'POST' && path === '/automation/cancel') {
          const r = await api.cancelAutomation(input.id);
          return response(
            r.ok ? 200 : 400,
            layout({
              title: 'Automations',
              active: 'automations',
              body: r.ok
                ? '<div class="card"><p>Automation cancelled.</p><a href="/surface/automations" class="btn btn-secondary">Voltar</a></div>'
                : `<div class="error">${esc(r.error?.message)}</div>`,
            })
          );
        }

        return response(404, layout({ title: 'Not found', active: 'chat', body: '<h1>Not found</h1>' }));
      } catch (error) {
        return response(
          500,
          layout({
            title: 'Error',
            active: 'chat',
            body: `<div class="error"><strong>Error</strong><p>${esc(error?.message ?? error)}</p><a href="${esc(path)}">Retry</a></div>`,
          })
        );
      }
    },
  };
}
