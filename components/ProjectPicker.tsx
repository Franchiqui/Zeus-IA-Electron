'use client';
import React, { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { useProjectStore, type ProjectInfo } from '@/lib/projectStore';

// Reemplaza a EnvironmentPathSetter. Implementa el flujo de F:\Agent:
// pickProjectFolder -> createProject -> setActiveProject -> startWorkspaceSession.
const ProjectPicker: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const {
    activeProjectId,
    activeCwd,
    projects,
    createProject,
    setActiveProject,
    startWorkspaceSession,
    rehydrateActiveSession,
    refreshProjectsFromPocketBase,
  } = useProjectStore();

  useEffect(() => {
    void rehydrateActiveSession();
    void refreshProjectsFromPocketBase();
  }, [rehydrateActiveSession, refreshProjectsFromPocketBase]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  // Deduplicar proyectos por path (un mismo directorio no aparece varias veces).
  // El proyecto activo se excluye de la lista de "otros".
  const uniqueProjects = projects.filter((p, i, arr) =>
    p.path && arr.findIndex((x) => x.path === p.path) === i
  );
  const otherProjects = uniqueProjects.filter((p) => p.id !== activeProjectId);

  const afterSessionStart = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('resetExplorerPath'));
      window.dispatchEvent(new CustomEvent('clearEditorFiles'));
    }
    setTimeout(() => {
      const store = useStore.getState();
      store.refreshExplorer();
      store.refreshPlans();
      // Invalidar queries de React Query para que recarguen datos del nuevo proyecto.
      // Los queryKey usan solo activeAppTab, así que hay que invalidarlas a mano.
      window.dispatchEvent(new CustomEvent('zeus-project-changed'));
    }, 150);
  };

  const pickAndStart = async (dir?: string) => {
    let path = dir;
    if (!path) {
      if (typeof window === 'undefined') return;
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.selectFolder) {
        alert('Selector de carpeta no disponible (modo no-Electron).');
        return;
      }
      try {
        const result = await electronAPI.selectFolder();
        if (result?.canceled || !result?.filePath) return;
        path = result.filePath;
      } catch (e) {
        console.error('Error al seleccionar carpeta:', e);
        alert('Error al seleccionar carpeta.');
        return;
      }
    }
    if (!path) return;
    const normPath = path.replace(/\\/g, '/');
    setBusy(true);
    try {
      // Verificar si ya existe un proyecto con el mismo path en el espejo local.
      const existing = useProjectStore.getState().projects.find((p) => p.path === normPath);
      if (existing) {
        // Reutilizar el proyecto existente en vez de crear un duplicado.
        setActiveProject(existing.id);
        const session = await startWorkspaceSession(normPath, existing.id);
        if (!session) {
          // Si Express no responde, al menos fijar el cwd.
          useProjectStore.getState().setActiveSession(null, normPath);
        }
        afterSessionStart();
        return;
      }
      const authUser = useStore.getState().user;
      const project = await createProject({ name: '', path: normPath, userId: authUser?.id });
      const pid = project?.id || null;
      if (pid) setActiveProject(pid);
      const session = await startWorkspaceSession(normPath, pid || undefined);
      if (!session) {
        // Si Express no responde, al menos fijar el cwd.
        useProjectStore.getState().setActiveSession(null, normPath);
      }
      if (pid && project) {
        useProjectStore.getState().upsertLocalProject(project);
      }
      afterSessionStart();
    } catch (e) {
      console.error('Error al crear/iniciar proyecto:', e);
      alert('Error al abrir la carpeta como proyecto.');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (p: ProjectInfo) => {
    setShowList(false);
    setBusy(true);
    try {
      setActiveProject(p.id);
      const session = await startWorkspaceSession(p.path, p.id);
      if (!session) {
        // Si Express no responde, al menos fijar el cwd.
        useProjectStore.getState().setActiveSession(null, p.path);
      }
      // Refrescar la lista de proyectos desde PocketBase local.
      await useProjectStore.getState().refreshProjectsFromPocketBase();
      afterSessionStart();
    } catch (e) {
      console.error('Error al cambiar de proyecto:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data-path-setter" style={{ position: 'relative' }}>
      <label htmlFor="project-picker" className="data-path-label">Carpeta de proyecto</label>
      <div className="data-path-input-wrapper">
        <input
          id="project-picker"
          type="text"
          value={activeCwd || activeProject?.path || ''}
          readOnly
          placeholder="Ninguna carpeta seleccionada"
          className="data-path-input"
        />
        <button
          onClick={() => pickAndStart()}
          disabled={busy}
          className="data-path-button"
          title="Seleccionar carpeta de proyecto"
        >
          {busy ? '...' : 'Abrir'}
        </button>
        <button
          onClick={() => setShowList((v) => !v)}
          disabled={busy}
          className="data-path-button"
          title="Cambiar de proyecto"
          style={{ marginLeft: 4 }}
        >
          ▾
        </button>
      </div>
      {showList && (
        <ul
          style={{
            position: 'absolute', zIndex: 50, right: 0, left: 0, top: '100%',
            margin: '4px 0 0', padding: 0, listStyle: 'none',
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6, maxHeight: 240, overflow: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {/* Proyecto activo destacado al principio */}
          {activeProject && (
            <li
              onClick={() => setShowList(false)}
              style={{
                padding: '8px 10px', fontSize: 12, cursor: 'default',
                background: 'rgba(34,197,94,0.12)',
                borderBottom: '1px solid hsl(var(--border))',
              }}
            >
              <div style={{ fontWeight: 700, color: 'hsl(var(--foreground))' }}>
                ● {activeProject.name}
              </div>
              <div style={{ opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11 }}>
                {activeProject.path}
              </div>
            </li>
          )}
          {/* Otros proyectos (deduplicados por path) */}
          {otherProjects.length === 0 && !activeProject ? (
            <li
              style={{
                padding: '10px 12px', fontSize: 12, opacity: 0.6,
                cursor: 'default', textAlign: 'center',
              }}
            >
              No hay otros proyectos. Pulsa «Abrir» para seleccionar una carpeta.
            </li>
          ) : (
            otherProjects.map((p) => (
            <li
              key={p.id}
              onClick={() => switchTo(p)}
              style={{
                padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                background: 'transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>{p.name}</div>
              <div style={{ opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'hsl(var(--muted-foreground))' }}>{p.path}</div>
            </li>
          ))
          )}
        </ul>
      )}
    </div>
  );
};

export default ProjectPicker;