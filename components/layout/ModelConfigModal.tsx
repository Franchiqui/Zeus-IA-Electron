'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/modal';
import pb, { saveToBothDatabases, deleteFromBothDatabases } from '@/lib/pocketbase';
import { MODELOS_FIELDS, MODELOS_COLLECTION_NAME } from '@/lib/collections';
import type { ModeloRecord } from '@/lib/collections';
import { RefreshCw, Trash2, Edit2, Plus, X, User, Mail, Lock, Check, AlertCircle, MoreVertical, ZoomIn, ZoomOut, Maximize, RotateCcw, Zap, Terminal } from 'lucide-react';
import { useTranslation } from '@/contexts/translation-context';

/** Formulario interno (nombres de UI) */
export type ModelConfigForm = {
  id?: string;
  provider: string;
  name: string;
  model_name: string;
  base_url: string;
  api_key: string;
  max_token: number;
  temperature: number;
  type: string;
};

/** Formulario de registro de usuario */
export type UserRegisterForm = {
  email: string;
  password: string;
  passwordConfirm: string;
  name: string;
};

/** Formulario de login de usuario */
export type UserLoginForm = {
  email: string;
  password: string;
  remember: boolean;
};

const DEFAULT_FORM: Omit<ModelConfigForm, 'id'> = {
  provider: '',
  name: '',
  model_name: '',
  base_url: '',
  api_key: '',
  max_token: 4096,
  temperature: 0.7,
  type: 'remote',
};

function recordToForm(r: ModeloRecord): ModelConfigForm {
  return {
    id: r.id,
    provider: (r.provider as string) ?? '',
    name: (r.name as string) ?? '',
    model_name: (r.model_name as string) ?? '',
    base_url: (r.base_url as string) ?? '',
    api_key: (r.api_key as string) ?? '',
    max_token: typeof r.config?.max_token === 'number' ? r.config.max_token : 4096,
    temperature: typeof r.config?.temperature === 'number' ? r.config.temperature : 0.7,
    type: (r.type as string) ?? 'remote',
  };
}

interface ModelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ModelConfigModal({ isOpen, onClose, onSaved }: ModelConfigModalProps) {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<ModelConfigForm[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<ModelConfigForm>({ ...DEFAULT_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados para pestañas y registro de usuarios
  const [activeTab, setActiveTab] = useState<'models' | 'users' | 'login'>('models');
  const [userForm, setUserForm] = useState<UserRegisterForm>({
    email: '',
    password: '',
    passwordConfirm: '',
    name: ''
  });
  const [loginForm, setLoginForm] = useState<UserLoginForm>({
    email: '',
    password: '',
    remember: false
  });
  const [userError, setUserError] = useState<string | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Estado para el menú desplegable de opciones
  const [menuOpen, setMenuOpen] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Filtrar modelos por usuario autenticado
      const userId = pb.authStore.model?.id;
      const filter = userId ? `user = "${userId}"` : '';
      
      const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList<ModeloRecord>({
        sort: '-created',
        filter
      });
      setConfigs(records.map(recordToForm));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoadingModels'));
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadModels();
      setEditingIndex(null);
      setForm({ ...DEFAULT_FORM });
    }
  }, [isOpen, loadModels]);

  const handleSave = async () => {
    // Validación básica según esquema PocketBase
    if (!form.name.trim() || !form.model_name.trim()) {
      setError(t('nameAndIdRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const userId = pb.authStore.model?.id;
      const payload: any = {
        name: form.name.trim(),
        model_name: form.model_name.trim(),
        provider: form.provider.trim(),
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        type: form.type,
        config: {
          max_token: form.max_token,
          temperature: form.temperature
        }
      };

      // Asociar el modelo con el usuario autenticado
      if (userId) {
        payload.user = userId;
      }

      const record = await saveToBothDatabases(MODELOS_COLLECTION_NAME, payload, form.id);

      if (editingIndex !== null && form.id) {
        const next = [...configs];
        next[editingIndex] = recordToForm(record);
        setConfigs(next);
        setEditingIndex(null);
      } else {
        setConfigs((prev) => [recordToForm(record), ...prev]);
      }

      setForm({ ...DEFAULT_FORM });
      onSaved?.();
    } catch (e: any) {
      console.error('Error PocketBase:', e.data);
      setError(e.message || t('errorSavingModel'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setForm({ ...configs[index] });
    setError(null);
  };

  const handleDelete = async (index: number) => {
    const item = configs[index];
    if (!item.id) return;
    if (!confirm(t('deleteModelConfirm').replace('{name}', item.name))) return;

    setSaving(true);
    setError(null);
    try {
      await deleteFromBothDatabases(MODELOS_COLLECTION_NAME, item.id);
      setConfigs(configs.filter((_, i) => i !== index));
      if (editingIndex === index) {
        setEditingIndex(null);
        setForm({ ...DEFAULT_FORM });
      }
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorSavingModel'));
    } finally {
      setSaving(false);
    }
  };

  const handleUserRegister = async () => {
    // Validación del formulario
    if (!userForm.email.trim() || !userForm.password.trim() || !userForm.name.trim()) {
      setUserError(t('allFieldsRequired').replace('· ', ''));
      return;
    }

    if (userForm.password.length < 8) {
      setUserError(t('passwordMinLength'));
      return;
    }

    if (userForm.password !== userForm.passwordConfirm) {
      setUserError(t('passwordsDoNotMatch'));
      return;
    }

    if (!userForm.email.includes('@')) {
      setUserError(t('invalidEmail'));
      return;
    }

    setUserSaving(true);
    setUserError(null);
    
    try {
      const userData = {
        email: userForm.email.trim(),
        password: userForm.password,
        passwordConfirm: userForm.passwordConfirm,
        name: userForm.name.trim(),
        emailVisibility: false,
        verified: false
      };

      // Crear usuario en ambas bases de datos
      await saveToBothDatabases('users', userData);
      
      setRegisterSuccess(true);
      setUserForm({
        email: '',
        password: '',
        passwordConfirm: '',
        name: ''
      });
      
      // Limpiar éxito después de 3 segundos
      setTimeout(() => {
        setRegisterSuccess(false);
      }, 3000);
      
    } catch (e: any) {
      console.error('Error al registrar usuario:', e);
      if (e.data?.email) {
        setUserError(t('emailAlreadyRegistered'));
      } else if (e.data?.password) {
        setUserError(t('passwordRequirementsNotMet'));
      } else {
        setUserError(e.message || t('errorRegisteringUser'));
      }
    } finally {
      setUserSaving(false);
    }
  };

  const handleUserLogin = async () => {
    // Validación del formulario
    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      setUserError(t('emailAndPasswordRequired'));
      return;
    }

    if (!loginForm.email.includes('@')) {
      setUserError(t('invalidEmail'));
      return;
    }

    setUserSaving(true);
    setUserError(null);
    
    try {
      // Autenticar usuario con PocketBase
      const authData = await pb.collection('users').authWithPassword(
        loginForm.email.trim(),
        loginForm.password
      );

      console.log('Usuario autenticado:', authData);
      
      // Guardar siempre en localStorage para que UserInfo funcione
      localStorage.setItem('pb_auth', JSON.stringify({
        token: pb.authStore.token,
        model: pb.authStore.model
      }));

      setLoginSuccess(true);
      setLoginForm({
        email: '',
        password: '',
        remember: false
      });
      
      // Limpiar éxito después de 2 segundos
      setTimeout(() => {
        setLoginSuccess(false);
        onClose();
      }, 2000);
      
    } catch (e: any) {
      console.error('Error al iniciar sesión:', e);
      if (e.status === 400) {
        setUserError(t('incorrectEmailOrPassword'));
      } else {
        setUserError(e.message || t('errorLoggingIn'));
      }
    } finally {
      setUserSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      console.log('Cerrando sesión...');
      
      // Cerrar sesión de PocketBase
      pb.authStore.clear();
      
      // Limpiar localStorage
      localStorage.removeItem('pb_auth');
      
      // Limpiar cualquier estado relacionado con el chat
      localStorage.removeItem('zeus_chat_persisted');
      localStorage.removeItem('zeus_chat_history_positions_v5');
      localStorage.removeItem('zeus_chat_fab_position');
      
      console.log('Sesión cerrada y estado limpiado');
      
      // Forzar recarga completa para limpiar todo el estado
      window.location.reload();
      
    } catch (e) {
      console.error('Error al cerrar sesión:', e);
      // Forzar recarga incluso si hay error
      window.location.reload();
    }
  };

  const applyZoom = (delta: number | null) => {
    const api = (typeof window !== 'undefined' && (window as any).electronAPI?.zoom) ? (window as any).electronAPI.zoom : null;
    if (api) {
      const current = api.get();
      const next = delta === null ? 1 : Math.max(0.5, Math.min(3, current + delta));
      api.set(next);
      localStorage.setItem('zeus-zoom', String(next));
      return;
    }
    const current = parseFloat((document.documentElement.style.zoom as string) || '1');
    const next = delta === null ? 1 : Math.max(0.5, Math.min(3, current + delta));
    document.documentElement.style.zoom = String(next);
    localStorage.setItem('zeus-zoom', String(next));
  };

  const handleReload = (force = false) => {
    const api = (typeof window !== 'undefined' && (window as any).electronAPI?.page) ? (window as any).electronAPI.page : null;
    if (api) {
      if (force) api.forceReload();
      else api.reload();
      return;
    }
    window.location.reload();
  };

  const handleOpenDevTools = () => {
    const api = (typeof window !== 'undefined' && (window as any).electronAPI?.devTools) ? (window as any).electronAPI.devTools : null;
    if (api) {
      api.open();
      return;
    }
    // Fallback for browser
    console.log('Developer Tools not available in browser mode');
  };

  const modalButtonBase = 'rounded-xl border bg-gradient-to-b from-white/10 to-transparent text-foreground text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const modalIconButtonBase = 'rounded-lg border bg-gradient-to-b from-white/10 to-transparent text-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('modelManagementTitle')}
      size="lg"
    >
      <div className="space-y-6">
        {/* Pestañas */}
        <div className="flex border-b border-border/80 gap-2 justify-between items-center">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('models')}
              className={`px-6 py-3 text-sm font-medium transition-all rounded-t-xl border bg-gradient-to-b from-white/10 to-transparent ${
                activeTab === 'models'
                  ? 'text-foreground border-blue-400'
                  : 'text-foreground/90 border-border/50 hover:border-blue-500/60'
              }`}
            >
              <span className="mr-2">{t('modelIA')}</span>
              <span className="text-xs">({configs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`px-6 py-3 text-sm font-medium transition-all rounded-t-xl border bg-gradient-to-b from-white/10 to-transparent ${
                activeTab === 'users'
                  ? 'text-foreground border-green-400'
                  : 'text-foreground/90 border-border/50 hover:border-green-500/60'
              }`}
            >
              <span className="mr-2">{t('userRegister')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('login')}
              className={`px-6 py-3 text-sm font-medium transition-all rounded-t-xl border bg-gradient-to-b from-white/10 to-transparent ${
                activeTab === 'login'
                  ? 'text-foreground border-green-400'
                  : 'text-foreground/90 border-border/50 hover:border-green-500/60'
              }`}
            >
              <span className="mr-2">{t('userLogin')}</span>
            </button>
          </div>

          {/* Botón de 3 puntos con menú desplegable */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={`${modalIconButtonBase} p-2 border-border/40 hover:border-gray-400 mr-1`}
              title={t('moreOptions')}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-border/50 bg-background shadow-2xl z-50 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-black text-muted-foreground/80 uppercase tracking-wider border-b border-border/80">
                    {t('viewLabel')}
                  </div>
                  <div className="p-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { applyZoom(-0.1); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} flex-1 py-2 border-border/40 hover:border-gray-400 flex items-center justify-center gap-1.5`}
                      title="Alejar"
                    >
                      <ZoomOut className="w-4 h-4" />
                      <span className="text-xs">{t('zoomOutBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { applyZoom(null); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} flex-1 py-2 border-border/40 hover:border-gray-400 flex items-center justify-center gap-1.5`}
                      title="100%"
                    >
                      <Maximize className="w-4 h-4" />
                      <span className="text-xs">100%</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { applyZoom(0.1); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} flex-1 py-2 border-border/40 hover:border-gray-400 flex items-center justify-center gap-1.5`}
                      title="Acercar"
                    >
                      <ZoomIn className="w-4 h-4" />
                      <span className="text-xs">{t('zoomInBtn')}</span>
                    </button>
                  </div>

                  <div className="px-3 py-2 text-[10px] font-black text-muted-foreground/80 uppercase tracking-wider border-b border-t border-border/80">
                    {t('pageLabel')}
                  </div>
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => { handleReload(false); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} w-full py-2.5 border-border/40 hover:border-gray-400 flex items-center gap-2 px-3`}
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="text-sm">{t('reload')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { handleReload(true); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} w-full py-2.5 border-border/40 hover:border-gray-400 flex items-center gap-2 px-3`}
                    >
                      <Zap className="w-4 h-4" />
                      <span className="text-sm">{t('forceReload')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { handleOpenDevTools(); setMenuOpen(false); }}
                      className={`${modalIconButtonBase} w-full py-2.5 border-border/40 hover:border-gray-400 flex items-center gap-2 px-3`}
                    >
                      <Terminal className="w-4 h-4" />
                      <span className="text-sm">Developer Tools</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Contenido de la pestaña de Modelos */}
        {activeTab === 'models' && (
          <>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm flex justify-between items-center">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className={`${modalIconButtonBase} border-destructive/40 p-1.5 hover:border-red-400`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-border/80 bg-background/50 p-6 space-y-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-primary/10 rounded-lg">
                  {editingIndex !== null ? <Edit2 className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                </div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  {editingIndex !== null ? t('editModel') : t('registerNewModel')}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('provider')}</label>
                  <input
                    type="text"
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder={t('providerPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('descriptiveName')}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('namePlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('modelIdAPI')}</label>
                  <input
                    type="text"
                    value={form.model_name}
                    onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                    placeholder={t('modelIdPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('urlEndpoint')}</label>
                  <input
                    type="url"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder={t('urlPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('apiKey')}</label>
                  <input
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    placeholder={t('apiKeyPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('typeLabel')}</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary transition-all"
                  >
                    <option value="remote">{t('remote')}</option>
                    <option value="local">{t('local')}</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={`${modalButtonBase} flex-1 py-3 border-blue-500/50 hover:border-blue-400`}
                >
                  {saving ? t('processing') : editingIndex !== null ? t('saveChanges') : t('addToDatabase')}
                </button>
                {editingIndex !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(null);
                      setForm({ ...DEFAULT_FORM });
                    }}
                    className={`${modalButtonBase} px-6 py-3 border-border/40 hover:border-gray-400`}
                  >
                    {t('cancel')}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-black text-muted-foreground/80 uppercase tracking-widest flex items-center gap-2">
                  <RefreshCw className={loading ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
                  {t('existingRecords')} ({configs.length})
                </h3>
              </div>
              
              {loading && configs.length === 0 ? (
                <div className="flex justify-center py-10">
                  <RefreshCw className="w-8 h-8 animate-spin text-gray-700" />
                </div>
              ) : configs.length === 0 ? (
                <div className="text-center py-10 border-2 border-dashed border-border/80 rounded-3xl">
                  <p className="text-muted-foreground/60 text-sm italic">{t('noModelsConfigured')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {configs.map((c, i) => (
                    <div
                      key={c.id ?? i}
                      className="group flex items-center justify-between p-4 rounded-2xl bg-background/80 border border-border/80 hover:border-border/50 transition-all"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black bg-primary/30 text-primary px-2 py-0.5 rounded border border-blue-800/50 uppercase">
                            {c.provider || 'AI'}
                          </span>
                          <p className="text-foreground font-bold truncate text-sm">
                            {c.name}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground/80 truncate font-mono">
                          {c.model_name} · <span className="opacity-50">{c.base_url || 'Default Endpoint'}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleEdit(i)}
                          className={`${modalIconButtonBase} p-2 border-blue-500/40 hover:border-blue-400`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(i)}
                          className={`${modalIconButtonBase} p-2 border-destructive/40 hover:border-red-400`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Contenido de la pestaña de Usuarios */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {registerSuccess && (
              <div className="rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 text-sm flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{t('registerSuccessMsg')}</span>
              </div>
            )}

            {userError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{userError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUserError(null)}
                  className={`${modalIconButtonBase} border-destructive/40 p-1.5 hover:border-red-400`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-border/80 bg-background/50 p-6 space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <User className="w-4 h-4 text-green-400" />
                </div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  {t('newUserRegister')}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1">{t('fullName')}</label>
                  <input
                    type="text"
                    value={userForm.name}
                    onChange={(e) => setUserForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('fullNamePlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
                
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1 flex items-center gap-2">
                    <Mail className="w-3 h-3" />
                    {t('emailLabel')}
                  </label>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder={t('emailPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1 flex items-center gap-2">
                    <Lock className="w-3 h-3" />
                    {t('passwordLabel')}
                  </label>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={t('passwordPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1 flex items-center gap-2">
                    <Lock className="w-3 h-3" />
                    {t('confirmPassword')}
                  </label>
                  <input
                    type="password"
                    value={userForm.passwordConfirm}
                    onChange={(e) => setUserForm((f) => ({ ...f, passwordConfirm: e.target.value }))}
                    placeholder={t('repeatPasswordPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs text-muted-foreground/80 space-y-1">
                  <p>{t('passwordMin8Chars')}</p>
                  <p>{t('emailMustBeValid')}</p>
                  <p>{t('allFieldsRequired')}</p>
                </div>
                
                <button
                  type="button"
                  onClick={handleUserRegister}
                  disabled={userSaving}
                  className={`${modalButtonBase} w-full py-3 border-green-500/50 hover:border-green-400`}
                >
                  {userSaving ? t('registering') : t('registerUser')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contenido de la pestaña de Login */}
        {activeTab === 'login' && (
          <div className="space-y-6">
            {loginSuccess && (
              <div className="rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 text-sm flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{t('loginSuccessMsg')}</span>
              </div>
            )}

            {userError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{userError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUserError(null)}
                  className={`${modalIconButtonBase} border-destructive/40 p-1.5 hover:border-red-400`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-border/80 bg-background/50 p-6 space-y-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Lock className="w-4 h-4 text-green-400" />
                </div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  {t('userLogin')}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1 flex items-center gap-2">
                    <Mail className="w-3 h-3" />
                    {t('emailLabel')}
                  </label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder={t('emailPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-muted-foreground/80 uppercase px-1 flex items-center gap-2">
                    <Lock className="w-3 h-3" />
                    {t('passwordLabel')}
                  </label>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={t('yourPasswordPlaceholder')}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-green-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-foreground/70 cursor-pointer hover:text-foreground/80">
                  <input
                    type="checkbox"
                    checked={loginForm.remember}
                    onChange={(e) => setLoginForm((f) => ({ ...f, remember: e.target.checked }))}
                    className="w-4 h-4 text-accent bg-card border-border/40 rounded focus:ring-2 focus:ring-purple-500"
                  />
                  <span>{t('rememberMe')}</span>
                </label>
                
                <div className="text-xs text-muted-foreground/80 space-y-1">
                  <p>{t('loginWithCredentials')}</p>
                  <p>{t('noAccountRegister')}</p>
                </div>
                
                <button
                  type="button"
                  onClick={handleUserLogin}
                  disabled={userSaving}
                  className={`${modalButtonBase} w-full py-3 border-green-500/50 hover:border-green-400`}
                >
                  {userSaving ? t('loggingIn') : t('userLogin')}
                </button>
                
                {/* Botón de cerrar sesión */}
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`${modalButtonBase} w-full py-3 border-destructive/50 hover:border-red-400 flex items-center justify-center gap-2`}
                >
                  <X className="w-4 h-4" />
                  {t('logout')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}