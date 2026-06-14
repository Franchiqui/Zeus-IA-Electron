Dentro de la pestaña IDE de Zeus IA, las herramientas disponibles en el toolbar (barra de herramientas) son las siguientes:

1.  **Formatear código**: Aplica un formateador de código (como Prettier) al archivo abierto actualmente en el editor para corregir la indentación, los espacios y la estructura general del código.

2.  **Corregir código (`POST /api/correct-file-code`)**: Envía el código del archivo activo a la IA para que lo analice y corrija errores de sintaxis, lógica o bugs.

3.  **Fix imports (`POST /api/fix-missing-imports`)**: Escanea el archivo activo en busca de dependencias o módulos que se estén utilizando pero que no tengan una declaración de importación, y las añade automáticamente.

4.  **Validar componentes (`POST /api/validate-components`)**: Analiza los componentes de React/Next.js en el archivo activo para verificar que su estructura, props y uso sean correctos según las mejores prácticas.

5.  **Fix dependencias (`POST /api/fix-dependencies`)**: Revisa el archivo `package.json` del proyecto y las importaciones del archivo activo para instalar o actualizar dependencias faltantes o incorrectas.

6.  **Generar icono (`POST /api/generate-icon`)**: Utiliza la IA para generar un icono (generalmente en formato SVG o similar) basado en una descripción o el contexto del archivo activo.

7.  **Ver esquema (`GET /api/schema/simple`)**: Muestra una vista simplificada del esquema de la base de datos (Prisma o PocketBase) asociado al proyecto.

8.  **Undo con diff (botón ámbar `Undo2`)**: Lee el archivo de backup (`.zeus-backup`) del archivo activo y abre un modal (`UndoDiffModal`) que muestra un diff visual (cambios lado a lado) entre la versión actual y la del backup. Al confirmar, se ejecuta `POST /api/ide-files/undo` para restaurar la versión anterior. Si no hay backup, muestra un aviso.