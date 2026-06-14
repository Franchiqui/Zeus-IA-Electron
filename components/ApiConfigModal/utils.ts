// Utility functions for ApiConfigModal

export const getMethodColor = (method: string): string => {
  switch (method) {
    case 'GET': return 'bg-green-900 text-green-300';
    case 'POST': return 'bg-primary text-primary-foreground';
    case 'PUT': return 'bg-purple-900 text-purple-300';
    case 'PATCH': return 'bg-yellow-900 text-yellow-300';
    case 'DELETE': return 'bg-red-900 text-red-300';
    default: return 'bg-background text-foreground/70';
  }
};

export const themeClasses = {
  bgTertiary: 'bg-card',
  bgSecondary: 'bg-muted',
  border: 'border-border/50',
  card: 'bg-card border-border/50',
  input: 'bg-muted border-border/40 text-foreground focus:ring-primary focus:border-primary',
  button: 'bg-primary hover:bg-primary text-foreground',
  buttonSecondary: 'bg-muted hover:bg-muted/80 text-foreground'
};
