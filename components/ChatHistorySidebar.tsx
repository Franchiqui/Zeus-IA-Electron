'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { History, X, MessageSquarePlus, Trash2, Edit, CheckCircle, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatContext } from '@/components/ChatContext';
import pb from '@/lib/pocketbase';
import { useTranslation } from '@/contexts/translation-context';

export function ChatHistorySidebar() {
  const { t } = useTranslation();
  const { conversationId, loadConversation, triggerRefreshConversations, refreshConversations, startNewChat } = useChatContext();
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState(t('newConversationHistory'));

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      console.log('🔄 Obteniendo conversaciones...');
      
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
              console.log('✅ Token de autenticación encontrado');
            }
          } catch (e) {
            console.warn('⚠️ Error al leer token de localStorage:', e);
          }
        }
      }
      
      const res = await fetch('/api/chat', { headers });
      if (!res.ok) return;
      const data = await res.json();
      const items = (data.conversations || []).map((c: any) => ({
        ...c,
        lastMessage: c.messages?.[c.messages.length - 1] || null
      }));
      setConversations(items);
    } catch (error) {
      console.error('❌ Error al obtener conversaciones:', error);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (refreshConversations) {
      loadConversations();
    }
  }, [refreshConversations, loadConversations]);

  // Escuchar evento personalizado para abrir el sidebar desde el chat
  useEffect(() => {
    const handleToggle = () => setIsOpen(prev => !prev);
    window.addEventListener('toggleChatHistory', handleToggle);
    return () => window.removeEventListener('toggleChatHistory', handleToggle);
  }, []);

  // Cerrar panel con la tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Abrir formulario de nueva conversación cuando se abra el panel
  useEffect(() => {
    if (isOpen) {
      setIsCreatingNew(true);
      setNewConvTitle(t('newConversationHistory'));
    }
  }, [isOpen]);

  const handleSelectConversation = async (id: string) => {
    console.log('🔄 Cargando conversación:', id);
    try {
      await loadConversation(id);
      console.log('✅ Conversación cargada exitosamente');
    } catch (error) {
      console.error('❌ Error al cargar conversación:', error);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t('deleteConversationConfirm'))) return;

    try {
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
            }
          } catch (e) {}
        }
      }
      
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, { 
        method: 'DELETE',
        headers 
      });
      if (!res.ok) return;
      
      if (conversationId === id) {
        startNewChat();
      }
      triggerRefreshConversations();
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      console.error('❌ Error al eliminar conversación:', error);
    }
  };

  const handleStartEditing = (conv: any) => {
    setEditingConvId(conv.id);
    setEditingTitle(conv.title || '');
  };

  const handleSaveTitle = async () => {
    if (!editingConvId) return;
    const newTitle = editingTitle.trim() || t('untitled');
    
    try {
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
            }
          } catch (e) {}
        }
      }
      
      const res = await fetch('/api/chat', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ conversationId: editingConvId, title: newTitle }),
      });
      if (!res.ok) return;
      
      setConversations((prev) =>
        prev.map((c) => (c.id === editingConvId ? { ...c, title: newTitle } : c))
      );
      triggerRefreshConversations();
    } catch (error) {
      console.error('❌ Error al guardar título:', error);
    } finally {
      setEditingConvId(null);
      setEditingTitle('');
    }
  };

  const handleCancelEditing = () => {
    setEditingConvId(null);
    setEditingTitle('');
  };

  const handleStartCreatingNew = () => {
    setIsCreatingNew(true);
    setNewConvTitle('');
  };

  const handleCreateNew = () => {
    if (!newConvTitle.trim()) return;
    setIsCreatingNew(false);
    setNewConvTitle('');
    startNewChat();
  };

  const handleCancelCreatingNew = () => {
    setIsCreatingNew(false);
    setNewConvTitle('');
  };

  const formatDate = (created?: string) => {
    if (!created) return '';
    const d = new Date(created);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-background/50 z-[49]"
              onClick={() => setIsOpen(false)}
            />
            {/* Sidebar */}
            <motion.div
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="fixed left-0 top-0 bottom-0 w-96 bg-background border-r border-border/80 shadow-2xl z-[50] flex flex-col"
            >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/80 bg-background/50">
              <div className="flex items-center gap-3">
                <History className="w-4 h-4 text-green-400" />
                <h3 className="text-sm font-semibold text-foreground">{t('chatHistory')}</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={t('closePanel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {/* New Conversation Form */}
              <AnimatePresence>
                {isCreatingNew && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 p-3 bg-green-900/20 border border-green-700/50 rounded-lg"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquarePlus className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium text-green-300">{t('newConversationHistory')}</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newConvTitle}
                        onChange={(e) => setNewConvTitle(e.target.value)}
                        placeholder={t('newConversationPlaceholder')}
                        className="flex-1 bg-card border border-border/50 rounded px-3 py-1.5 text-sm text-foreground outline-none focus:border-green-500"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateNew();
                          if (e.key === 'Escape') handleCancelCreatingNew();
                        }}
                      />
                      <button
                        onClick={handleCreateNew}
                        disabled={!newConvTitle.trim()}
                        className="p-2 bg-green-600 hover:bg-green-700 disabled:bg-muted disabled:opacity-50 rounded-lg text-foreground"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleCancelCreatingNew}
                        className="p-2 bg-muted hover:bg-muted/80 rounded-lg text-foreground"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold text-muted-foreground/80 uppercase tracking-widest">{t('conversations')}</h4>
                <button
                  onClick={handleStartCreatingNew}
                  className="p-1.5 rounded-lg bg-green-600/10 hover:bg-green-600/20 text-green-400 transition-colors"
                  title={t('newConversationTooltip')}
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Conversations List */}
              {loadingConversations ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-2 text-muted-foreground/80">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">{t('loadingChat')}</span>
                  </div>
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8">
                  <History className="w-12 h-12 text-muted-foreground/60 mx-auto mb-4 opacity-50" />
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('noConversations')}</h3>
                </div>
              ) : (
                conversations.map((conv: any) => {
                  const formattedTime = formatDate(conv.updatedAt || conv.created);
                  const preview = conv.lastMessage?.content
                    ? conv.lastMessage.content.substring(0, 50) + (conv.lastMessage.content.length > 50 ? '...' : '')
                    : t('noMessages');

                  return (
                    <motion.div
                      key={conv.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      onClick={() => {
                        handleSelectConversation(conv.id);
                        setIsOpen(false);
                      }}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        conv.id === conversationId
                          ? 'bg-green-900/20 border-green-700/50'
                          : 'bg-card/50 border-border/50 hover:bg-card'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          {editingConvId === conv.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="flex-1 bg-card border border-border/40 rounded px-2 py-1 text-sm text-foreground outline-none focus:border-green-500"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveTitle();
                                  if (e.key === 'Escape') handleCancelEditing();
                                }}
                              />
                              <button onClick={handleSaveTitle} className="text-green-400 p-1">
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <h4 className="text-sm font-medium text-foreground truncate">{conv.title || t('untitled')}</h4>
                          )}
                          <p className="text-xs text-muted-foreground/80 mt-1">{formattedTime}</p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleStartEditing(conv)}
                            className="p-1 text-muted-foreground hover:text-amber-400"
                            title={t('edit')}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteConversation(e, conv.id)}
                            className="p-1 text-muted-foreground hover:text-destructive"
                            title={t('delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{preview}</p>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
