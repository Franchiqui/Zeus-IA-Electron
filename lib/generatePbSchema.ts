export function generatePbSchema(endpoints: any[], appName: string): string {
  const rndId = (length: number = 15): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  const extractPathParams = (path: string): string[] => {
    const names: string[] = [];
    const braces = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = braces.exec(path)) !== null) {
      const name = String(m[1] || '').trim();
      if (name) names.push(name);
    }
    const colon = /:([A-Za-z0-9_]+)/g;
    while ((m = colon.exec(path)) !== null) {
      const name = String(m[1] || '').trim();
      if (name) names.push(name);
    }
    return [...new Set(names)];
  };

  const entitySet = new Set<string>();
  const entityEndpoints: Record<string, any[]> = {};

  for (const ep of endpoints) {
    const path = String(ep.path || '');
    const segments = path.split('/').filter(Boolean);
    const apiIndex = segments.indexOf('api');
    if (apiIndex === -1) continue;

    for (let i = apiIndex + 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith(':') || seg.startsWith('{')) continue;
      const entity = seg.toLowerCase();
      entitySet.add(entity);
      if (!entityEndpoints[entity]) entityEndpoints[entity] = [];
      entityEndpoints[entity].push(ep);
    }
  }

  if (entitySet.size === 0) {
    const slug = appName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    entitySet.add(slug || 'items');
  }

  const paramTypeToPb = (t: string): string => {
    const type = String(t || '').toLowerCase();
    if (type === 'string') return 'text';
    if (['number', 'integer', 'float', 'double', 'decimal'].includes(type)) return 'number';
    if (['boolean', 'bool'].includes(type)) return 'bool';
    if (['date', 'datetime'].includes(type)) return 'date';
    if (type === 'email') return 'email';
    if (type === 'url') return 'url';
    if (['array', 'object', 'json'].includes(type)) return 'json';
    if (['binary', 'file', 'image', 'audio', 'video'].includes(type)) return 'file';
    return 'text';
  };

  const inferFileMimeTypes = (paramName: string, description?: string): string[] => {
    const text = (paramName + ' ' + (description || '')).toLowerCase();
    if (/\b(image|img|photo|picture|avatar|thumbnail|banner|logo|icon|cover|screenshot|screenshots)\b/.test(text)) {
      return ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'];
    }
    if (/\b(audio|sound|voice|music|podcast|mp3|wav|ogg|flac|recording)\b/.test(text)) {
      return ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac'];
    }
    if (/\b(video|movie|clip|film|mp4|mov|avi|mkv|youtube)\b/.test(text)) {
      return ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    }
    return [];
  };

  const makeField = (name: string, type: string, required: boolean, options: any): any => ({
    system: false,
    id: rndId(8),
    name,
    type,
    required,
    presentable: false,
    unique: false,
    options: options || {}
  });

  const schema = Array.from(entitySet).map((name) => {
    const collectionId = rndId(15);
    const fields: any[] = [];
    const addedFields = new Set<string>();

    const eps = entityEndpoints[name] || [];
    for (const ep of eps) {
      const pathParams = new Set(extractPathParams(String(ep.path || '')));
      const rawParams = ep.parameters;
      const epDescription = typeof ep.description === 'string' ? ep.description : '';

      if (rawParams && typeof rawParams === 'object') {
        const paramsToProcess = Array.isArray(rawParams)
          ? rawParams.reduce((acc: any, p: any) => { if (p.name) acc[p.name] = p; return acc; }, {})
          : rawParams;

        for (const [paramName, paramInfo] of Object.entries(paramsToProcess)) {
          if (paramName === 'id' || pathParams.has(paramName)) continue;
          if (addedFields.has(paramName)) continue;

          const info = (paramInfo || {}) as Record<string, any>;
          const pbType = paramTypeToPb(info.type);
          const required = info.required === true;

          let options: any = {};
          if (pbType === 'text') {
            options = { min: null, max: null, pattern: '' };
          } else if (pbType === 'number') {
            options = { min: null, max: null, noDecimal: false };
          } else if (pbType === 'bool') {
            options = {};
          } else if (pbType === 'date') {
            options = { min: '', max: '' };
          } else if (pbType === 'email') {
            options = { exceptDomains: [], onlyDomains: [] };
          } else if (pbType === 'url') {
            options = { exceptDomains: [], onlyDomains: [] };
          } else if (pbType === 'json') {
            options = { maxSize: 2000000 };
          } else if (pbType === 'file') {
            const mimeTypes = inferFileMimeTypes(paramName, epDescription);
            options = {
              mimeTypes,
              thumbs: null,
              maxSelect: 1,
              maxSize: 5242880,
              protected: false
            };
          }

          fields.push(makeField(paramName, pbType, required, options));
          addedFields.add(paramName);
        }
      }
    }

    if (fields.length === 0) {
      const titleField = makeField('title', 'text', false, { min: null, max: null, pattern: '' });
      fields.push(titleField);
    }

    return {
      id: collectionId,
      name,
      type: 'base',
      system: false,
      schema: fields,
      fields: fields,
      indexes: [],
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      options: {}
    };
  });

  for (const col of schema) {
    if (!Array.isArray(col.schema) || col.schema.length === 0) {
      const fallbackField = makeField('name', 'text', false, { min: null, max: null, pattern: '' });
      col.schema = [fallbackField];
      col.fields = [fallbackField];
    } else if (!col.fields || col.fields.length === 0) {
      col.fields = col.schema;
    }
  }

  return JSON.stringify(schema, null, 2);
}
