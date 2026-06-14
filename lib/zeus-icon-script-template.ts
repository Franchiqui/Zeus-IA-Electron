export function generateZeusIconScript(
  iconPaths: Record<string, string>,
  iconProperties: Record<string, any>,
  dateStr: string
): string {
  return `/* Script generado por zeus Studio para inyectar iconos */
/* Fecha: ${dateStr} */
/* IMPORTANTE: Este archivo debe ser importado en tu aplicación para que los iconos persistan */
/* Agrega esto en tu layout.tsx o _app.tsx: import "./zeus-icons.js"; */

/* ZEUS_ICON_PATHS_START */
const iconPaths = ${JSON.stringify(iconPaths, null, 2)};
/* ZEUS_ICON_PATHS_END */

/* ZEUS_ICON_PROPERTIES_START */
const iconProperties = ${JSON.stringify(iconProperties, null, 2)};
/* ZEUS_ICON_PROPERTIES_END */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
(function() {
  'use strict';

  function parseComponentId(componentId) {
    const idWithoutComponent = componentId.replace(/^component-/, '');
    const nthChildMatch = idWithoutComponent.match(/-([a-z0-9]+)-nth-child-\\d+/);
    let classPart = '';
    let pathPart = '';
    let textPart = '';
    if (nthChildMatch) {
      const pathStartIndex = idWithoutComponent.indexOf(nthChildMatch[0]);
      classPart = idWithoutComponent.substring(0, pathStartIndex);
      const fullPathAndText = idWithoutComponent.substring(pathStartIndex + 1);
      const parts = fullPathAndText.split('-');
      let lastNthChildIndex = -1;
      for (let i = 0; i < parts.length - 2; i++) {
        if (parts[i] === 'nth' && parts[i + 1] === 'child') {
          lastNthChildIndex = i + 2;
        }
      }
      if (lastNthChildIndex !== -1 && lastNthChildIndex < parts.length - 1) {
        pathPart = parts.slice(0, lastNthChildIndex + 1).join('-');
        textPart = parts.slice(lastNthChildIndex + 1).join('-');
      } else {
        pathPart = fullPathAndText;
      }
    } else {
      classPart = idWithoutComponent;
    }
    return { classPart, pathPart, textPart };
  }

  function generatePathHash(element) {
    const path = [];
    let currentElement = element;
    while (currentElement && currentElement !== document.body) {
      const parent = currentElement.parentElement;
      if (parent) {
        const index = Array.from(parent.children).indexOf(currentElement);
        path.unshift(currentElement.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')');
      }
      currentElement = parent;
    }
    return path.slice(-5).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  }

  function createTextHash(text) {
    if (!text) return '';
    return text.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
  }

  function ensureComponentIds() {
    const skipTags = { script: 1, style: 1, link: 1, meta: 1, noscript: 1, template: 1, svg: 1, path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, g: 1, defs: 1, clipPath: 1, mask: 1, pattern: 1, image: 1, use: 1, text: 1, tspan: 1 };
    const allElements = document.querySelectorAll('body *');
    let counter = 0;
    for (let k = 0; k < allElements.length; k++) {
      const el = allElements[k];
      if (el.hasAttribute('data-component-id')) continue;
      const tag = el.tagName.toLowerCase();
      if (skipTags[tag]) continue;
      // Skip elements inside SVG (SVG children don't have closest in older browsers, so walk up)
      let parent = el.parentElement;
      let insideSvg = false;
      while (parent) {
        if (parent.tagName.toLowerCase() === 'svg') { insideSvg = true; break; }
        parent = parent.parentElement;
      }
      if (insideSvg) continue;
      const classes = el.className && typeof el.className === 'string'
        ? el.className.split(' ').filter(function(c) { return c && !c.startsWith('zeus-') && !c.startsWith('group'); }).slice(0, 3).join('-')
        : '';
      const pathHash = generatePathHash(el);
      const textHash = createTextHash(el.textContent || '');
      let id = '';
      if (classes) {
        id = classes + '-' + pathHash;
      } else {
        id = tag + '-' + pathHash;
      }
      if (textHash && textHash.length > 2) {
        id = id + '-' + textHash;
      }
      el.setAttribute('data-component-id', id);
      counter++;
    }
    if (counter > 0) console.log('[zeus-icons] Aplicados ' + counter + ' data-component-id');
  }

  function findElementByComponentId(componentId) {
    let el = document.querySelector('[data-component-id="' + componentId + '"]');
    if (el) return el;
    const parsed = parseComponentId(componentId);
    if (parsed.classPart) {
      const selectors = ['.' + parsed.classPart, '[class*="' + parsed.classPart + '"]'];
      for (let i = 0; i < selectors.length; i++) {
        try {
          const candidates = document.querySelectorAll(selectors[i]);
          for (let j = 0; j < candidates.length; j++) {
            const candidate = candidates[j];
            if (!candidate.hasAttribute('data-component-id')) {
              candidate.setAttribute('data-component-id', componentId);
            }
            return candidate;
          }
        } catch (e) {}
      }
    }
    if (parsed.pathPart) {
      try {
        const parts = parsed.pathPart.split('-');
        let selector = '';
        for (let i = 0; i < parts.length; i += 3) {
          if (parts[i + 1] === 'nth' && parts[i + 2] === 'child') {
            if (selector) selector += ' > ';
            selector += parts[i] + ':nth-child(' + parts[i + 3] + ')';
            i += 3;
          }
        }
        if (selector) {
          el = document.querySelector(selector);
          if (el) {
            el.setAttribute('data-component-id', componentId);
            return el;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function applyIcons() {
    if (!iconProperties || Object.keys(iconProperties).length === 0) return;

    var css = '';
    Object.keys(iconProperties).forEach(function(componentId) {
      var props = iconProperties[componentId];
      if (!props || !props.name) return;

      var iconName = props.name;
      var iconSize = props.size || 20;
      var iconColor = props.color || '#000000';
      var iconStrokeWidth = props.strokeWidth || 2;
      var pathData = iconPaths[iconName];
      if (!pathData) return;

      // Hide old injected SVGs/containers from legacy scripts
      css += '[data-component-id="' + componentId + '"] .zeus-injected-icon,\\\\n';
      css += '[data-component-id="' + componentId + '"] > svg[viewBox="0 0 24 24"],\\\\n';
      css += '[data-component-id="' + componentId + '"] svg.lucide,\\\\n';
      css += '[data-component-id="' + componentId + '"] .lucide {\\\\n';
      css += '  display: none !important;\\\\n';
      css += '}\\\\n\\\\n';

      // Build SVG data URI with embedded color
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + iconColor + '" stroke-width="' + iconStrokeWidth + '" stroke-linecap="round" stroke-linejoin="round"><path d="' + pathData + '"/></svg>';
      var dataUri = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';

      css += '[data-component-id="' + componentId + '"]::before {\\\\n';
      css += "  content: '' !important;\\\\n";
      css += '  display: inline-block !important;\\\\n';
      css += '  width: ' + iconSize + 'px !important;\\\\n';
      css += '  height: ' + iconSize + 'px !important;\\\\n';
      css += '  background-image: ' + dataUri + ' !important;\\\\n';
      css += '  background-size: contain !important;\\\\n';
      css += '  background-repeat: no-repeat !important;\\\\n';
      css += '  background-position: center !important;\\\\n';
      css += '  vertical-align: middle !important;\\\\n';
      css += '  flex-shrink: 0 !important;\\\\n';
      css += '}\\\\n\\\\n';
    });

    if (!css) return;

    var existingStyle = document.getElementById('zeus-icons-styles');
    if (existingStyle) existingStyle.remove();

    var style = document.createElement('style');
    style.id = 'zeus-icons-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    ensureComponentIds();
    applyIcons();
  }

  // Expose applyIcons immediately so component-selector-helper can invoke it after applying IDs
  window.__zeusIcons = { applyIcons: applyIcons, iconPaths: iconPaths };

  // Defer init and observers to avoid React hydration mismatch in Next.js
  function setup() {
    init();

    let lastUrl = location.href;
    new MutationObserver(function() {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(init, 100);
      }
    }).observe(document, { subtree: true, childList: true });

    new MutationObserver(function(mutations) {
      let shouldReapply = false;
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'data-component-id') {
          shouldReapply = true;
        }
      });
      if (shouldReapply) setTimeout(applyIcons, 50);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-component-id'], subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(setup, 800); });
  } else {
    setTimeout(setup, 800);
  }
})();
}
`;
}
