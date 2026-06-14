# ApiConfigModal

Componente modal reutilizable con 3 pestañas: API, Configuración y Pipeline.

## Estructura de archivos

```
ApiConfigModal/
├── index.ts           # Exportaciones principales
├── ApiConfigModal.tsx # Componente principal
├── types.ts           # Definiciones de tipos TypeScript
├── endpoints.ts       # Configuración de endpoints API
├── utils.ts           # Funciones de utilidad
└── README.md          # Este archivo
```

## Instalación

1. Copia la carpeta `ApiConfigModal` a tu proyecto en `components/ApiConfigModal/`

2. Asegúrate de tener las dependencias necesarias:
   - `@heroicons/react`
   - `lucide-react`
   - `@radix-ui/react-tabs`
   - `@radix-ui/react-dropdown-menu`
   - `clsx`
   - `tailwind-merge`

3. Los componentes UI necesarios deben estar en tu proyecto:
   - `@/components/ui/modal`
   - `@/components/ui/tabs`
   - `@/components/ui/button`
   - `@/components/ui/dropdown-menu`
   - `@/lib/utils` (función `cn`)

## Uso básico

```tsx
import { ApiConfigModal } from '@/components/ApiConfigModal';

function MiComponente() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>
        Abrir Modal
      </button>

      <ApiConfigModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        models={models}
        pipelineConfigs={pipelineConfigs}
        activePipeline={activePipeline}
        selectedModel={selectedModel}
        isDarkMode={true}
      />
    </>
  );
}
```

## Props

| Prop | Tipo | Requerido | Descripción |
|------|------|-----------|-------------|
| isOpen | boolean | Sí | Controla si el modal está abierto |
| onClose | () => void | Sí | Función para cerrar el modal |
| models | Model[] | No | Array de modelos disponibles |
| pipelineConfigs | PipelineConfig[] | No | Array de configuraciones de pipeline |
| activePipeline | PipelineConfig \| null | No | Configuración de pipeline activa |
| selectedModel | Model \| null | No | Modelo actualmente seleccionado |
| isDarkMode | boolean | No | Modo oscuro (default: true) |

## Tipos

### Model

```typescript
interface Model {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  systemPrompt: string;
}
```

### PipelineConfig

```typescript
interface PipelineConfig {
  id: string;
  name: string;
  isActive: boolean;
  ingestionModelId: string | null;
  retrievalModelId: string | null;
  orchestrationModelId: string | null;
  generationModelId: string | null;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModelId: string | null;
  systemPrompt: string | null;
}
```

## Características

### Pestaña API

- Dropdown para seleccionar entre 15 endpoints preconfigurados
- Formularios dinámicos que se generan según los parámetros del endpoint
- Soporte para parámetros de ruta, query y body
- Ejecución de endpoints con visualización de respuestas
- Manejo de errores con mensajes claros
- Colores distintivos por método HTTP

### Pestaña Configuración

- Visualización de la configuración del modelo seleccionado
- Parámetros: temperatura, max tokens, top P, penalties
- Visualización del system prompt
- Información del proveedor y modelo

### Pestaña Pipeline

- Configuración del pipeline RAG activo
- 4 fases: Ingesta, Recuperación, Orquestación, Generación
- Configuración de embeddings
- Parámetros de chunking (tamaño y solapamiento)
- System prompt del pipeline

## Personalización

### Agregar nuevos endpoints

Edita `endpoints.ts` y agrega nuevos endpoints al array `ENDPOINTS`:

```typescript
{
  id: 'mi-endpoint',
  method: 'POST',
  path: '/api/v1/mi-recurso',
  description: 'Descripción del endpoint',
  parameters: [
    { name: 'param1', type: 'string', required: true, description: 'Descripción', in: 'body' }
  ],
  requestBody: {
    contentType: 'application/json',
    fields: [
      { name: 'param1', type: 'string', required: true, description: 'Descripción' }
    ]
  }
}
```

### Modificar tema

Edita `utils.ts` para personalizar las clases de tema:

```typescript
export const themeClasses = {
  bgTertiary: 'bg-gray-800',
  bgSecondary: 'bg-gray-700',
  // ... más clases
};
```

## Dependencias externas

Este componente depende de los siguientes componentes UI que deben estar en tu proyecto:

- **Modal**: `@/components/ui/modal`
- **Tabs**: `@/components/ui/tabs` (Radix UI)
- **Button**: `@/components/ui/button`
- **DropdownMenu**: `@/components/ui/dropdown-menu` (Radix UI)
- **Utils**: `@/lib/utils` (función `cn` para combinar clases)

Si no tienes estos componentes, puedes instalarlos desde shadcn/ui o crear tus propias implementaciones.

## Licencia

Este componente es parte del proyecto ApiCol y puede ser reutilizado en otros proyectos.
