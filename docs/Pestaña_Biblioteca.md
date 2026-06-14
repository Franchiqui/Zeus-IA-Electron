## 📚 Pestaña Biblioteca de Zeus IA

La **Biblioteca** es un **catálogo visual de aplicaciones** generadas con Zeus IA. Funciona como un **marketplace/app store** donde puedes:

### Funcionalidades principales:

| Función | Descripción |
|---------|-------------|
| **Ver apps** | Grid con tarjetas que muestran screenshot, nombre, descripción, categoría y valoración |
| **Filtrar** | Por categorías: **Web**, **Móvil**, **Escritorio**, **Páginas Web** |
| **Buscar** | Por nombre, descripción o categoría |
| **Vista Previa** | Abre la app en un servidor de previsualización (con cooldown de 30s) |
| **Descargar** | Descarga el ZIP de la aplicación |
| **Editar** | Modifica nombre, descripción, categoría y valoración |
| **Eliminar** | Borra aplicaciones de la biblioteca |
| **Subir** | Añade nuevas aplicaciones al catálogo |
| **Ver imagen** | Pantalla completa del screenshot |

### Datos técnicos:
- **Backend**: PocketBase (colección `apps`)
- **Almacenamiento**: Screenshots y archivos ZIP
- **Categorías**: `web`, `mobile`, `desktop`, `pagina-web`
- **Cooldown**: 30 segundos entre previsualizaciones para evitar saturar el servidor
