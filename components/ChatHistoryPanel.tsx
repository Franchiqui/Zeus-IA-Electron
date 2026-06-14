'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { History, ChevronUp, Plus, Trash2, GripHorizontal, Pencil, Check } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useChatContext } from '@/components/ChatContext';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/translation-context';

type ConversationItem = { id: string; title?: string; created?: string };

const HISTORY_POSITION_KEY = 'zeus_chat_history_positions_v5';
const DEFAULT_LEFT = 24;
const DEFAULT_BOTTOM = 100;
const MAX_VISIBLE_ROWS = 5;
const ROW_HEIGHT_REM = 2.75;

type PagePositions = Record<string, { left: number; bottom: number }>;

function loadAllPositions(): PagePositions {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HISTORY_POSITION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function ChatHistoryPanel() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: DEFAULT_LEFT, bottom: DEFAULT_BOTTOM });
  const dragControls = useDragControls();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const { conversationId, startNewChat, loadConversation, refreshConversations, triggerRefreshConversations } = useChatContext();

  // Cargar posición específica de esta página
  useEffect(() => {
    const allPos = loadAllPositions();
    const pagePos = (pathname && allPos[pathname]) || { left: DEFAULT_LEFT, bottom: DEFAULT_BOTTOM };
    setPosition(pagePos);
  }, [pathname]);

  const saveCurrentPosition = (newPos: { left: number; bottom: number }) => {
    setPosition(newPos);
    if (!pathname) return;
    try {
      const allPos = loadAllPositions();
      allPos[pathname] = newPos;
      localStorage.setItem(HISTORY_POSITION_KEY, JSON.stringify(allPos));
    } catch (e) {
      console.error("Error saving chat position", e);
    }
  };

  const fetchConversations = async () => {
    setLoading(true);
    try {
      console.log('🔄 Obteniendo conversaciones...');
      
      // Obtener token de PocketBase para autenticación
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Intentar obtener el token del localStorage (donde PocketBase lo guarda)
      if (typeof window !== 'undefined') {
        const pbAuth = localStorage.getItem('pb_auth');
        if (pbAuth) {
          try {
            const authData = JSON.parse(pbAuth);
            if (authData.token) {
              headers['Authorization'] = `Bearer ${authData.token}`;
              console.log('✅ Token de autenticación encontrado');
            }
          } catch (e) {
            console.warn('⚠️ Error al leer token de localStorage:', e);
          }
        }
      }
      
      const res = await fetch('/api/chat', { headers });
      console.log('📡 Response status:', res.status);
      if (!res.ok) {
        console.error('❌ Error en respuesta:', res.statusText);
        return;
      }
      const data = await res.json();
      console.log('📋 Datos recibidos:', data);
      const items: ConversationItem[] = (data.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.title || `Conversación ${c.id.slice(0, 8)}`,
        created: c.created,
      }));
      console.log('✅ Conversaciones procesadas:', items);
      setConversations(items);
    } catch (error) {
      console.error('❌ Error al obtener conversaciones:', error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [refreshConversations]);

  const handleNewChat = () => {
    startNewChat();
    setExpanded(false);
  };

  const handleSelect = async (id: string) => {
    console.log('🔄 Cargando conversación:', id);
    try {
      await loadConversation(id);
      console.log('✅ Conversación cargada exitosamente');
      setExpanded(false);
    } catch (error) {
      console.error('❌ Error al cargar conversación:', error);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    console.log('🗑️ Eliminando conversación:', id);
    if (!confirm(t('deleteConversationConfirm'))) return;
    setDeletingId(id);
    try {
      // Obtener token de PocketBase para autenticación
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (typeof window !== 'undefined') {
        const pbAuth = localStorage.getItem('pb_auth');
        if (pbAuth) {
          try {
            const authData = JSON.parse(pbAuth);
            if (authData.token) {
              headers['Authorization'] = `Bearer ${authData.token}`;
              console.log('✅ Token de autenticación encontrado para eliminar');
            }
          } catch (e) {
            console.warn('⚠️ Error al leer token de localStorage:', e);
          }
        }
      }
      
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { 
        method: 'DELETE',
        headers 
      });
      console.log('📡 Response status DELETE:', res.status);
      if (!res.ok) {
        console.error('❌ Error al eliminar:', res.statusText);
        return;
      }
      const result = await res.json();
      console.log('✅ Resultado eliminación:', result);
      
      if (conversationId === id) {
        console.log('🔄 La conversación eliminada era la actual, iniciando nuevo chat');
        startNewChat();
      }
      triggerRefreshConversations();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      console.log('✅ Conversación eliminada de la lista');
    } catch (error) {
      console.error('❌ Error al eliminar conversación:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, c: ConversationItem) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditingTitle(c.title || '');
  };

  const handleSaveEdit = async () => {
    if (editingId == null) return;
    const newTitle = editingTitle.trim() || t('untitled');
    console.log('💾 Guardando título:', { conversationId: editingId, title: newTitle });
    try {
      // Obtener token de PocketBase para autenticación
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (typeof window !== 'undefined') {
        const pbAuth = localStorage.getItem('pb_auth');
        if (pbAuth) {
          try {
            const authData = JSON.parse(pbAuth);
            if (authData.token) {
              headers['Authorization'] = `Bearer ${authData.token}`;
              console.log('✅ Token de autenticación encontrado para guardar título');
            }
          } catch (e) {
            console.warn('⚠️ Error al leer token de localStorage:', e);
          }
        }
      }
      
      const res = await fetch('/api/chat', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ conversationId: editingId, title: newTitle }),
      });
      console.log('📡 Response status PATCH:', res.status);
      if (!res.ok) {
        console.error('❌ Error al guardar título:', res.statusText);
        return;
      }
      const result = await res.json();
      console.log('✅ Resultado guardado:', result);
      
      setConversations((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, title: newTitle } : c))
      );
      triggerRefreshConversations();
      console.log('✅ Título actualizado localmente');
    } catch (error) {
      console.error('❌ Error al guardar título:', error);
    } finally {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  const formatDate = (created?: string) => {
    if (!created) return '';
    const d = new Date(created);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };

  const isHiddenPage = pathname === '/auth' || pathname === '/terms' || pathname === '/privacy';
  if (isHiddenPage) return null;

  return (
    <div className="fixed left-0 top-0 h-full w-64 bg-background border-r border-border/50 z-[100] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card">
        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-green-400" />
          {t('chatHistory')}
        </span>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-foreground text-xs font-bold transition-colors shadow-lg"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('newChat')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="text-muted-foreground/80 text-sm py-4 text-center">{t('loadingChat')}</p>
        ) : conversations.length === 0 ? (
          <p className="text-muted-foreground/80 text-sm py-4 text-center">{t('noConversations')}</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                {editingId === c.id ? (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border/40"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-sm bg-background border border-border/40 rounded text-foreground outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <button onClick={handleSaveEdit} className="text-green-400 p-1"><Check className="w-4 h-4"/></button>
                  </div>
                ) : (
                  <div
                    role="button"
                    onClick={() => handleSelect(c.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                      conversationId === c.id ? 'bg-green-600/30 text-green-200' : 'hover:bg-muted text-foreground/80'
                    }`}
                  >
                    <span className="truncate flex-1 min-w-0">{c.title}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleStartEdit(e, c)}
                        className="p-1 text-foreground/80 hover:text-amber-400"
                        title={t('editName')}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, c.id)}
                        className="p-1 text-foreground/80 hover:text-destructive"
                        title={t('deleteConversationTooltip')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}