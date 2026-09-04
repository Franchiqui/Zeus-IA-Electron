

## 🖥️ **Sistema en ejecución** Entorno completo de desarrollo:

| Componente            | Puerto | Estado    |
|-----------------------|--------|-----------|
| Next.js App           | 8741   | ✅ Activo |
| Express API           | 8742   | ✅ Activo |
| WebSocket Terminal    | 3351   | ✅ Activo |
| PocketBase (DB+Auth)  | 8091   | ✅ Activo |
| Panel Central         | 8743   | ✅ Activo |
| App Preview           | 8744   | ✅ Activo |

---

## 🎯 **Capacidades disponibles**

### 1. **Chat con IA** (HP-1)
- Selector de modelos: OpenAI / Deepseek / Ollama / LM Studio
- Persistencia de conversaciones en PocketBase
- Integración con pipelines externos

### 2. **Gestión de archivos**
- Explorador con soporte para rutas profundas
- Operaciones CRUD completas
- Integración con PocketBase (`file_path`, `projects`)

### 3. **Git local** (HP-8)
- Detección automática de repositorios
- Operaciones: init, add, commit, push, pull, checkout
- Diff inline y historial de commits

### 4. **Modelos IA personalizados** (HP-7)
- Registro de modelos en `ai_models`
- Configuración de endpoints y API keys
- Tipado: remote / local

### 5. **Temas personalizados**
- Tabla `zeus_themes` con colores JSON
- Votaciones y calificaciones
- Selector en UI superior

---

## 📋 **Bases de datos en PocketBase**

| Tabla             | Descripción               |
|-------------------|---------------------------|
| `users`           | Usuarios autenticados     |
| `ai_models`       | Modelos IA registrados    |
| `conversations`   | Historial de chats        |
| `messages`        | Mensajes individuales     |
| `projects`        | Proyectos generados       |
| `pipeline_configs`| Configuración de pipelines|
| `zeus_themes`     | Temas de UI               |
| `theme_votes`     | Votaciones de temas       |

---

## 💬 **¿En qué puedo ayudarte?**

Puedo asistirte con:
- **Desarrollo de código** (React, Next.js, Node.js, TypeScript)
- **Configuración del sistema** (puertos, APIs, bases de datos)
- **Gestión de archivos y proyectos**
- **Integración con modelos de IA**
- **Cualquier otra tarea** que tengas en mente

¡Dime qué necesitas y comenzaré a trabajar en ello! 🚀