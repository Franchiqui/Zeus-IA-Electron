'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';

interface TextEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedText: string;
  onSave: (newText: string) => void;
}

export function TextEditor({ open, onOpenChange, selectedText, onSave }: TextEditorProps) {
  const [text, setText] = useState(selectedText);

  const handleSave = () => {
    onSave(text);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setText(selectedText); // Reset to original text
    onOpenChange(false);
  };

  // Reset text when selectedText changes or dialog opens
  React.useEffect(() => {
    if (open) {
      setText(selectedText);
    }
  }, [selectedText, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Text Content</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="text-content">Text Content</Label>
            <Textarea
              id="text-content"
              value={text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder="Enter your text here..."
              className="min-h-[100px]"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
