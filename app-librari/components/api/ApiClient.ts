// Auto-generated API client for App Librari
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export async function api_apps(search?: string, category?: string, page?: string, perPage?: string) {
  const res = await fetch(`http://localhost:3000/api/apps?search=${encodeURIComponent(String(search || ''))}&category=${encodeURIComponent(String(category || ''))}&page=${encodeURIComponent(String(page || ''))}&perPage=${encodeURIComponent(String(perPage || ''))}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/apps failed: ' + res.status);
  return res.json();
}

export async function api_apps_id(id: string) {
  const res = await fetch(`http://localhost:3000/api/apps/$${encodeURIComponent(String(encodeURIComponent(String(id))))}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/apps/{id} failed: ' + res.status);
  return res.json();
}

export async function api_apps_create(name: string, description: string, category: string, rating?: number, file?: File, screenshot?: File) {
  const res = await fetch(`http://localhost:3000/api/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, category, rating, file, screenshot })
  });
  if (!res.ok) throw new Error('POST /api/apps failed: ' + res.status);
  return res.json();
}

export async function api_apps_id_update(id: string, name?: string, description?: string, category?: string, rating?: number) {
  const res = await fetch(`http://localhost:3000/api/apps/$${encodeURIComponent(String(encodeURIComponent(String(id))))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, description, category, rating })
  });
  if (!res.ok) throw new Error('PUT /api/apps/{id} failed: ' + res.status);
  return res.json();
}

export async function api_apps_id_delete(id: string) {
  const res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(String(encodeURIComponent(String(id))))}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('DELETE /api/apps/{id} failed: ' + res.status);
  return res.json();
}

export async function api_apps_id_download(id: string) {
  const res = await fetch(`http://localhost:3000/api/apps/$${encodeURIComponent(String(encodeURIComponent(String(id))))}/download`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/apps/{id}/download failed: ' + res.status);
  return res.json();
}

export async function api_apps_id_preview(id: string) {
  const res = await fetch(`http://localhost:3000/api/apps/$${encodeURIComponent(String(encodeURIComponent(String(id))))}/preview`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/apps/{id}/preview failed: ' + res.status);
  return res.json();
}

export async function api_apps_id_rate(id: string, rating: number) {
  const res = await fetch(`http://localhost:3000/api/apps/$${encodeURIComponent(String(encodeURIComponent(String(id))))}/rate`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, rating })
  });
  if (!res.ok) throw new Error('PATCH /api/apps/{id}/rate failed: ' + res.status);
  return res.json();
}

export async function api_categories() {
  const res = await fetch(`http://localhost:3000/api/categories`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/categories failed: ' + res.status);
  return res.json();
}

export async function api_apps_search(q: string, category?: string) {
  const res = await fetch(`http://localhost:3000/api/apps/search?q=${encodeURIComponent(String(q || ''))}&category=${encodeURIComponent(String(category || ''))}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('GET /api/apps/search failed: ' + res.status);
  return res.json();
}
