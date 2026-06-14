'use client';
import { useTheme } from 'next-themes';
import { toast, Toaster } from 'sonner';
import React from 'react';

type ToasterProps = {
    theme?: 'light' | 'dark' | 'system';
    className?: string;
    toastOptions?: {
        classNames?: {
            toast?: string;
            description?: string;
            actionButton?: string;
            cancelButton?: string;
        };
    };
    [key: string]: any;
};

const CustomToaster = ({ ...props }: ToasterProps): React.ReactElement => {
    const { theme = 'system' } = useTheme();

    return (
        <Toaster
            theme={theme as any}
            className="toaster group"
            toastOptions={{
                classNames: {
                    toast:
                        'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
                    description: 'group-[.toast]:text-muted-foreground',
                    actionButton:
                        'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
                    cancelButton:
                        'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
                },
            }}
            {...props}
        />
    );
};

export { CustomToaster as Toaster };
