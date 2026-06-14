/**
 * Tokens de color globales de Zeus-IA.
 * Cada token mapea a las CSS variables usadas tanto en Next.js (shadcn)
 * como en panel-central (Tailwind v4 @theme).
 */

export interface ThemeTokenDef {
  key: string;
  label: string;
  defaultHex: string;
  /** Variable CSS de Next.js (shadcn/ui) en formato HSL sin paréntesis, e.g. "217 91% 60%" */
  nextVar: string;
  /** Variable CSS del panel-central (Tailwind v4) en formato HEX */
  panelVar: string;
}

export const THEME_TOKENS: ThemeTokenDef[] = [
  {
    key: "primary",
    label: "Primario (botones, acentos)",
    defaultHex: "#3b82f6",
    nextVar: "--primary",
    panelVar: "--color-primary",
  },
  {
    key: "primaryDim",
    label: "Primario oscuro (hover)",
    defaultHex: "#1d4ed8",
    nextVar: "--primary-dim",
    panelVar: "--color-primary-dim",
  },
  {
    key: "onPrimary",
    label: "Texto sobre primario",
    defaultHex: "#ffffff",
    nextVar: "--primary-foreground",
    panelVar: "--color-on-primary",
  },
  {
    key: "secondary",
    label: "Secundario (cyan / turquesa)",
    defaultHex: "#00e3fd",
    nextVar: "--secondary",
    panelVar: "--color-secondary",
  },
  {
    key: "onSecondary",
    label: "Texto sobre secundario",
    defaultHex: "#004d57",
    nextVar: "--secondary-foreground",
    panelVar: "--color-on-secondary",
  },
  {
    key: "tertiary",
    label: "Terciario (púrpura)",
    defaultHex: "#c4b5fd",
    nextVar: "--accent",
    panelVar: "--color-tertiary",
  },
  {
    key: "surface",
    label: "Fondo base (surface)",
    defaultHex: "#0e0e0e",
    nextVar: "--background",
    panelVar: "--color-surface",
  },
  {
    key: "surfaceContainer",
    label: "Contenedor (pestañas, - O X, tarjetas)",
    defaultHex: "#1a1a1a",
    nextVar: "--card",
    panelVar: "--color-surface-container",
  },
  {
    key: "surfaceContainerLow",
    label: "Contenedor bajo",
    defaultHex: "#131313",
    nextVar: "--popover",
    panelVar: "--color-surface-container-low",
  },
  {
    key: "surfaceContainerHigh",
    label: "Contenedor lista puntos finales",
    defaultHex: "#20201f",
    nextVar: "--muted",
    panelVar: "--color-surface-container-high",
  },
  {
    key: "surfaceContainerHighest",
    label: "Tarjetas Explorador",
    defaultHex: "#262626",
    nextVar: "--input",
    panelVar: "--color-surface-container-highest",
  },
  {
    key: "surfaceContainerLowest",
    label: "Contenedor mínimo",
    defaultHex: "#000000",
    nextVar: "--border",
    panelVar: "--color-surface-container-lowest",
  },
  {
    key: "onSurface",
    label: "Texto principal",
    defaultHex: "#ffffff",
    nextVar: "--foreground",
    panelVar: "--color-on-surface",
  },
  {
    key: "onSurfaceVariant",
    label: "Texto secundario / muted",
    defaultHex: "#adaaaa",
    nextVar: "--muted-foreground",
    panelVar: "--color-on-surface-variant",
  },
  {
    key: "outline",
    label: "Bordes / outlines",
    defaultHex: "#484847",
    nextVar: "--ring",
    panelVar: "--color-outline",
  },
  {
    key: "outlineVariant",
    label: "Bordes sutiles",
    defaultHex: "#484847",
    nextVar: "--border",
    panelVar: "--color-outline-variant",
  },
  {
    key: "error",
    label: "Error / peligro",
    defaultHex: "#d8b4fe",
    nextVar: "--destructive",
    panelVar: "--color-error",
  },
  {
    key: "success",
    label: "Éxito / verde",
    defaultHex: "#4ade80",
    nextVar: "--chart-2",
    panelVar: "--color-success",
  },
  {
    key: "warning",
    label: "Advertencia / amarillo",
    defaultHex: "#facc15",
    nextVar: "--chart-4",
    panelVar: "--color-warning",
  },
  {
    key: "info",
    label: "Info / azul claro",
    defaultHex: "#60a5fa",
    nextVar: "--chart-1",
    panelVar: "--color-info",
  },
  {
    key: "tabIcon",
    label: "Color de iconos de pestañas",
    defaultHex: "#ffffff",
    nextVar: "--tab-icon",
    panelVar: "--color-tab-icon",
  },
];

export const DEFAULT_THEME_NAME = "Zeus Default";

export interface SavedTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
  createdAt: number;
}
