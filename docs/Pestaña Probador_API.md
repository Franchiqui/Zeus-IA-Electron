Pestaña "Probador de API" de Zeus IA es una herramienta integrada que permite interactuar con la API REST de PocketBase de forma visual y dinámica.

### Descripción General

Es un panel de interfaz de usuario que funciona como un cliente API gráfico. Su propósito es permitir al desarrollador probar, depurar y explorar los endpoints de la base de datos (PocketBase) sin necesidad de usar herramientas externas como Postman o cURL.

### Funcionalidades Clave

Según el contexto, el Probador de API incluye las siguientes capacidades:

1.  **Selección de Colección y Acción:** Permite elegir sobre qué colección de la base de datos se va a operar (ej. `users`, `projects`, `messages`) y qué acción CRUD se va a realizar (`List/Search`, `View`, `Create`, `Update`, `Delete`).

2.  **Gestión de Parámetros:**
    *   **Filtros:** Un campo de texto para escribir filtros en el formato de PocketBase (ej. `title ~ 'mi proyecto'`).
    *   **Ordenación:** Un campo para especificar el campo por el que ordenar los resultados (ej. `-created` para orden descendente por fecha de creación).
    *   **Paginación:** Controles para establecer el tamaño de página (`perPage`) y el número de página (`page`).
    *   **Parámetros Adicionales:** Un campo de texto libre para añadir parámetros extra a la petición (ej. `expand=user` para expandir relaciones).

3.  **Selector de Instancia:** Un desplegable para elegir contra qué instancia de PocketBase se realizará la petición:
    *   **Local:** `http://127.0.0.1:8091`
    *   **Remota:** `https://zeus-basedatos.fly.dev`

4.  **Visualización de Resultados:** La respuesta de la API se muestra en un bloque de código con resaltado de sintaxis, facilitando la lectura de los datos JSON devueltos.

5.  **Historial de Peticiones:** El probador guarda un historial de las últimas peticiones realizadas, permitiendo al usuario volver a ejecutarlas o consultarlas rápidamente.

### Integración Técnica

*   **Componente:** Se menciona un componente llamado `ApiTester` que se encuentra en la ruta `src/components/api-tester/`.
*   **Contexto:** Utiliza un contexto de React (`ApiTesterContext`) para gestionar el estado de la petición actual (colección, acción, filtros, etc.).
*   **Almacenamiento:** El historial de peticiones se persiste en el almacenamiento local del navegador (`localStorage`) bajo la clave `zeus-api-tester-history`.

En resumen, es una herramienta de desarrollo completa y práctica, directamente integrada en el IDE de Zeus, que agiliza el proceso de desarrollo y depuración de la capa de datos de la aplicación.