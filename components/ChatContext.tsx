'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  type?: string;
  language?: string;
  fileInfo?: Record<string, unknown> | null;
  action_type?: string;
};

const STORAGE_KEY = 'zeus_chat_persisted';

function loadPersisted(): { conversationId: string | null; messages: ChatMessage[] } {
  if (typeof window === 'undefined') return { conversationId: null, messages: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversationId: null, messages: [] };
    const data = JSON.parse(raw);
    const id = typeof data?.conversationId === 'string' ? data.conversationId : null;
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    if (!msgs.every((m: unknown) => m && typeof m === 'object' && 'role' in m && 'content' in m)) {
      return { conversationId: id, messages: [] };
    }
    return { conversationId: id, messages: msgs as ChatMessage[] };
  } catch {
    return { conversationId: null, messages: [] };
  }
}

function savePersisted(conversationId: string | null, messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  if (conversationId === null && messages.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId, messages }));
  } catch {
    // ignore quota or parse errors
  }
}

type ChatContextValue = {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  messages: ChatMessage[];
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  startNewChat: () => void;
  loadConversation: (id: string) => Promise<void>;
  refreshConversations: number;
  triggerRefreshConversations: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversationId, setConversationId] = useState<string | null>(() => loadPersisted().conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted().messages);
  const [refreshConversations, setRefreshConversations] = useState(0);
  const hydratedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    savePersisted(conversationId, messages);
  }, [conversationId, messages]);

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);
  const loadConversation = useCallback(async (id: string) => {
    console.log('🔄 ChatContext: Cargando conversación:', id);
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
              console.log('✅ ChatContext: Token de autenticación encontrado');
            }
          } catch (e) {
            console.warn('⚠️ ChatContext: Error al leer token de localStorage:', e);
          }
        }
      }

      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { headers });
      console.log('📡 ChatContext: Response status:', res.status);
      if (!res.ok) {
        console.error('❌ ChatContext: Error en respuesta:', res.statusText);
        return;
      }
      const data = await res.json();
      console.log('📋 ChatContext: Datos recibidos:', data);
      const msgs: ChatMessage[] = (data.messages || []).map((m: {
        id?: string;
        role: string;
        text: string;
        created?: string;
        type?: string;
        language?: string;
        fileInfo?: Record<string, unknown> | null;
        action_type?: string;
      }) => ({
        id: m.id || `${Date.now()}.${Math.random().toString(36).slice(2)}`,
        role: m.role as 'user' | 'assistant',
        content: m.text ?? '',
        createdAt: m.created,
        type: m.type,
        language: m.language,
        fileInfo: m.fileInfo ?? null,
        action_type: m.action_type,
      }));
      console.log('💬 ChatContext: Mensajes procesados:', msgs);
      setConversationId(id);
      setMessages(msgs);
      console.log('✅ ChatContext: Conversación cargada exitosamente');
    } catch (error) {
      console.error('❌ ChatContext: Error al cargar conversación:', error);
      setConversationId(id);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!conversationId) return;
    if (hydratedConversationIdRef.current === conversationId) return;

    const pbAuth = localStorage.getItem('pb_auth');
    if (!pbAuth) return;

    hydratedConversationIdRef.current = conversationId;
    loadConversation(conversationId).catch((error) => {
      console.error('❌ ChatContext: Error hidratando conversación persistida:', error);
    });
  }, [conversationId, loadConversation]);

  const triggerRefreshConversations = useCallback(() => {
    setRefreshConversations((n) => n + 1);
  }, []);

  const value: ChatContextValue = {
    conversationId,
    setConversationId,
    messages,
    setMessages,
    startNewChat,
    loadConversation,
    refreshConversations,
    triggerRefreshConversations,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}
