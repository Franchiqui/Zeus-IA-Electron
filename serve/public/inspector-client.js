(function(){
  const SOURCE = 'preview-inspector';
  let ZEUS_ID_SEQ = 1;

  function getOrAssignZeusId(el){
    try{
      if (!el) return null;
      let id = el.getAttribute('data-zeus-id');
      if (!id){
        id = 'Z-' + (ZEUS_ID_SEQ++);
        el.setAttribute('data-zeus-id', id);
      }
      return id;
    }catch(_){ return null; }
  }

  function buildElementPath(el){
    if(!el) return '';
    const parts=[]; let current=el; let guard=0;
    while(current && guard++<6){
      const tag=(current.tagName||'div').toLowerCase();
      const id=current.id?('#'+current.id):'';
      const cls=(current.className||'').toString().trim().split(/\s+/).filter(Boolean).slice(0,2);
      parts.unshift(tag + id + (cls.length?('.'+cls.join('.')):''));
      current=current.parentElement;
    }
    return parts.join(' > ');
  }

  function rectInfoOf(el){
    if(!el) return null;
    const r=el.getBoundingClientRect();
    
    // Obtener el texto del elemento de manera precisa
    let elementText = '';
    try {
      if (el) {
        const tagName = (el.tagName || '').toLowerCase();
        const isTextElement = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'label', 'td', 'th', 'li', 'dt', 'dd'].indexOf(tagName) >= 0;
        
        // Para elementos de texto, obtener el texto completo (incluyendo hijos)
        if (isTextElement) {
          elementText = (el.textContent || el.innerText || '').trim();
          // Limpiar espacios múltiples pero mantener el texto completo
          elementText = elementText.replace(/\s+/g, ' ').trim();
        } else {
          // Para otros elementos, intentar obtener solo el texto directo primero
          const childNodes = Array.from(el.childNodes);
          const textNodes = childNodes.filter(function(node) { 
            return node.nodeType === 3; // Node.TEXT_NODE = 3
          });
          const directText = textNodes.map(function(node) { 
            return (node.textContent || '').trim(); 
          }).filter(function(t) { return t.length > 0; }).join(' ').trim();
          
          if (directText && directText.length > 0) {
            elementText = directText;
          } else {
            // Si no hay texto directo, usar textContent completo pero limitado
            const fullText = (el.textContent || el.innerText || '').trim();
            if (fullText) {
              elementText = fullText.replace(/\s+/g, ' ').trim();
              // Limitar a 500 caracteres para evitar textos muy largos
              if (elementText.length > 500) {
                elementText = elementText.substring(0, 500);
              }
            }
          }
        }
      }
    } catch (e) {
      // Si hay error, intentar obtener textContent directamente
      try {
        elementText = ((el.textContent || el.innerText || '').trim()).substring(0, 500);
      } catch (e2) {
        elementText = '';
      }
    }
    
    return { 
      left:r.left, 
      top:r.top, 
      width:r.width, 
      height:r.height,
      tag:(el.tagName||'div').toLowerCase(), 
      id:el.id||'', 
      classes:Array.from(el.classList||[]),
      textContent: elementText
    };
  }

  window.addEventListener('message', function(evt){
    const data=evt.data; if(!data) return;

    // Protocol messages from parent overlay -> iframe (must match our SOURCE)
    if (data.source===SOURCE){
      if(data.type==='ping'){
        window.parent.postMessage({ source: SOURCE, type:'pong', href: location.href }, '*');
        return;
      }

      if(data.type==='hover'){
        const x=data.x, y=data.y;
        const el=document.elementFromPoint(x,y);
        const rectInfo=rectInfoOf(el);
        window.parent.postMessage({ source: SOURCE, type:'hover-result', elementId: buildElementPath(el), rectInfo }, '*');
        return;
      }

      if(data.type==='click'){
        const x=data.x, y=data.y;
        let el=document.elementFromPoint(x,y);
        if (el) {
            const closestWithId = el.closest('[data-zeus-id]');
            if (closestWithId) {
                el = closestWithId;
            }
        }
        const rectInfo=rectInfoOf(el);
        const zid = getOrAssignZeusId(el);
        
        // ✅ Ahora que el script de Zeus IDs asegura IDs únicos, usar solo el data-zeus-id
        // Si el elemento tiene un data-zeus-id, usarlo directamente
        // Si no tiene (se asignó dinámicamente), el usuario debería ejecutar "Zeus ID" primero
        const uniqueSelector = zid ? `[data-zeus-id="${zid}"]` : null;
        
        // Log para depuración
        console.log('[Inspector] Elemento clickeado:', {
          tag: el?.tagName,
          textContent: el?.textContent?.substring(0, 50),
          innerText: el?.innerText?.substring(0, 50),
          rectInfoText: rectInfo?.textContent?.substring(0, 50),
          hasChildren: el?.children?.length || 0,
          zid: zid,
          uniqueSelector: uniqueSelector,
          pathSelector: buildElementPath(el)
        });
        
        window.parent.postMessage({ source: SOURCE, type:'click-result', elementId: buildElementPath(el), uniqueSelector: uniqueSelector || buildElementPath(el), rectInfo }, '*');
        return;
      }

      if(data.type==='GET_ELEMENT_TEXT'){
        try {
          const { elementId } = data;
          // Intentar encontrar el elemento por el selector o data-zeus-id
          let el = null;
          if (elementId) {
            // Si elementId es un selector CSS, usarlo directamente
            try {
              el = document.querySelector(elementId);
            } catch (e) {
              // Si falla, intentar como data-zeus-id
              try {
                el = document.querySelector(`[data-zeus-id="${elementId}"]`);
              } catch (e2) {
                // Intentar buscar por el path
                const parts = elementId.split(' > ');
                if (parts.length > 0) {
                  const lastPart = parts[parts.length - 1];
                  try {
                    el = document.querySelector(lastPart);
                  } catch (e3) {}
                }
              }
            }
          }
          
          let textContent = '';
          if (el) {
            // Obtener solo los nodos de texto directos
            const childNodes = Array.from(el.childNodes);
            const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
            textContent = textNodes.map(node => node.textContent || '').join('').trim();
            
            // Si no hay texto directo, usar textContent completo pero solo si no es muy largo
            if (!textContent) {
              const fullText = el.textContent || '';
              if (fullText && fullText.length < 500) {
                textContent = fullText.trim();
              }
            }
          }
          
          window.parent.postMessage({ 
            source: SOURCE, 
            type: 'ELEMENT_TEXT_RESPONSE', 
            elementId: elementId,
            textContent: textContent 
          }, '*');
        } catch (err) {
          window.parent.postMessage({ 
            source: SOURCE, 
            type: 'ELEMENT_TEXT_ERROR', 
            elementId: data.elementId,
            error: String(err) 
          }, '*');
        }
        return;
      }
    }

    // --- Editing commands ---
    // Utility: escape CSS selectors (ids/classes) using CSS.escape when available
    function normalizeSelector(sel){
      try{
        if (!sel) return sel;
        if (window.CSS && typeof CSS.escape === 'function'){
          // Escape IDs
          sel = sel.replace(/#([^\.\s>#:]+)/g, (m, id) => '#' + CSS.escape(id));
          // Escape classes
          sel = sel.replace(/\.([^\.\s>#:]+)/g, (m, cls) => '.' + CSS.escape(cls));
        } else {
          // Basic escape for colon and brackets common in utility classes
          sel = sel.replace(/:/g, '\\:').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
        }
        return sel;
      }catch(_){ return sel; }
    }

    // Fallback: strip problematic class segments containing ':' if selection fails
    function stripVariantClasses(sel){
      try{
        return sel.replace(/\.[^\.\s>#:]*:[^\.\s>#:]*/g, '');
      }catch(_){ return sel; }
    }

    if (data.type==='UPDATE_COMPONENT_STYLE'){
      try{
        let { selector, property, value } = data;
        let norm = normalizeSelector(selector);
        let elements = [];
        try { elements = document.querySelectorAll(norm); } catch(_e){ elements = []; }
        if (!elements || elements.length === 0) {
          const stripped = stripVariantClasses(norm);
          try { elements = document.querySelectorAll(stripped); } catch(_e2){ elements = []; }
        }
        elements.forEach(el => {
          if (property === 'textGradient') {
            if (value) {
              el.style.background = value;
              el.style.webkitBackgroundClip = 'text';
              el.style.backgroundClip = 'text';
              el.style.color = 'transparent';
            } else {
              el.style.background = '';
              el.style.webkitBackgroundClip = '';
              el.style.backgroundClip = '';
              // We can't know the original color, so we leave it to be set by other means
              el.style.color = ''; 
            }
          } else if (property === 'backgroundGradient') {
            el.style.background = value;
          } else {
            el.style[property] = value;
          }
        });
        // Acknowledge
        window.parent.postMessage({ source: SOURCE, type: 'STYLE_UPDATED', selector, property, value }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type: 'STYLE_UPDATE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    // Manejar redimensionamiento de componente
    if (data.type==='RESIZE_COMPONENT' && data.source===SOURCE){
      try{
        const { elementId, width, height, left, top } = data;
        if (!elementId) return;
        
        // Buscar el elemento por selector o data-zeus-id
        let el = null;
        try {
          // Intentar como selector CSS
          el = document.querySelector(elementId);
        } catch(_e){
          // Si falla, intentar como data-zeus-id
          try {
            el = document.querySelector(`[data-zeus-id="${elementId}"]`);
          } catch(_e2){}
        }
        
        if (!el) {
          // Intentar buscar por path
          const parts = elementId.split(' > ');
          if (parts.length > 0) {
            const lastPart = parts[parts.length - 1];
            try {
              el = document.querySelector(lastPart);
            } catch(_e3){}
          }
        }
        
        if (el) {
          // Aplicar width y height si se proporcionan
          if (typeof width === 'number' && width > 0) {
            el.style.width = width + 'px';
          }
          if (typeof height === 'number' && height > 0) {
            el.style.height = height + 'px';
          }
          
          // Aplicar left y top si se proporcionan (solo para elementos con position absolute/relative/fixed)
          const currentPosition = window.getComputedStyle(el).position;
          if (currentPosition !== 'static' && (typeof left === 'number' || typeof top === 'number')) {
            if (typeof left === 'number') {
              el.style.left = left + 'px';
            }
            if (typeof top === 'number') {
              el.style.top = top + 'px';
            }
          }
        }
      }catch(err){
        console.warn('[Inspector] Error en RESIZE_COMPONENT:', err);
      }
      return;
    }

    // Inyectar/actualizar un <style> con CSS generado (para vista previa en vivo)
    if (data.type==='INJECT_STYLE_TAG'){
      try{
        const css = (data && data.css) ? String(data.css) : '';
        const styleId = data.styleId || 'zeus-generated-styles';
        let styleEl = document.getElementById(styleId);
        if (!styleEl){
          styleEl = document.createElement('style');
          styleEl.id = styleId;
          styleEl.type = 'text/css';
          // Prefer head; fallback a body
          const parent = document.head || document.body || document.documentElement;
          parent.appendChild(styleEl);
        }
        styleEl.textContent = css;
        window.parent.postMessage({ source: SOURCE, type: 'STYLE_TAG_INJECTED', styleId, length: css.length }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type: 'STYLE_TAG_ERROR', error: String(err) }, '*');
      }
      return;
    }

    // Devolver HTML completo para persistencia
    if (data.type==='GET_FULL_HTML'){
      try{
        const fullHTML = document.documentElement.outerHTML;
        const filePath = window.location.pathname;
        window.parent.postMessage({ source: SOURCE, type:'COMPONENT_HTML_SNAPSHOT', fullHTML, filePath, href: location.href, timestamp: Date.now() }, '*');
      } catch (err){
        window.parent.postMessage({ source: SOURCE, type:'GET_FULL_HTML_ERROR', error: String(err) }, '*');
      }
      return;
    }

    // --- Text and HTML editing ---
    if (data.type==='UPDATE_TEXT_CONTENT' || data.type==='SET_TEXT'){
      try{
        const { selector, text } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.textContent = text ?? '';
        window.parent.postMessage({ source: SOURCE, type:'TEXT_UPDATED', selector, text: el.textContent }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'TEXT_UPDATE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='SET_INNER_HTML' || data.type==='UPDATE_HTML'){
      try{
        const { selector, html } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.innerHTML = html ?? '';
        window.parent.postMessage({ source: SOURCE, type:'HTML_UPDATED', selector, html: el.innerHTML }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'HTML_UPDATE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='REPLACE_OUTER_HTML'){
      try{
        const { selector, html } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.outerHTML = html ?? '';
        window.parent.postMessage({ source: SOURCE, type:'OUTER_HTML_REPLACED', selector }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'OUTER_HTML_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='REMOVE_ELEMENT'){
      try{
        const { selector } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.remove();
        window.parent.postMessage({ source: SOURCE, type:'ELEMENT_REMOVED', selector }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'ELEMENT_REMOVE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='UPDATE_ATTRIBUTE' || data.type==='SET_ATTRIBUTE'){
      try{
        const { selector, name, value } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.setAttribute(name, value ?? '');
        window.parent.postMessage({ source: SOURCE, type:'ATTRIBUTE_UPDATED', selector, name, value: el.getAttribute(name) }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'ATTRIBUTE_UPDATE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='REMOVE_ATTRIBUTE'){
      try{
        const { selector, name } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (!el) return;
        el.removeAttribute(name);
        window.parent.postMessage({ source: SOURCE, type:'ATTRIBUTE_REMOVED', selector, name }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type:'ATTRIBUTE_REMOVE_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='RESET_COMPONENT_STYLES'){
      try{
        let { selector } = data;
        let norm = normalizeSelector(selector);
        let elements = [];
        try { elements = document.querySelectorAll(norm); } catch(_e){ elements = []; }
        if (!elements || elements.length === 0) {
          const stripped = stripVariantClasses(norm);
          try { elements = document.querySelectorAll(stripped); } catch(_e2){ elements = []; }
        }
        elements.forEach(el => el.removeAttribute('style'));
        window.parent.postMessage({ source: SOURCE, type: 'STYLES_RESET', selector }, '*');
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type: 'STYLES_RESET_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='GET_COMPONENT_STYLES'){
      try{
        let { selector } = data;
        let norm = normalizeSelector(selector);
        let el = null;
        try { el = document.querySelector(norm); } catch(_e){ el = null; }
        if (!el) {
          const stripped = stripVariantClasses(norm);
          try { el = document.querySelector(stripped); } catch(_e2){ el = null; }
        }
        if (el){
          const styles = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          
          // ✅ Obtener width y height: usar dimensiones calculadas si el estilo es "auto"
          let widthValue = styles.width;
          let heightValue = styles.height;
          
          // Si el estilo es "auto" o no está explícitamente establecido, usar las dimensiones calculadas
          if (widthValue === 'auto' || !widthValue || widthValue === '') {
            widthValue = rect.width > 0 ? rect.width + 'px' : 'auto';
          }
          if (heightValue === 'auto' || !heightValue || heightValue === '') {
            heightValue = rect.height > 0 ? rect.height + 'px' : 'auto';
          }
          
          const componentStyles = {
            backgroundColor: styles.backgroundColor,
            color: styles.color,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            padding: styles.padding,
            margin: styles.margin,
            border: styles.border,
            borderRadius: styles.borderRadius,
            width: widthValue,
            height: heightValue,
            display: styles.display,
            position: styles.position,
            opacity: styles.opacity,
            transform: styles.transform,
            boxShadow: styles.boxShadow,
            textAlign: styles.textAlign,
            flexDirection: styles.flexDirection,
            justifyContent: styles.justifyContent,
            alignItems: styles.alignItems,
            gap: styles.gap,
            top: styles.top,
            left: styles.left,
            right: styles.right,
            bottom: styles.bottom,
            zIndex: styles.zIndex,
            textDecoration: styles.textDecoration,
            cursor: styles.cursor,
            overflow: styles.overflow,
            fontFamily: styles.fontFamily
          };
          window.parent.postMessage({ source: SOURCE, type:'COMPONENT_STYLES_RESPONSE', selector, styles: componentStyles }, '*');
        } else {
          window.parent.postMessage({ source: SOURCE, type:'COMPONENT_STYLES_RESPONSE', selector, styles: null }, '*');
        }
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type: 'GET_STYLES_ERROR', error: String(err) }, '*');
      }
      return;
    }

    if (data.type==='INSERT_ICON'){
      try{
        const { selector, iconName, library } = data;
        let norm = normalizeSelector(selector);
        let element = null;
        try { element = document.querySelector(norm); } catch(_e){ element = null; }
        if (!element) {
          const stripped = stripVariantClasses(norm);
          try { element = document.querySelector(stripped); } catch(_e2){ element = null; }
        }
        if (!element) return;
        // Remove existing icons commonly used
        const existingIcons = element.querySelectorAll('i.zeus-inserted-icon, svg.zeus-inserted-icon, i[data-lucide], svg[data-lucide], i.fas, i.far, i.fab');
        existingIcons.forEach(ic => ic.remove());

        let iconElement;
        if (library === 'Lucide'){
          iconElement = document.createElement('i');
          iconElement.classList.add('zeus-inserted-icon');
          const lucideIconName = iconName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
          iconElement.setAttribute('data-lucide', lucideIconName);
          iconElement.style.marginRight = '8px';
          iconElement.style.width = '16px';
          iconElement.style.height = '16px';
        } else if (library === 'React Icons'){
          iconElement = document.createElement('i');
          iconElement.classList.add('zeus-inserted-icon');
          let faIconName;
          if (iconName.startsWith('Fa')){
            faIconName = 'fa-' + iconName.substring(2).replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
          } else {
            faIconName = iconName;
          }
          iconElement.classList.add('fas', faIconName);
          iconElement.style.marginRight = '8px';
        }
        if (iconElement){
          element.prepend(iconElement);
          element.style.display = 'inline-flex';
          element.style.alignItems = 'center';
          element.style.gap = '0.5rem';
          // Try to render Lucide icons if available
          if (library === 'Lucide' && window.lucide && typeof window.lucide.createIcons === 'function'){
            window.lucide.createIcons();
          }
          // Notify change
          const fullHTML = document.documentElement.outerHTML;
          const filePath = window.location.pathname;
          window.parent.postMessage({ source: SOURCE, type:'ICON_CHANGED', selector, iconHTML: element.innerHTML, fullHTML, filePath, timestamp: Date.now() }, '*');
        }
      }catch(err){
        window.parent.postMessage({ source: SOURCE, type: 'INSERT_ICON_ERROR', error: String(err) }, '*');
      }
      return;
    }
  }, false);
})();
