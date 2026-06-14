const fs = require('fs');

const files = [
    'C:\\Zeus-IA\\components\\component-selector-helper.tsx',
    'C:\\Zeus-IA\\component-selector-helper.tsx'
];

const baseIdCode = 
    function getCandidateBaseId(element: HTMLElement): string {
      const tagName = element.tagName.toLowerCase();
      const text = element.innerText?.substring(0, 50) || '';
      const textTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'button', 'a', 'li', 'td', 'th'];
      const isTextElement = textTags.includes(tagName);
      let textHash = '';
      if (isTextElement && text && text.trim().length > 0) {
        const cleaned = text.trim().substring(0, 25).replace(/[^a-zA-Z0-9\\s]/g, '').replace(/\\s+/g, '-').toLowerCase();
        if (cleaned.length > 0) textHash = '-' + cleaned;
      }
      const elClass = typeof element.className === 'string' ? element.className : '';
      let baseId = '';
      const cPath = generatePathHash(element);
      if (element.id) {
        baseId = element.id + textHash;
      } else if (elClass) {
        const firstClass = elClass.split(' ')[0];
        const cleanClass = firstClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        baseId = cleanClass + (cPath ? '-' + cPath : '') + textHash;
      } else {
        baseId = tagName + (cPath ? '-' + cPath : '') + textHash;
      }
      baseId = baseId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      return baseId.substring(0, 100);
    }
;

const replaceCode = 
                    for (const candidate of candidates) {
                      if (candidates.length === 1) {
                        foundElement = candidate;
                        break;
                      }
                      const baseId = getCandidateBaseId(candidate);
                      if (componentId === baseId || (componentId.startsWith(baseId + '-') && /^\\d+$/.test(componentId.substring(baseId.length + 1)))) {
                        foundElement = candidate;
                        break;
                      }
                    }
;

const replaceCodeElement = 
                    for (const candidate of candidates) {
                      if (candidates.length === 1) {
                        element = candidate;
                        break;
                      }
                      const baseId = getCandidateBaseId(candidate);
                      if (componentId === baseId || (componentId.startsWith(baseId + '-') && /^\\d+$/.test(componentId.substring(baseId.length + 1)))) {
                        element = candidate;
                        break;
                      }
                    }
;

for (const filepath of files) {
    try {
        let content = fs.readFileSync(filepath, 'utf8');

        // Insert getCandidateBaseId
        const searchStr = "return path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();\n    }";
        const pathHashEnd = content.indexOf(searchStr);
        if (pathHashEnd !== -1 && !content.includes("function getCandidateBaseId")) {
            const insertPos = pathHashEnd + searchStr.length;
            content = content.substring(0, insertPos) + "\n" + baseIdCode + content.substring(insertPos);
        }

        // Replace logic
        content = content.replace(/for \s*\(\s*const\s+candidate\s+of\s+candidates\s*\)\s*\{[\s\S]*?foundElement\s*=\s*candidate;\s*break;\s*\}\s*\}/g, replaceCode.trim());
        content = content.replace(/for \s*\(\s*const\s+candidate\s+of\s+candidates\s*\)\s*\{[\s\S]*?element\s*=\s*candidate;\s*break;\s*\}\s*\}/g, replaceCodeElement.trim());
        content = content.replace(/if \(!candidateEl\.hasAttribute\('data-component-id'\)\) \{[\s\S]*?element = candidateEl;\s*applyComponentId\(element, componentId\);\s*break;\s*\}\s*\}/g, if (!candidateEl.hasAttribute('data-component-id')) {
                        const baseId = getCandidateBaseId(candidateEl);
                        if (componentId === baseId || (componentId.startsWith(baseId + '-') && /^\\d+$/.test(componentId.substring(baseId.length + 1)))) {
                          element = candidateEl;
                          applyComponentId(element, componentId);
                          break;
                        }
                      });

        fs.writeFileSync(filepath, content, 'utf8');
        console.log("Patched", filepath);
    } catch (e) {
        console.error("Error patching", filepath, e);
    }
}