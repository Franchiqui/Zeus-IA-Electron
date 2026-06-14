const fs = require('fs');
const path = require('path');

const replacements = [
  [/\bbg-gray-950\b/g, 'bg-background'],
  [/\bbg-gray-900\b/g, 'bg-background'],
  [/\bbg-gray-800\b/g, 'bg-card'],
  [/\bbg-gray-700\b/g, 'bg-muted'],
  [/\bbg-gray-600\b/g, 'bg-muted/80'],
  [/\bbg-gray-500\b/g, 'bg-muted/60'],
  [/\bbg-slate-950\b/g, 'bg-background'],
  [/\bbg-slate-900\b/g, 'bg-background'],
  [/\bbg-slate-800\b/g, 'bg-card'],
  [/\bbg-slate-700\b/g, 'bg-muted'],
  [/\bbg-slate-600\b/g, 'bg-muted/80'],
  [/\bbg-slate-500\b/g, 'bg-muted/60'],
  [/\bbg-zinc-950\b/g, 'bg-background'],
  [/\bbg-zinc-900\b/g, 'bg-background'],
  [/\bbg-zinc-800\b/g, 'bg-card'],
  [/\bbg-zinc-700\b/g, 'bg-muted'],
  [/\bbg-zinc-600\b/g, 'bg-muted/80'],
  [/\bbg-neutral-950\b/g, 'bg-background'],
  [/\bbg-neutral-900\b/g, 'bg-background'],
  [/\bbg-neutral-800\b/g, 'bg-card'],
  [/\bbg-neutral-700\b/g, 'bg-muted'],
  [/\bbg-neutral-600\b/g, 'bg-muted/80'],
  [/\bbg-black\b/g, 'bg-background'],
  [/\btext-white\b/g, 'text-foreground'],
  [/\btext-gray-100\b/g, 'text-foreground/90'],
  [/\btext-gray-200\b/g, 'text-foreground/80'],
  [/\btext-gray-300\b/g, 'text-foreground/70'],
  [/\btext-gray-400\b/g, 'text-muted-foreground'],
  [/\btext-gray-500\b/g, 'text-muted-foreground/80'],
  [/\btext-gray-600\b/g, 'text-muted-foreground/60'],
  [/\btext-slate-100\b/g, 'text-foreground/90'],
  [/\btext-slate-200\b/g, 'text-foreground/80'],
  [/\btext-slate-300\b/g, 'text-foreground/70'],
  [/\btext-slate-400\b/g, 'text-muted-foreground'],
  [/\btext-slate-500\b/g, 'text-muted-foreground/80'],
  [/\btext-slate-600\b/g, 'text-muted-foreground/60'],
  [/\btext-zinc-100\b/g, 'text-foreground/90'],
  [/\btext-zinc-200\b/g, 'text-foreground/80'],
  [/\btext-zinc-300\b/g, 'text-foreground/70'],
  [/\btext-zinc-400\b/g, 'text-muted-foreground'],
  [/\btext-zinc-500\b/g, 'text-muted-foreground/80'],
  [/\btext-zinc-600\b/g, 'text-muted-foreground/60'],
  [/\btext-neutral-100\b/g, 'text-foreground/90'],
  [/\btext-neutral-200\b/g, 'text-foreground/80'],
  [/\btext-neutral-300\b/g, 'text-foreground/70'],
  [/\btext-neutral-400\b/g, 'text-muted-foreground'],
  [/\btext-neutral-500\b/g, 'text-muted-foreground/80'],
  [/\btext-neutral-600\b/g, 'text-muted-foreground/60'],
  [/\bborder-gray-900\b/g, 'border-border/90'],
  [/\bborder-gray-800\b/g, 'border-border/80'],
  [/\bborder-gray-700\b/g, 'border-border/50'],
  [/\bborder-gray-600\b/g, 'border-border/40'],
  [/\bborder-gray-500\b/g, 'border-border/30'],
  [/\bborder-slate-900\b/g, 'border-border/90'],
  [/\bborder-slate-800\b/g, 'border-border/80'],
  [/\bborder-slate-700\b/g, 'border-border/50'],
  [/\bborder-slate-600\b/g, 'border-border/40'],
  [/\bborder-slate-500\b/g, 'border-border/30'],
  [/\bborder-zinc-800\b/g, 'border-border/80'],
  [/\bborder-zinc-700\b/g, 'border-border/50'],
  [/\bborder-zinc-600\b/g, 'border-border/40'],
  [/\bborder-neutral-800\b/g, 'border-border/80'],
  [/\bborder-neutral-700\b/g, 'border-border/50'],
  [/\bborder-neutral-600\b/g, 'border-border/40'],
  [/\bhover:bg-gray-950\b/g, 'hover:bg-background'],
  [/\bhover:bg-gray-900\b/g, 'hover:bg-background'],
  [/\bhover:bg-gray-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-gray-700\b/g, 'hover:bg-accent/10'],
  [/\bhover:bg-gray-600\b/g, 'hover:bg-accent/20'],
  [/\bhover:bg-gray-500\b/g, 'hover:bg-accent/30'],
  [/\bhover:bg-slate-950\b/g, 'hover:bg-background'],
  [/\bhover:bg-slate-900\b/g, 'hover:bg-background'],
  [/\bhover:bg-slate-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-slate-700\b/g, 'hover:bg-accent/10'],
  [/\bhover:bg-slate-600\b/g, 'hover:bg-accent/20'],
  [/\bhover:bg-slate-500\b/g, 'hover:bg-accent/30'],
  [/\bhover:bg-zinc-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-zinc-700\b/g, 'hover:bg-accent/10'],
  [/\bhover:bg-zinc-600\b/g, 'hover:bg-accent/20'],
  [/\bhover:bg-neutral-800\b/g, 'hover:bg-muted'],
  [/\bhover:bg-neutral-700\b/g, 'hover:bg-accent/10'],
  [/\bhover:bg-neutral-600\b/g, 'hover:bg-accent/20'],
  [/\bhover:text-white\b/g, 'hover:text-foreground'],
  [/\bhover:text-gray-100\b/g, 'hover:text-foreground/90'],
  [/\bhover:text-gray-200\b/g, 'hover:text-foreground/80'],
  [/\bhover:text-gray-300\b/g, 'hover:text-foreground/70'],
  [/\bhover:text-gray-400\b/g, 'hover:text-foreground/60'],
  [/\bhover:text-slate-100\b/g, 'hover:text-foreground/90'],
  [/\bhover:text-slate-200\b/g, 'hover:text-foreground/80'],
  [/\bhover:text-slate-300\b/g, 'hover:text-foreground/70'],
  [/\bhover:text-slate-400\b/g, 'hover:text-foreground/60'],
  [/\bhover:text-zinc-300\b/g, 'hover:text-foreground/70'],
  [/\bhover:text-zinc-400\b/g, 'hover:text-foreground/60'],
  [/\bplaceholder-gray-400\b/g, 'placeholder-muted-foreground'],
  [/\bplaceholder-gray-500\b/g, 'placeholder-muted-foreground/80'],
  [/\bplaceholder-slate-400\b/g, 'placeholder-muted-foreground'],
  [/\bplaceholder-slate-500\b/g, 'placeholder-muted-foreground/80'],
  [/\bplaceholder-zinc-400\b/g, 'placeholder-muted-foreground'],
  [/\bplaceholder-neutral-400\b/g, 'placeholder-muted-foreground'],
  [/\bbg-blue-500\b/g, 'bg-primary'],
  [/\bbg-blue-600\b/g, 'bg-primary'],
  [/\bbg-blue-700\b/g, 'bg-primary'],
  [/\bbg-blue-800\b/g, 'bg-primary'],
  [/\bbg-blue-900\b/g, 'bg-primary'],
  [/\btext-blue-200\b/g, 'text-primary-foreground/80'],
  [/\btext-blue-300\b/g, 'text-primary-foreground'],
  [/\btext-blue-400\b/g, 'text-primary'],
  [/\btext-blue-500\b/g, 'text-primary'],
  [/\btext-blue-600\b/g, 'text-primary'],
  [/\btext-blue-700\b/g, 'text-primary'],
  [/\bhover:bg-blue-500\b/g, 'hover:bg-primary'],
  [/\bhover:bg-blue-600\b/g, 'hover:bg-primary'],
  [/\bhover:bg-blue-700\b/g, 'hover:bg-primary/80'],
  [/\bhover:bg-blue-800\b/g, 'hover:bg-primary/70'],
  [/\bhover:text-blue-400\b/g, 'hover:text-primary'],
  [/\bhover:text-blue-500\b/g, 'hover:text-primary'],
  [/\bfocus:ring-blue-500\b/g, 'focus:ring-primary'],
  [/\bfocus:border-blue-500\b/g, 'focus:border-primary'],
  [/\bbg-emerald-500\b/g, 'bg-success'],
  [/\bbg-emerald-600\b/g, 'bg-success'],
  [/\btext-emerald-400\b/g, 'text-success'],
  [/\btext-emerald-500\b/g, 'text-success'],
  [/\bhover:bg-emerald-500\b/g, 'hover:bg-success'],
  [/\bhover:bg-emerald-600\b/g, 'hover:bg-success'],
  [/\btext-red-400\b/g, 'text-destructive'],
  [/\btext-red-500\b/g, 'text-destructive'],
  [/\bbg-red-500\b/g, 'bg-destructive'],
  [/\bbg-red-600\b/g, 'bg-destructive'],
  [/\bhover:bg-red-500\b/g, 'hover:bg-destructive'],
  [/\bhover:bg-red-600\b/g, 'hover:bg-destructive'],
  [/\bborder-red-500\b/g, 'border-destructive'],
  [/\btext-yellow-400\b/g, 'text-warning'],
  [/\btext-yellow-500\b/g, 'text-warning'],
  [/\bbg-yellow-500\b/g, 'bg-warning'],
  [/\bbg-yellow-600\b/g, 'bg-warning'],
  [/\btext-purple-400\b/g, 'text-accent'],
  [/\btext-purple-500\b/g, 'text-accent'],
  [/\bbg-purple-500\b/g, 'bg-accent'],
  [/\bbg-purple-600\b/g, 'bg-accent'],
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [regex, replacement] of replacements) {
    if (regex.test(content)) {
      content = content.replace(regex, replacement);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated:', filePath);
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === 'api' || entry.name === 'pocket-base-zeus') continue;
      walk(fullPath);
    } else if (/\.(tsx|jsx|ts)$/.test(entry.name)) {
      processFile(fullPath);
    }
  }
}

walk('C:/Zeus-IA');
console.log('Done.');
