Pestaña **Explorador** de Zeus IA.

La pestaña **Explorador** es el panel principal de navegación y gestión de archivos dentro del entorno de desarrollo de Zeus. Su función es similar a la de un explorador de archivos de cualquier sistema operativo o IDE (como VSCode), pero está optimizada para trabajar con los proyectos que creas y modificas a través de la API.

### Funcionalidades principales:

1.  **Visualización del Árbol de Directorios:**
    - Muestra de forma jerárquica todas las carpetas y archivos de tu proyecto actual.
    - Puedes expandir y colapsar las carpetas para navegar por la estructura del proyecto.

2.  **Gestión de Archivos y Carpetas:**
    - **Crear:** Puedes crear nuevos archivos y carpetas directamente desde la interfaz.
    - **Renombrar:** Te permite cambiar el nombre de cualquier archivo o carpeta.
    - **Eliminar:** Puedes borrar archivos o carpetas completas.
    - **Mover/Copiar:** (Dependiendo de la implementación) Podrías arrastrar y soltar elementos para reorganizar la estructura.

3.  **Apertura de Archivos en el Editor:**
    - Al hacer clic en un archivo (`.tsx`, `.js`, `.json`, `.css`, etc.), este se abre en el editor de código central de Zeus, permitiéndote ver y modificar su contenido.

4.  **Contexto para la IA:**
    - Es la herramienta que utilizas para indicarle a la IA *qué* archivos debe leer o modificar. Cuando seleccionas un archivo en el explorador, le estás dando contexto a la IA para que pueda trabajar sobre él.

### ¿Cómo se relaciona con lo que hago yo (la IA)?

Cuando tú me pides, por ejemplo, "crea una carpeta `components` dentro de `app`", o "abre el archivo `page.tsx`", estás interactuando con la lógica que subyace a esta pestaña. Yo, como IA, ejecuto las acciones a través de la API que manipula exactamente esta estructura de archivos que ves en el Explorador.

**En resumen:** El Explorador es tu "mesa de trabajo visual". Te permite ver, organizar y seleccionar los archivos de tu proyecto, mientras que yo (la IA) soy la "mano de obra" que los crea, modifica y elimina según tus instrucciones.
