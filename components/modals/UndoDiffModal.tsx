'use client';

import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Undo2, FileText } from 'lucide-react';
import { useTranslation } from '@/contexts/translation-context';

interface UndoDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  fileName: string;
  currentContent: string;
  backupContent: string;
}

type Op = '=' | '+' | '-';
interface DiffLine {
  op: Op;
  /** línea izquierda (vacía si es un '+' puro) */
  left: string | null;
  /** línea derecha (vacía si es un '-' puro) */
  right: string | null;
  /** número de línea izquierdo (1-indexed) */
  leftLine: number | null;
  /** número de línea derecho (1-indexed) */
  rightLine: number | null;
}

/**
 * Diff muy sencillo basado en LCS (Longest Common Subsequence) por líneas.
 * Suficiente para archivos pequeños/medios; para archivos enormes podría
 * bloquear el navegador, por eso limitamos a 5000 líneas por lado.
 */
function computeLineDiff(leftText: string, rightText: string): DiffLine[] {
  const MAX = 5000;
  const leftLines = leftText.split('\n').slice(0, MAX);
  const rightLines = rightText.split('\n').slice(0, MAX);

  const m = leftLines.length;
  const n = rightLines.length;

  // Tabla LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  let leftLineNo = 1;
  let rightLineNo = 1;
  while (i < m && j < n) {
    if (leftLines[i] === rightLines[j]) {
      out.push({ op: '=', left: leftLines[i], right: rightLines[j], leftLine: leftLineNo, rightLine: rightLineNo });
      i++; j++; leftLineNo++; rightLineNo++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: '-', left: leftLines[i], right: null, leftLine: leftLineNo, rightLine: null });
      i++; leftLineNo++;
    } else {
      out.push({ op: '+', left: null, right: rightLines[j], leftLine: null, rightLine: rightLineNo });
      j++; rightLineNo++;
    }
  }
  while (i < m) {
    out.push({ op: '-', left: leftLines[i], right: null, leftLine: leftLineNo, rightLine: null });
    i++; leftLineNo++;
  }
  while (j < n) {
    out.push({ op: '+', left: null, right: rightLines[j], leftLine: null, rightLine: rightLineNo });
    j++; rightLineNo++;
  }
  return out;
}

export default function UndoDiffModal({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  currentContent,
  backupContent,
}: UndoDiffModalProps) {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => { setMounted(true); }, []);

  const diff = useMemo(() => {
    if (!isOpen) return [] as DiffLine[];
    return computeLineDiff(currentContent, backupContent);
  }, [isOpen, currentContent, backupContent]);

  const stats = useMemo(() => {
    let added = 0, removed = 0, same = 0;
    for (const d of diff) {
      if (d.op === '+') added++;
      else if (d.op === '-') removed++;
      else same++;
    }
    return { added, removed, same };
  }, [diff]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const handleConfirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
    }
  };

  const lineBg = (op: Op) => {
    if (op === '+') return 'bg-emerald-950/40';
    if (op === '-') return 'bg-red-950/40';
    return '';
  };
  const lineSign = (op: Op) => {
    if (op === '+') return <span className="text-success select-none">+</span>;
    if (op === '-') return <span className="text-destructive select-none">−</span>;
    return <span className="text-muted-foreground/60 select-none"> </span>;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-[1500px] max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Undo2 className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground truncate">{t('undoDiffTitle')}</h3>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                <FileText className="w-3 h-3" />
                <span className="truncate font-mono">{fileName}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-card rounded-md transition-colors"
            title={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtítulo + estadísticas */}
        <div className="px-5 py-2.5 border-b border-border/80 bg-background/60 flex items-center justify-between gap-4 text-xs">
          <p className="text-muted-foreground">{t('undoDiffDescription')}</p>
          <div className="flex items-center gap-3 shrink-0 text-[11px] font-mono">
            <span className="text-success">+{stats.added} {t('undoAddedLines')}</span>
            <span className="text-destructive">−{stats.removed} {t('undoRemovedLines')}</span>
            <span className="text-muted-foreground/80">={stats.same}</span>
          </div>
        </div>

        {/* Cuerpo: dos paneles side-by-side */}
        <div className="flex-1 grid grid-cols-2 gap-px bg-card overflow-hidden min-h-0">
          {/* Panel izquierdo: actual */}
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-background border-b border-border/80">
              {t('undoLeftLabel')}
            </div>
            <div className="flex-1 overflow-auto font-mono text-xs">
              {diff.map((d, idx) => (
                <div
                  key={`L-${idx}`}
                  className={`flex items-start gap-2 px-3 py-0.5 ${lineBg(d.op)}`}
                >
                  <span className="text-muted-foreground/60 w-8 text-right shrink-0 select-none">{d.leftLine ?? ''}</span>
                  <span className="w-3 shrink-0 text-center">{lineSign(d.op)}</span>
                  <pre className="whitespace-pre-wrap break-all text-foreground/70 flex-1 min-w-0">
                    {d.left ?? ''}
                  </pre>
                </div>
              ))}
              {diff.length === 0 && (
                <div className="p-4 text-muted-foreground/80 text-center">—</div>
              )}
            </div>
          </div>

          {/* Panel derecho: backup */}
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400 bg-background border-b border-border/80">
              {t('undoRightLabel')}
            </div>
            <div className="flex-1 overflow-auto font-mono text-xs">
              {diff.map((d, idx) => (
                <div
                  key={`R-${idx}`}
                  className={`flex items-start gap-2 px-3 py-0.5 ${lineBg(d.op)}`}
                >
                  <span className="text-muted-foreground/60 w-8 text-right shrink-0 select-none">{d.rightLine ?? ''}</span>
                  <span className="w-3 shrink-0 text-center">{lineSign(d.op)}</span>
                  <pre className="whitespace-pre-wrap break-all text-foreground/70 flex-1 min-w-0">
                    {d.right ?? ''}
                  </pre>
                </div>
              ))}
              {diff.length === 0 && (
                <div className="p-4 text-muted-foreground/80 text-center">—</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer con acciones */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/80 bg-background/60">
          <button
            onClick={onClose}
            disabled={isConfirming}
            className="px-3 py-1.5 text-xs font-medium text-foreground/70 hover:text-foreground hover:bg-card rounded-md transition-colors disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-900 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 rounded-md transition-colors shadow-[0_0_15px_rgba(245,158,11,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {isConfirming ? t('loading') : t('undoRestore')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
