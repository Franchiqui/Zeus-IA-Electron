import re

files = [
    r'C:\Zeus-IA\components\component-selector-helper.tsx',
    r'C:\Zeus-IA\component-selector-helper.tsx'
]

base_id_code = r'''
    function getCandidateBaseId(element: HTMLElement): string {
      const tagName = element.tagName.toLowerCase();
      const text = element.innerText?.substring(0, 50) || '';
      const textTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'button', 'a', 'li', 'td', 'th'];
      const isTextElement = textTags.includes(tagName);
      let textHash = '';
      if (isTextElement && text && text.trim().length > 0) {
        const cleaned = text.trim().substring(0, 25).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').toLowerCase();
        if (cleaned.length > 0) textHash = -;
      }
      const elClass = typeof element.className === 'string' ? element.className : '';
      let baseId = '';
      const cPath = generatePathHash(element);
      if (element.id) {
        baseId = element.id + textHash;
      } else if (elClass) {
        const firstClass = elClass.split(' ')[0];
        const cleanClass = firstClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        baseId = ${cleanClass};
      } else {
        baseId = ${tagName};
      }
      baseId = baseId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      return baseId.substring(0, 100);
    }
'''

repl1 = r'''for (const candidate of candidates) {
                      if (candidates.length === 1) {
                        foundElement = candidate;
                        break;
                      }
                      const baseId = getCandidateBaseId(candidate);
                      if (componentId === baseId) {
                        foundElement = candidate;
                        break;
                      } else if (componentId.startsWith(baseId + '-')) {
                        const remainder = componentId.substring(baseId.length + 1);
                        if (/^\d+$/.test(remainder)) {
                          foundElement = candidate;
                          break;
                        }
                      }
                    }'''

repl2 = r'''for (const candidate of candidates) {
                      if (candidates.length === 1) {
                        element = candidate;
                        break;
                      }
                      const baseId = getCandidateBaseId(candidate);
                      if (componentId === baseId) {
                        element = candidate;
                        break;
                      } else if (componentId.startsWith(baseId + '-')) {
                        const remainder = componentId.substring(baseId.length + 1);
                        if (/^\d+$/.test(remainder)) {
                          element = candidate;
                          break;
                        }
                      }
                    }'''

for filepath in files:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        path_hash_end = content.find("return path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();\\n    }")
        if path_hash_end != -1 and "function getCandidateBaseId" not in content:
            insert_pos = path_hash_end + len("return path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();\\n    }")
            content = content[:insert_pos] + "\\n" + base_id_code + content[insert_pos:]

        content = re.sub(r'for\s*\(\s*const\s+candidate\s+of\s+candidates\s*\)\s*\{\s*const\s+candidatePath\s*=\s*generatePathHash\(candidate\);[^{]*?foundElement\s*=\s*candidate;\s*break;\s*\}\s*\}', repl1, content)
        content = re.sub(r'for\s*\(\s*const\s+candidate\s+of\s+candidates\s*\)\s*\{\s*const\s+candidatePath\s*=\s*generatePathHash\(candidate\);[^{]*?element\s*=\s*candidate;\s*break;\s*\}\s*\}', repl2, content)

        repl3 = r'''if (!candidateEl.hasAttribute('data-component-id')) {
                        const baseId = getCandidateBaseId(candidateEl);
                        if (componentId === baseId || (componentId.startsWith(baseId + '-') && /^\d+$/.test(componentId.substring(baseId.length + 1)))) {
                          element = candidateEl;
                          applyComponentId(element, componentId);
                          break;
                        }
                      }'''
        content = re.sub(r'if\s*\(!candidateEl\.hasAttribute\(\'data-component-id\'\)\)\s*\{\s*const\s+candidatePath\s*=\s*generatePathHash\(candidateEl\);[^{]*?element\s*=\s*candidateEl;\s*applyComponentId\(element,\s*componentId\);\s*break;\s*\}\s*\}', repl3, content)

        repl4 = r'''if (pathPart) {
                      const baseId = getCandidateBaseId(candidateEl);
                        if (componentId === baseId || (componentId.startsWith(baseId + '-') && /^\d+$/.test(componentId.substring(baseId.length + 1)))) {
                        element = candidateEl;
                        applyComponentId(element, componentId);
                        break;
                      }
                    } else {'''
        content = re.sub(r'if\s*\(pathPart\)\s*\{\s*const\s+candidatePath\s*=\s*generatePathHash\(candidateEl\);[^{]*?element\s*=\s*candidateEl;\s*applyComponentId\(element,\s*componentId\);\s*break;\s*\}\s*\}\s*else\s*\{', repl4, content)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {filepath}")
    except Exception as e:
        print(f"Error patching {filepath}: {e}")
