'use client';

import React from 'react';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useTranslation } from '../../contexts/translation-context';

interface ComponentTypeSelectorProps {
  selectedComponentType: 'background' | 'text' | 'image' | 'layout' | 'button' | 'all';
  onComponentTypeChange: (type: 'background' | 'text' | 'image' | 'layout' | 'button' | 'all') => void;
}

export function ComponentTypeSelector({
  selectedComponentType,
  onComponentTypeChange
}: ComponentTypeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="px-4 py-3 bg-card/50 border-b border-border/50">
      <div className="flex items-center space-x-3">
        <div className="flex flex-col">
          <Label className="text-sm font-medium text-foreground whitespace-nowrap">
            {t('selectedComponentLabel')}
          </Label>
          <span className="text-xs text-muted-foreground mt-1">
            {t('selectComponentTypeDescription')}
          </span>
        </div>
        <Select
          value={selectedComponentType}
          onValueChange={(value: any) => {
            if (onComponentTypeChange) {
              onComponentTypeChange(value);
            }
          }}
        >
          <SelectTrigger className="w-[180px] border-border/40 bg-card text-foreground hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border/50">
            <SelectItem value="all" className="text-foreground hover:bg-muted">
              {t('allTypes')}
            </SelectItem>
            <SelectItem value="background" className="text-foreground hover:bg-muted">
              {t('background')}
            </SelectItem>
            <SelectItem value="text" className="text-foreground hover:bg-muted">
              {t('text')}
            </SelectItem>
            <SelectItem value="image" className="text-foreground hover:bg-muted">
              {t('image')}
            </SelectItem>
            <SelectItem value="layout" className="text-foreground hover:bg-muted">
              {t('container')}
            </SelectItem>
            <SelectItem value="button" className="text-foreground hover:bg-muted">
              {t('buttons')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
