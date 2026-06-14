'use client';
import { id } from 'date-fns/locale';
import React, { useState } from 'react';

const ENDPOINTS = [{"id":"list-apps","method":"GET","path":"/api/apps","description":"Lista todas las aplicaciones con filtros opcionales"},{"id":"get-app","method":"GET","path":"/api/apps/{id}","description":"Obtiene una aplicación por ID"},{"id":"create-app","method":"POST","path":"/api/apps","description":"Crea una nueva aplicación con archivo zip y screenshot"},{"id":"update-app","method":"PUT","path":"/api/apps/{id}","description":"Actualiza una aplicación existente"},{"id":"delete-app","method":"DELETE","path":"/api/apps/{id}","description":"Elimina una aplicación y sus archivos"},{"id":"download-app","method":"GET","path":"/api/apps/{id}/download","description":"Descarga el archivo zip de la aplicación"},{"id":"preview-app","method":"GET","path":"/api/apps/{id}/preview","description":"Renderiza la aplicación en vista previa (devuelve HTML/JS embebido)"},{"id":"rate-app","method":"PATCH","path":"/api/apps/{id}/rate","description":"Actualiza la valoración de una aplicación"},{"id":"list-categories","method":"GET","path":"/api/categories","description":"Lista las categorías disponibles"},{"id":"search-apps","method":"GET","path":"/api/apps/search","description":"Búsqueda avanzada de aplicaciones"}];

export default function ApiDashboard() {
  const [params, setParams] = useState<any[]>([{}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [results, setResults] = useState<Record<number, any>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const updateParam = (idx: number, key: string, value: any) => {
    setParams(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const updateFileParam = (idx: number, file: File | null) => {
    setFiles(prev => ({ ...prev, [idx]: file }));
  };

  const testEndpoint = async (idx: number) => {
    setLoading(prev => ({ ...prev, [idx]: true }));
    setErrors(prev => ({ ...prev, [idx]: '' }));
    try {
      const ep = ENDPOINTS[idx];
      let res: Response | undefined;
      switch (idx) {
      case 0:
        res = await fetch(`http://localhost:3000/api/apps?search=${encodeURIComponent(params[0]['search'] || '')}&category=${encodeURIComponent(params[0]['category'] || '')}&page=${encodeURIComponent(params[0]['page'] || '')}&perPage=${encodeURIComponent(params[0]['perPage'] || '')}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      case 1:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[1]['id'] || '')}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      case 2:
        res = await fetch(`http://localhost:3000/api/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params[2]) });
        break;
      case 3:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[3]['id'] || '')}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params[3]) });
        break;
      case 4:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[4]['id'] || '')}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
        break;
      case 5:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[5]['id'] || '')}/download`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      case 6:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[6]['id'] || '')}/preview`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      case 7:
        res = await fetch(`http://localhost:3000/api/apps/${encodeURIComponent(params[7]['id'] || '')}/rate`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params[7]) });
        break;
      case 8:
        res = await fetch(`http://localhost:3000/api/categories`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      case 9:
        res = await fetch(`http://localhost:3000/api/apps/search?q=${encodeURIComponent(params[9]['q'] || '')}&category=${encodeURIComponent(params[9]['category'] || '')}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        break;
      }
      if (!res) throw new Error('No response received');
      if (!res.ok) throw new Error(ep.method + ' ' + ep.path + ' failed: ' + res.status);
      const data = await res.json();
      setResults(prev => ({ ...prev, [idx]: data }));
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [idx]: err.message || 'Error' }));
    } finally {
      setLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  return (
    <div className="p-6 bg-gray-950 text-gray-100 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">API Dashboard</h1>
      <p className="text-gray-400 mb-6">App Librari — 10 endpoints disponibles</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border border-gray-800 rounded-lg">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase">Método</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase">Path</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase">Descripción</th>
              <th className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase">Acción</th>
            </tr>
          </thead>
          <tbody>
              <tr key="list-apps" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps</td>
                <td className="px-3 py-2 text-sm text-gray-400">Lista todas las aplicaciones con filtros opcionales</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">search</label>
                        <input type="text" value={params[0]['search'] || ''} onChange={(e) => updateParam(0, 'search', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">category</label>
                        <input type="text" value={params[0]['category'] || ''} onChange={(e) => updateParam(0, 'category', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">page</label>
                        <input type="text" value={params[0]['page'] || ''} onChange={(e) => updateParam(0, 'page', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">perPage</label>
                        <input type="text" value={params[0]['perPage'] || ''} onChange={(e) => updateParam(0, 'perPage', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(0)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[0] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[0] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[0], null, 2)}</pre>
                    </div>
                  )}
                  {errors[0] && (
                    <div className="mt-2 text-xs text-red-400">{errors[0]}</div>
                  )}
                </td>
              </tr>
              <tr key="get-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}</td>
                <td className="px-3 py-2 text-sm text-gray-400">Obtiene una aplicación por ID</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[1]['id'] || ''} onChange={(e) => updateParam(1, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(1)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[1] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[1] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[1], null, 2)}</pre>
                    </div>
                  )}
                  {errors[1] && (
                    <div className="mt-2 text-xs text-red-400">{errors[1]}</div>
                  )}
                </td>
              </tr>
              <tr key="create-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-blue-900 text-blue-300">POST</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps</td>
                <td className="px-3 py-2 text-sm text-gray-400">Crea una nueva aplicación con archivo zip y screenshot</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">name</label>
                        <input type="text" value={params[2]['name'] || ''} onChange={(e) => updateParam(2, 'name', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">description</label>
                        <input type="text" value={params[2]['description'] || ''} onChange={(e) => updateParam(2, 'description', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">category</label>
                        <input type="text" value={params[2]['category'] || ''} onChange={(e) => updateParam(2, 'category', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">rating</label>
                        <input type="text" value={params[2]['rating'] || ''} onChange={(e) => updateParam(2, 'rating', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">file</label>
                        <input type="text" value={params[2]['file'] || ''} onChange={(e) => updateParam(2, 'file', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">screenshot</label>
                        <input type="text" value={params[2]['screenshot'] || ''} onChange={(e) => updateParam(2, 'screenshot', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(2)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[2] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[2] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[2], null, 2)}</pre>
                    </div>
                  )}
                  {errors[2] && (
                    <div className="mt-2 text-xs text-red-400">{errors[2]}</div>
                  )}
                </td>
              </tr>
              <tr key="update-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-yellow-900 text-yellow-300">PUT</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}</td>
                <td className="px-3 py-2 text-sm text-gray-400">Actualiza una aplicación existente</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[3]['id'] || ''} onChange={(e) => updateParam(3, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">name</label>
                        <input type="text" value={params[3]['name'] || ''} onChange={(e) => updateParam(3, 'name', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">description</label>
                        <input type="text" value={params[3]['description'] || ''} onChange={(e) => updateParam(3, 'description', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">category</label>
                        <input type="text" value={params[3]['category'] || ''} onChange={(e) => updateParam(3, 'category', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">rating</label>
                        <input type="text" value={params[3]['rating'] || ''} onChange={(e) => updateParam(3, 'rating', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(3)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[3] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[3] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[3], null, 2)}</pre>
                    </div>
                  )}
                  {errors[3] && (
                    <div className="mt-2 text-xs text-red-400">{errors[3]}</div>
                  )}
                </td>
              </tr>
              <tr key="delete-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-red-900 text-red-300">DELETE</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}</td>
                <td className="px-3 py-2 text-sm text-gray-400">Elimina una aplicación y sus archivos</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[4]['id'] || ''} onChange={(e) => updateParam(4, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(4)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[4] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[4] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[4], null, 2)}</pre>
                    </div>
                  )}
                  {errors[4] && (
                    <div className="mt-2 text-xs text-red-400">{errors[4]}</div>
                  )}
                </td>
              </tr>
              <tr key="download-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}/download</td>
                <td className="px-3 py-2 text-sm text-gray-400">Descarga el archivo zip de la aplicación</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[5]['id'] || ''} onChange={(e) => updateParam(5, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(5)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[5] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[5] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[5], null, 2)}</pre>
                    </div>
                  )}
                  {errors[5] && (
                    <div className="mt-2 text-xs text-red-400">{errors[5]}</div>
                  )}
                </td>
              </tr>
              <tr key="preview-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}/preview</td>
                <td className="px-3 py-2 text-sm text-gray-400">Renderiza la aplicación en vista previa (devuelve HTML/JS embebido)</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[6]['id'] || ''} onChange={(e) => updateParam(6, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(6)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[6] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[6] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[6], null, 2)}</pre>
                    </div>
                  )}
                  {errors[6] && (
                    <div className="mt-2 text-xs text-red-400">{errors[6]}</div>
                  )}
                </td>
              </tr>
              <tr key="rate-app" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-yellow-900 text-yellow-300">PATCH</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/{'{'}id{'}'}/rate</td>
                <td className="px-3 py-2 text-sm text-gray-400">Actualiza la valoración de una aplicación</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">id</label>
                        <input type="text" value={params[7]['id'] || ''} onChange={(e) => updateParam(7, 'id', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">rating</label>
                        <input type="text" value={params[7]['rating'] || ''} onChange={(e) => updateParam(7, 'rating', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(7)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[7] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[7] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[7], null, 2)}</pre>
                    </div>
                  )}
                  {errors[7] && (
                    <div className="mt-2 text-xs text-red-400">{errors[7]}</div>
                  )}
                </td>
              </tr>
              <tr key="list-categories" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/categories</td>
                <td className="px-3 py-2 text-sm text-gray-400">Lista las categorías disponibles</td>
                <td className="px-3 py-2">

                  <button onClick={() => testEndpoint(8)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[8] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[8] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[8], null, 2)}</pre>
                    </div>
                  )}
                  {errors[8] && (
                    <div className="mt-2 text-xs text-red-400">{errors[8]}</div>
                  )}
                </td>
              </tr>
              <tr key="search-apps" className="border-b border-gray-800">
                <td className="px-3 py-2 text-sm"><span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-900 text-green-300">GET</span></td>
                <td className="px-3 py-2 text-sm text-gray-300">/api/apps/search</td>
                <td className="px-3 py-2 text-sm text-gray-400">Búsqueda avanzada de aplicaciones</td>
                <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">q</label>
                        <input type="text" value={params[9]['q'] || ''} onChange={(e) => updateParam(9, 'q', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-gray-400">category</label>
                        <input type="text" value={params[9]['category'] || ''} onChange={(e) => updateParam(9, 'category', e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white" />
                      </div>
                  <button onClick={() => testEndpoint(9)} className="mt-2 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded">{loading[9] ? 'Ejecutando...' : 'Probar'}</button>
                  {results[9] && (
                    <div className="mt-2 text-xs bg-gray-900 border border-gray-700 rounded p-2 max-h-32 overflow-auto">
                      <pre className="text-green-400">{JSON.stringify(results[9], null, 2)}</pre>
                    </div>
                  )}
                  {errors[9] && (
                    <div className="mt-2 text-xs text-red-400">{errors[9]}</div>
                  )}
                </td>
              </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
