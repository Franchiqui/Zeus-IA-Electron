Pestaña **Creador de Estructuras** de Zeus IA:

## Creador de Estructuras (Structure Creator)

Es una herramienta visual y asistida por IA dentro del IDE de Zeus IA, diseñada para **planificar, diseñar y generar la estructura completa de carpetas y archivos de un proyecto** antes de escribirlos en disco.

### Funcionalidades principales:

1. **Creación visual de árboles de proyecto**: Permite definir de forma interactiva la jerarquía de carpetas y archivos que compondrán una aplicación, sin necesidad de crearlos manualmente uno por uno.

2. **Asistencia de IA**: El usuario puede describir en lenguaje natural la estructura que necesita (ej: "un proyecto Next.js con autenticación, panel de admin y API REST"), y la IA genera automáticamente el árbol de directorios y archivos correspondiente.

3. **Persistencia en PocketBase**: Las estructuras creadas se guardan en la colección `structure_plans` de PocketBase, con los campos:
   - `name` — Nombre del plan de estructura
   - `description` — Descripción del proyecto
   - `structure` — JSON con la definición completa del árbol
   - `user` — Relación con el usuario creador

4. **Ejecución diferida**: Las estructuras no se crean inmediatamente en disco. Se guardan como un "plan" que puede ser revisado, modificado y finalmente **ejecutado** cuando el usuario lo decida, mediante el endpoint `POST /structure/execute`.

5. **Gestión de planes**: 
   - **Guardar** (`POST /structure/save`): Almacena la estructura como archivo JSON para reutilización futura.
   - **Listar** (`GET /structure/list`): Muestra todas las estructuras guardadas.
   - **Cargar** (`GET /structure/load`): Recupera una estructura previamente guardada para editarla o ejecutarla.

6. **Integración con el flujo de trabajo**: Una vez ejecutada la estructura, los archivos y carpetas aparecen en el explorador de archivos del IDE, listos para ser editados con el asistente de código.

### Beneficios clave:
- **Ahorro de tiempo**: Elimina la necesidad de crear manualmente decenas de archivos y carpetas.
- **Planificación visual**: Permite ver y ajustar la arquitectura del proyecto antes de implementarla.
- **Reutilización**: Las estructuras pueden guardarse como plantillas para proyectos similares futuros.
- **Colaboración**: Al estar en PocketBase, las estructuras pueden compartirse entre miembros del equipo.

En resumen, es una herramienta de **planificación arquitectónica asistida por IA** que actúa como un "blueprint" visual para proyectos, permitiendo diseñar, guardar y materializar estructuras completas de aplicaciones con un solo clic.