/**
 * Jarvis preview-bridge.
 *
 * A tiny script we inject into every deployed user app. It runs in
 * the deployed page (inside the preview iframe) and provides a stable
 * `postMessage` protocol the Jarvis workspace UI uses for:
 *
 *  - E3 runtime error capture (`window.onerror`, unhandled promise
 *    rejections, console.error mirroring → "Send to Jarvis" pill).
 *  - E6 click-to-edit (parent toggles `pickMode`; bridge intercepts
 *    clicks, finds the nearest `data-jarvis-src` attribute, and
 *    posts back the source location so the chat can pre-fill).
 *  - E13 analytics auto-injection (the bridge exposes a simple
 *    `window.jarvisTrack(event, props)` and forwards events to the
 *    configured provider — Plausible / PostHog — once the parent
 *    sends a `setAnalytics` config message).
 *  - SPA navigation events so the workspace can keep its URL bar in
 *    sync with the iframe without polling.
 *
 * The bridge is intentionally framework-agnostic and dependency-free
 * so it works for the React/Vue/vanilla apps Jarvis can generate.
 *
 * Wire format (iframe → parent):
 *   { type: 'jarvis:ready' }
 *   { type: 'jarvis:error',  error:   { message, stack, source, line, col, kind, ts } }
 *   { type: 'jarvis:console', level, args, ts }
 *   { type: 'jarvis:nav',     from,  to,    ts }
 *   { type: 'jarvis:click',   path,  label, ts }   // pick mode only
 *   { type: 'jarvis:track',   event, props, ts }
 *
 * Wire format (parent → iframe):
 *   { type: 'jarvis:setPickMode',  enabled: boolean }
 *   { type: 'jarvis:setAnalytics', provider: 'plausible'|'posthog'|'none', key?: string, host?: string }
 *   { type: 'jarvis:reload' }
 */

export const PREVIEW_BRIDGE_JS = `(function () {
  if (window.__jarvisBridge) return;

  // We send to '*' because the preview is on a *.jarvis.site domain
  // but the workspace shell can be on dev.jarvis.site / app.jarvis.site
  // / localhost. The parent validates the message shape, not origin.
  var TARGET_ORIGIN = '*';
  var pickMode = false;
  var lastUrl = location.href;
  var queue = [];

  function post(msg) {
    try {
      if (window.parent === window) return;
      window.parent.postMessage(msg, TARGET_ORIGIN);
    } catch (e) { /* parent might be cross-origin in dev; ignore */ }
  }

  function safeSerialize(value) {
    try {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'function') return '[Function]';
      if (typeof value === 'object' && value !== null) {
        var seen = new WeakSet();
        return JSON.parse(JSON.stringify(value, function (k, v) {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        }));
      }
      return value;
    } catch (e) {
      return String(value);
    }
  }

  // ---------------- Error capture ----------------
  window.addEventListener('error', function (event) {
    post({
      type: 'jarvis:error',
      error: {
        kind: 'runtime',
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error && event.error.stack ? String(event.error.stack) : undefined,
        ts: Date.now()
      }
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post({
      type: 'jarvis:error',
      error: {
        kind: 'unhandledrejection',
        message: reason && reason.message ? String(reason.message) : String(reason),
        stack: reason && reason.stack ? String(reason.stack) : undefined,
        ts: Date.now()
      }
    });
  });

  // Mirror console.error / console.warn so server-side
  // failures (e.g. failed fetch) show up in the workspace.
  ['error', 'warn'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        post({
          type: 'jarvis:console',
          level: level,
          args: Array.prototype.slice.call(arguments).map(safeSerialize),
          ts: Date.now()
        });
      } catch (e) { /* never break the app */ }
      return orig.apply(console, arguments);
    };
  });

  // ---------------- SPA nav tracking ----------------
  function emitNav(to) {
    var from = lastUrl;
    if (from === to) return;
    lastUrl = to;
    post({ type: 'jarvis:nav', from: from, to: to, ts: Date.now() });
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var ret = orig.apply(this, arguments);
      setTimeout(function () { emitNav(location.href); }, 0);
      return ret;
    };
  });
  window.addEventListener('popstate', function () {
    setTimeout(function () { emitNav(location.href); }, 0);
  });

  // ---------------- Pick mode (E6) ----------------
  function findJarvisSource(el) {
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-jarvis-src')) {
        return {
          path: el.getAttribute('data-jarvis-src'),
          label: el.getAttribute('data-jarvis-label') ||
                 (el.tagName ? el.tagName.toLowerCase() : 'element')
        };
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    if (!pickMode) return;
    var hit = findJarvisSource(e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    post({
      type: 'jarvis:click',
      path: hit.path,
      label: hit.label,
      ts: Date.now()
    });
  }, true);

  // ---------------- Analytics ----------------
  var analytics = { provider: 'none' };

  window.jarvisTrack = function (event, props) {
    var payload = { type: 'jarvis:track', event: event, props: props || {}, ts: Date.now() };
    post(payload);

    if (analytics.provider === 'plausible' && window.plausible) {
      window.plausible(event, { props: props || {} });
    } else if (analytics.provider === 'posthog' && window.posthog) {
      window.posthog.capture(event, props || {});
    } else {
      // Hold a small replay buffer so events fired pre-init still
      // reach the provider once \`setAnalytics\` arrives.
      queue.push(payload);
      if (queue.length > 200) queue.shift();
    }
  };

  function loadScript(src, attrs) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.defer = true;
      Object.keys(attrs || {}).forEach(function (k) { s.setAttribute(k, attrs[k]); });
      s.onload = function () { resolve(); };
      s.onerror = function (e) { reject(e); };
      document.head.appendChild(s);
    });
  }

  // Analytics host allowlist — the parent (or anyone postMessaging us)
  // could otherwise pass an arbitrary \`host\` and we'd happily inject a
  // <script src="..."> from it, which is a generic XSS / supply-chain
  // vector. Stick to the official providers + their EU clones.
  var ANALYTICS_HOST_ALLOWLIST = {
    plausible: ['https://plausible.io', 'https://eu.plausible.io'],
    posthog: ['https://app.posthog.com', 'https://eu.posthog.com', 'https://us.posthog.com']
  };

  function pickHost(provider, requested, defaultHost) {
    var allow = ANALYTICS_HOST_ALLOWLIST[provider] || [];
    if (typeof requested === 'string' && allow.indexOf(requested) !== -1) {
      return requested;
    }
    return defaultHost;
  }

  function setupAnalytics(cfg) {
    analytics = cfg || { provider: 'none' };
    if (cfg.provider === 'plausible' && cfg.key) {
      var host = pickHost('plausible', cfg.host, 'https://plausible.io');
      loadScript(host + '/js/script.js', { 'data-domain': cfg.key })
        .then(flushQueue);
    } else if (cfg.provider === 'posthog' && cfg.key) {
      // Minimal PostHog snippet; queues until SDK loads.
      window.posthog = window.posthog || [];
      var ph = function () { (window.posthog.queue = window.posthog.queue || []).push(arguments); };
      window.posthog.init = ph;
      window.posthog.capture = ph;
      var host = pickHost('posthog', cfg.host, 'https://app.posthog.com');
      loadScript(host + '/static/array.js')
        .then(function () {
          if (window.posthog && typeof window.posthog.init === 'function') {
            window.posthog.init(cfg.key, { api_host: host });
          }
          flushQueue();
        });
    } else {
      flushQueue();
    }
  }

  function flushQueue() {
    var pending = queue.splice(0);
    pending.forEach(function (msg) {
      try {
        if (analytics.provider === 'plausible' && window.plausible) {
          window.plausible(msg.event, { props: msg.props });
        } else if (analytics.provider === 'posthog' && window.posthog) {
          window.posthog.capture(msg.event, msg.props);
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ---------------- Parent → iframe message handler ----------------
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'jarvis:setPickMode') {
      pickMode = !!data.enabled;
      document.documentElement.style.cursor = pickMode ? 'crosshair' : '';
    } else if (data.type === 'jarvis:setAnalytics') {
      setupAnalytics({
        provider: data.provider || 'none',
        key: data.key,
        host: data.host
      });
    } else if (data.type === 'jarvis:reload') {
      location.reload();
    }
  });

  // Auto-init analytics from a window global the deploy pipeline can
  // inject (E13). For visitors viewing the deployed app standalone
  // (no Jarvis workspace parent), this is the only way analytics ever
  // gets configured. The workspace can still override at runtime via
  // \`jarvis:setAnalytics\`.
  try {
    var preset = window.__JARVIS_ANALYTICS__;
    if (preset && typeof preset === 'object' && preset.provider && preset.provider !== 'none') {
      setupAnalytics(preset);
    }
  } catch (e) { /* never break the app */ }

  window.__jarvisBridge = { version: 1 };
  post({ type: 'jarvis:ready', ts: Date.now() });
})();
`;

/**
 * Inject the preview-bridge into a generated app's file map. Called
 * from `vercel.service.ts` right before we ship the deployment to
 * Vercel so we never have to ask the generator (which is the LLM) to
 * remember to include it.
 *
 * - Writes the bridge to `public/__jarvis-bridge.js` (Vite copies the
 *   `public/` directory into the build output verbatim).
 * - Patches `index.html` to add a `<script>` tag pointing at the
 *   bundled bridge if one isn't already present.
 *
 * Returns the (possibly modified) file map. Safe to call repeatedly.
 */
export interface InjectPreviewBridgeOptions {
  /**
   * E13 — analytics provider config baked into the deployed `index.html`
   * via a `window.__JARVIS_ANALYTICS__` global. The bridge auto-initializes
   * from this on boot so analytics works for visitors who load the
   * deployed app outside the Jarvis workspace.
   */
  analytics?: {
    provider: 'plausible' | 'posthog';
    key?: string;
    host?: string;
  };
}

export function injectPreviewBridge(
  files: Record<string, string>,
  options: InjectPreviewBridgeOptions = {},
): Record<string, string> {
  const updated = { ...files };

  // 1) Write the bridge into `public/`. Vite emits everything in
  //    `public/` to the build root, so the script lives at
  //    `<previewUrl>/__jarvis-bridge.js`.
  const bridgePath = 'public/__jarvis-bridge.js';
  if (!updated[bridgePath] && !updated[`/${bridgePath}`]) {
    updated[bridgePath] = PREVIEW_BRIDGE_JS;
  }

  // Build the analytics preset script tag (E13). Emitted BEFORE the
  // bridge script so the bridge can pick it up on boot.
  const analyticsTag = options.analytics
    ? `\n    <script>window.__JARVIS_ANALYTICS__=${JSON.stringify({
        provider: options.analytics.provider,
        key: options.analytics.key ?? '',
        host: options.analytics.host ?? '',
      })};</script>`
    : '';

  // 2) Patch index.html — if the file is already there, slip the
  //    script tag in just before `</head>`. If we can't find an
  //    `index.html`, we don't fail; some templates render their HTML
  //    differently and we'd rather ship without the bridge than
  //    break the build.
  const indexKey = Object.keys(updated).find(
    (p) =>
      p === 'index.html' || p === '/index.html' || p.endsWith('/index.html'),
  );
  if (indexKey) {
    let html = updated[indexKey];

    // Replace any prior analytics preset so we don't ship stale keys
    // when the user toggles providers.
    html = html.replace(
      /<script>\s*window\.__JARVIS_ANALYTICS__\s*=[^<]*<\/script>/,
      '',
    );

    if (!html.includes('__jarvis-bridge.js')) {
      const tag = `${analyticsTag}\n    <script src="/__jarvis-bridge.js"></script>\n  `;
      html = html.includes('</head>')
        ? html.replace('</head>', `${tag}</head>`)
        : html.includes('</body>')
          ? html.replace('</body>', `${tag}</body>`)
          : `${html}\n<script src="/__jarvis-bridge.js"></script>\n`;
    } else if (analyticsTag) {
      html = html.includes('</head>')
        ? html.replace('</head>', `${analyticsTag}\n  </head>`)
        : html;
    }

    updated[indexKey] = html;
  }

  return updated;
}
