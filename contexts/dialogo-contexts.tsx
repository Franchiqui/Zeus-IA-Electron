'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Link, List, Type } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';

interface TextEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedText: string;
    onSave: (text: string) => void;
}

export function TextEditor({ open, onOpenChange, selectedText, onSave }: TextEditorProps) {
    const [text, setText] = useState(selectedText);
    const [formatting, setFormatting] = useState({
        bold: false,
        italic: false,
        underline: false,
        alignment: 'left' as 'left' | 'center' | 'right',
    });

    const handleSave = () => {
        onSave(text);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Edit Text Content</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {/* Formatting Toolbar */ }
                    <div className="flex items-center justify-between p-2 border rounded-lg bg-muted/50">
                        <div className="flex items-center space-x-1">
                            <ToggleGroup type="multiple" value={[
                                ...(formatting.bold ? ['bold'] : []),
                                ...(formatting.italic ? ['italic'] : []),
                                ...(formatting.underline ? ['underline'] : []),
                            ]} onValueChange={(value) => {
                                setFormatting(prev => ({
                                    ...prev,
                                    bold: value.includes('bold'),
                                    italic: value.includes('italic'),
                                    underline: value.includes('underline'),
                                }));
                            }}>
                                <ToggleGroupItem value="bold" aria-label="Bold">
                                    <Bold className="h-4 w-4" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="italic" aria-label="Italic">
                                    <Italic className="h-4 w-4" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="underline" aria-label="Underline">
                                    <Underline className="h-4 w-4" />
                                </ToggleGroupItem>
                            </ToggleGroup>
                        </div>

                        <div className="flex items-center space-x-1">
                            <ToggleGroup type="single" value={formatting.alignment} onValueChange={(value) => {
                                if (value) setFormatting(prev => ({ ...prev, alignment: value as 'left' | 'center' | 'right' }));
                            }}>
                                <ToggleGroupItem value="left" aria-label="Align left">
                                    <AlignLeft className="h-4 w-4" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="center" aria-label="Align center">
                                    <AlignCenter className="h-4 w-4" />
                                </ToggleGroupItem>
                                <ToggleGroupItem value="right" aria-label="Align right">
                                    <AlignRight className="h-4 w-4" />
                                </ToggleGroupItem>
                            </ToggleGroup>
                        </div>

                        <div className="flex items-center space-x-1">
                            <Button variant="ghost" size="sm">
                                <Link className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Text Editor */ }
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-sm font-medium">Content</label>
                            <span className="text-xs text-muted-foreground">
                                {text.length} characters
                            </span>
                        </div>
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Enter your text here..."
                            className="min-h-[200px] font-mono"
                        />
                    </div>

                    {/* Live Preview */ }
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Live Preview</label>
                        <div className="p-4 border rounded-lg bg-muted/30 min-h-[80px]">
                            <div
                                style={{
                                    fontWeight: formatting.bold ? 'bold' : 'normal',
                                    fontStyle: formatting.italic ? 'italic' : 'normal',
                                    textDecoration: formatting.underline ? 'underline' : 'none',
                                    textAlign: formatting.alignment,
                                }}
                            >
                                {text || 'Preview will appear here...'}
                            </div>
                        </div>
                    </div>

                    {/* Actions */ }
                    <div className="flex justify-end space-x-2 pt-4">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave}>
                            Save Changes
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}