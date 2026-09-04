// Declaración mínima de tipos para `semver` (el paquete instalado no incluye .d.ts
// ni @types/semver). Solo tipamos las funciones usadas por fix-dependencies/route.ts.
declare module 'semver' {
  export function validRange(range: string): string | null;
  export function maxSatisfying(versions: readonly string[], range: string): string | null;
  export function satisfies(version: string, range: string): boolean;
  export function valid(version: string): string | null;
  const _default: { validRange: typeof validRange; maxSatisfying: typeof maxSatisfying };
  export default _default;
}