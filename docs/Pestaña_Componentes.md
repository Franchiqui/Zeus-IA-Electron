# Pestaña Componentes de Zeus IA

La pestaña **Componentes** es un **explorador visual interactivo** que permite inspeccionar, seleccionar y editar componentes de la interfaz de usuario en tiempo real.

## Funcionalidades principales:

1. **Selector visual de componentes**: Al hacer clic en cualquier elemento de la UI, se resalta y muestra su información (tipo, props, estado).

2. **Explorador de componentes**: Muestra un árbol jerárquico con todos los componentes renderizados en la página actual.

3. **Editor de propiedades**: Permite modificar props, estilos y estado de los componentes seleccionados directamente desde el panel.

4. **Vista previa en vivo**: Los cambios se reflejan instantáneamente en la interfaz sin necesidad de recargar.

5. **Historial de selección**: Mantiene un registro de los últimos componentes inspeccionados.

## Archivos relacionados:
- `component-selector-helper.tsx` (134KB) - Lógica principal del selector
- `components/component-selector-helper.tsx` (143KB) - Versión alternativa
- `components/studio/component-explorer.tsx` - Explorador de componentes
- `components/studio/component-type-selector.tsx` - Selector de tipos

## Uso típico:
- Depurar componentes problemáticos
- Explorar la estructura de la UI
- Modificar propiedades sin editar código fuente
- Identificar qué componente renderiza qué parte de la pantalla
