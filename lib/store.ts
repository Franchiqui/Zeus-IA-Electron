import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import pb from '@/lib/pocketbase';
import { MODELOS_COLLECTION_NAME, type ModeloRecord } from '@/lib/collections';
import type { InstalledExtension } from '@/types/vscode-extensions';

/** Estado y acciones del slice de extensiones VS Code dentro del store global. */
interface ExtensionsSlice {
  installed: InstalledExtension[];
  lastFetch: number;        // epoch ms (no persistido)
  codeAvailable: boolean;
  codePath: string | null;
  codeVersion: string | null;
  operationInFlight: boolean;  // no persistido
  setInstalled: (
    list: InstalledExtension[],
    available: boolean,
    path: string | null,
    version: string | null,
  ) => void;
  setOperationInFlight: (v: boolean) => void;
  upsertExtension: (ext: InstalledExtension) => void;
  removeExtension: (id: string) => void;
}

// Define the auth state interface
interface AuthState {
  user: any | null;
  isLoading: boolean;
  models: ModeloRecord[];
  selectedModel: ModeloRecord | null;
  explorerRefreshTrigger: number;
  previewUrl: string | null;
  isPreviewRunning: boolean;
  previewPort: number;
  extensions: ExtensionsSlice;
  init: () => void;
  setUser: (user: any | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  logout: () => void;
  fetchModels: () => Promise<void>;
  setSelectedModel: (model: ModeloRecord | null) => void;
  refreshExplorer: () => void;
  refreshPlans: () => void;
  setPreviewUrl: (url: string | null) => void;
  setIsPreviewRunning: (running: boolean) => void;
  setPreviewPort: (port: number) => void;
}

// Create the main store
export const useStore = create<AuthState>()(
  devtools(
    persist(
      (set, get) => ({
        user: null,
        isLoading: true,
        models: [],
        selectedModel: null,
        explorerRefreshTrigger: 0,
        previewUrl: null,
        isPreviewRunning: false,
        previewPort: 3000,
        extensions: {
          installed: [],
          lastFetch: 0,
          codeAvailable: false,
          codePath: null,
          codeVersion: null,
          operationInFlight: false,
          setInstalled: (list, available, path, version) =>
            set((state) => ({
              extensions: {
                ...state.extensions,
                installed: list,
                codeAvailable: available,
                codePath: path,
                codeVersion: version,
                lastFetch: Date.now(),
                operationInFlight: false,
              },
            })),
          setOperationInFlight: (v) =>
            set((state) => ({
              extensions: { ...state.extensions, operationInFlight: v },
            })),
          upsertExtension: (ext) =>
            set((state) => {
              const idx = state.extensions.installed.findIndex((e) => e.id === ext.id);
              const next =
                idx >= 0
                  ? [
                      ...state.extensions.installed.slice(0, idx),
                      ext,
                      ...state.extensions.installed.slice(idx + 1),
                    ]
                  : [...state.extensions.installed, ext];
              return { extensions: { ...state.extensions, installed: next } };
            }),
          removeExtension: (id) =>
            set((state) => ({
              extensions: {
                ...state.extensions,
                installed: state.extensions.installed.filter((e) => e.id !== id),
              },
            })),
        },
        init: async () => {
          // NO re-autenticar automáticamente como admin si queremos respetar el logout del usuario
          // Si el usuario ya está autenticado (vía cookie/localStorage), pb.authStore.isValid será true.

          if (pb.authStore.isValid) {
            console.log('✅ Sesión existente detectada:', pb.authStore.model?.email);
            set({ user: pb.authStore.model, isLoading: false });
            await get().fetchModels();
          } else {
            console.log('ℹ️ No hay sesión activa al iniciar.');
            set({ user: null, isLoading: false, models: [], selectedModel: null });
          }
        },
        setUser: (user) => set({ user, isLoading: false }),
        setIsLoading: (isLoading) => set({ isLoading }),
        logout: () => {
          console.log('🚪 Cerrando sesión en el store...');
          pb.authStore.clear();
          set({ user: null, models: [], selectedModel: null });
        },
        fetchModels: async () => {
          try {
            console.log('📡 Intentando cargar modelos...');
            // Solo pedir modelos si hay una sesión válida
            if (!pb.authStore.isValid) {
              console.warn('⚠️ No se pueden cargar modelos: Sesión inválida');
              set({ models: [], selectedModel: null });
              return;
            }

            console.log('🔍 Consultando modelos para el usuario:', pb.authStore.model?.id);

            // Filtramos siempre por usuario si no es administrador global
            const currentUserId = pb.authStore.model?.id;
            const options: any = { sort: '-created' };
            if (currentUserId) {
              options.filter = `user = "${currentUserId}"`;
            }

            const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList<ModeloRecord>(options);

            console.log('✨ Modelos recibidos:', records.length);
            set({ models: records });

            // If no model is selected but we have models, select the first one
            const currentSelected = get().selectedModel;
            if (!currentSelected && records.length > 0) {
              console.log('🎯 Seleando modelo inicial:', records[0].nombre_modelo);
              set({ selectedModel: records[0] });
            } else if (currentSelected) {
              const updated = records.find(m => m.id === currentSelected.id);
              if (updated) set({ selectedModel: updated });
              else if (records.length > 0) set({ selectedModel: records[0] });
              else set({ selectedModel: null });
            }
          } catch (error) {
            console.error('❌ Error crítico al cargar modelos:', error);
            set({ models: [], selectedModel: null });
          }
        },
        setSelectedModel: (model) => set({ selectedModel: model }),
        setPreviewUrl: (url) => set({ previewUrl: url }),
        setIsPreviewRunning: (running) => set({ isPreviewRunning: running }),
        setPreviewPort: (port) => set({ previewPort: port }),
        refreshExplorer: () => set((state) => ({ explorerRefreshTrigger: state.explorerRefreshTrigger + 1 })),
        refreshPlans: () => {
          // Esta función será usada para invalidar las queries de planes
          // y forzar su recarga en los componentes que usan useQuery
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('refreshPlans'));
          }
        },
      }),
      {
        name: 'main-store',
        version: 3,
        // Solo persistir los slices serializables.
        // IMPORTANTE: previewUrl/isPreviewRunning/previewPort NO se persisten:
        // la URL del preview pertenece al proyecto que la lanzó y a la sesión
        // actual. Si se persistía, al recargar o abrir otro proyecto la vista
        // previa seguía renderizando SIEMPRE el mismo proyecto guardado.
        partialize: (state) => ({
          selectedModel: state.selectedModel,
          user: state.user,
          extensions: {
            installed: state.extensions.installed,
            codeAvailable: state.extensions.codeAvailable,
            codePath: state.extensions.codePath,
            codeVersion: state.extensions.codeVersion,
          },
        }),
        // Migración: si encontramos una versión anterior con un "extensions" en otra
        // forma, lo descartamos para no romper la nueva shape.
        migrate: (persistedState: any, fromVersion) => {
          if (!persistedState) return persistedState;
          if (fromVersion < 2 && persistedState.extensions) {
            return {
              ...persistedState,
              extensions: {
                installed: [],
                codeAvailable: false,
                codePath: null,
                codeVersion: null,
              },
            };
          }
          // v3: limpiar el preview persistido de versiones anteriores para que
          // la vista previa no quede anclada a un proyecto antiguo.
          if (fromVersion < 3) {
            return {
              ...persistedState,
              previewUrl: null,
              isPreviewRunning: false,
              previewPort: 3000,
            };
          }
          return persistedState;
        },
        // Merge: CRÍTICO. El default `{...current, ...persisted}` reemplaza
        // `extensions` entero, perdiendo los setters (setInstalled, etc.).
        // Hacemos un merge por clave de primer nivel, y dentro de `extensions`
        // mezclamos campo a campo para preservar funciones y resto del state.
        merge: (persistedState, currentState) => {
          const p = persistedState as Partial<AuthState> | null | undefined;
          const c = currentState as AuthState;
          if (!p) return c;
          const merged: AuthState = { ...c, ...p };
          if (p.extensions && c.extensions) {
            merged.extensions = { ...c.extensions, ...p.extensions } as ExtensionsSlice;
          }
          return merged;
        },
      }
    )
  )
);
