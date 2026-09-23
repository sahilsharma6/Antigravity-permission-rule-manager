/**
 * Browser-side scanner, injected into Antigravity's agent webview via CDP
 * Runtime.evaluate. Kept as a plain template string (not an ES module) so it
 * can be evaluated directly inside the page.
 *
 * It NEVER auto-clicks on its own; it only reports candidates. All clicking
 * is driven from the Node side with validation, dedupe and logging.
 */
const SCANNER_VERSION = 2;

function scannerSource(preset) {
  const json = JSON.stringify(preset);

  return `(function () {
  if (window.__agAutoAccept && window.__agAutoAccept.version === ${SCANNER_VERSION}) {
    return; // already installed
  }
  const PRESET = ${json};
  const coalesce = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

  function textOf(el) {
    // aria-label first: buttons often render icons + tooltip text only
    const label = el.getAttribute('aria-label') || el.title || '';
    if (label) return coalesce(label);
    return coalesce(el.textContent);
  }

  function clickableCandidates(root) {
    const out = [];
    const nodes = root.querySelectorAll('button, [role="button"], [data-testid]');
    for (const el of nodes) {
      if (el.closest('[data-ag-auto-accept-skip]')) continue;
      if (el.disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      out.push(el);
    }
    return out;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }

  function matchAction(text) {
    const t = coalesce(text).toLowerCase();
    if (!t) return null;
    for (const a of PRESET.actions) {
      for (const m of a.matches) {
        if (a.kind === 'command') {
          const first = t.split(' ')[0];
          // "Run", "Run command", "Run Alt+d" all start with the run keyword
          if (first === m || t === m) return a;
        } else {
          // Prefix + word-edge match, kept in sync with buildKeywordMatcher()
          // in src/presets.js: text must START with the keyword.
          const re = new RegExp('^' + escapeRe(m) + '($|[^a-z0-9_-])', 'i');
          if (re.test(t)) return a;
        }
      }
    }
    return null;
  }

  function extractCommandText(el) {
    // Walk up a few ancestors, checking their children for a code block that
    // represents the terminal command associated with this Run button.
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      const parent = cur.parentElement;
      if (!parent) break;
      const code = parent.querySelector('code, pre, [class*="command"]');
      if (code) return coalesce(code.textContent);
      cur = parent;
    }
    return '';
  }

  function domPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(sel + '#' + cur.id);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(sel);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function scan(root) {
    root = root || document;
    const found = [];
    for (const el of clickableCandidates(root)) {
      const text = textOf(el);
      const action = matchAction(text);
      if (!action) continue;
      const rect = el.getBoundingClientRect();
      let key = el.getAttribute('data-ag-auto-accept-id');
      if (!key) {
        key = Math.random().toString(36).slice(2, 10);
        el.setAttribute('data-ag-auto-accept-id', key);
      }
      found.push({
        key: key,
        text: text,
        kind: action.kind,
        priority: action.priority,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        command: action.commands ? extractCommandText(el) : '',
        path: domPath(el),
      });
    }
    return found;
  }

  window.__agAutoAccept = {
    version: ${SCANNER_VERSION},
    scan: scan,
    click: function (key) {
      const el = document.querySelector('[data-ag-auto-accept-id="' + key + '"]');
      if (!el) return { ok: false, reason: 'gone' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return { ok: true };
    },
  };
})();`;
}

export const SCANNER_SOURCE_BUILDER = scannerSource;
export { SCANNER_VERSION };
