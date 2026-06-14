'use client';

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, ExclamationCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
  ariaLabel?: string;
  preventScroll?: boolean;
}

const Modal = React.memo(function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnOverlayClick = true,
  showCloseButton = true,
  initialFocusRef,
  className,
  ariaLabel,
  preventScroll = true,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
    if (event.key === 'Tab' && modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    }
  }, [onClose]);

  const handleOverlayClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && event.target === overlayRef.current) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  useEffect(() => {
    if (isOpen && preventScroll) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, preventScroll]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    if (isOpen && initialFocusRef?.current) {
      setTimeout(() => initialFocusRef.current?.focus(), 100);
    } else if (isOpen && modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      if (firstElement) {
        setTimeout(() => firstElement.focus(), 100);
      }
    }
  }, [isOpen, initialFocusRef]);

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] max-h-[95vh]',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            ref={overlayRef}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/50 backdrop-blur-sm"
            onClick={handleOverlayClick}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
          />
          
          <div className="fixed inset-0 z-[100] overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                ref={modalRef}
                className={cn(
                  'relative w-full bg-card rounded-lg shadow-xl border border-border/50',
                  sizeClasses[size],
                  className
                )}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel || title}
                aria-describedby={description ? 'modal-description' : undefined}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
              >
                {(title || showCloseButton) && (
                  <div className="flex items-center justify-between p-6 border-b border-border/50">
                    {title && (
                      <div>
                        <h2 className="text-xl font-semibold text-foreground">
                          {title}
                        </h2>
                        {description && (
                          <p
                            id="modal-description"
                            className="mt-1 text-sm text-muted-foreground"
                          >
                            {description}
                          </p>
                        )}
                      </div>
                    )}
                    {showCloseButton && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors"
                        aria-label="Close modal"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}

                <div className={cn(
                  'p-6',
                  !title && !showCloseButton && 'pt-6'
                )}>
                  {children}
                </div>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
});

Modal.displayName = 'Modal';

export interface ModalHeaderProps {
  children: React.ReactNode;
  className?: string;
}

const ModalHeader = React.memo(function ModalHeader({ 
  children, 
  className 
}: ModalHeaderProps) {
  return (
    <div className={cn('mb-4', className)}>
      {children}
    </div>
  );
});

ModalHeader.displayName = 'ModalHeader';

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

const ModalFooter = React.memo(function ModalFooter({ 
  children, 
  className 
}: ModalFooterProps) {
  return (
    <div className={cn(
      'flex items-center justify-end gap-3 mt-6 pt-6 border-t border-border/50',
      className
    )}>
      {children}
    </div>
  );
});

ModalFooter.displayName = 'ModalFooter';

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

const ModalBody = React.memo(function ModalBody({ 
  children, 
  className 
}: ModalBodyProps) {
  return (
    <div className={cn('text-foreground/80', className)}>
      {children}
    </div>
  );
});

ModalBody.displayName = 'ModalBody';

export interface AlertModalProps extends Omit<ModalProps, 'children'> {
  variant?: 'success' | 'error' | 'warning' | 'info';
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AlertModal = React.memo(function AlertModal({
  variant = 'info',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  onClose,
  ...modalProps
}: AlertModalProps) {
  const variantConfig = {
    success: {
      icon: CheckCircleIcon,
      iconColor: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    error: {
      icon: ExclamationCircleIcon,
      iconColor: 'text-destructive',
      bgColor: 'bg-destructive/10',
    },
    warning: {
      icon: ExclamationCircleIcon,
      iconColor: 'text-warning',
      bgColor: 'bg-warning/10',
    },
    info: {
      icon: ExclamationCircleIcon,
      iconColor: 'text-primary',
      bgColor: 'bg-primary/10',
    },
  };

  const config = variantConfig[variant];
  const Icon = config.icon;

  const handleConfirm = () => {
    onConfirm?.();
    onClose();
  };

  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  return (
    <Modal {...modalProps} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center">
        <div className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center mb-4',
          config.bgColor
        )}>
          <Icon className={cn('w-6 h-6', config.iconColor)} />
        </div>
        
        <p className="text-foreground/80 mb-6">{message}</p>

        <div className="flex gap-3 w-full">
          {onCancel && (
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-2 text-sm font-medium text-foreground/80 bg-muted hover:bg-muted/80 rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium text-foreground rounded-md focus:outline-none focus:ring-2 focus:ring-primary transition-colors',
              variant === 'success' && 'bg-green-600 hover:bg-green-700',
              variant === 'error' && 'bg-destructive hover:bg-red-700',
              variant === 'warning' && 'bg-warning hover:bg-yellow-700',
              variant === 'info' && 'bg-primary hover:bg-primary/80'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
});

AlertModal.displayName = 'AlertModal';

export { Modal, ModalHeader, ModalFooter, ModalBody, AlertModal };