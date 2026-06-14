Pestaña **Vista Previa** de Zeus IA:

## Pestaña Vista Previa (Preview)

La pestaña **Vista Previa** es un componente central del IDE Zeus IA que permite visualizar en tiempo real el resultado de las aplicaciones web que se están desarrollando. Está diseñada para funcionar como un navegador embebido dentro del propio editor.

### Características principales:

1. **Renderizado en tiempo real**: Muestra el resultado visual de los archivos HTML, CSS y JavaScript que se están editando en el editor de código. Los cambios se reflejan automáticamente sin necesidad de recargar manualmente.

2. **Integración con el editor**: Está sincronizada con el panel de edición de código, permitiendo ver instantáneamente cómo los cambios afectan al diseño y funcionalidad de la aplicación.

3. **Soporte para múltiples tecnologías**: Puede previsualizar aplicaciones construidas con:
   - HTML/CSS/JavaScript puro
   - Frameworks como React, Vue, Angular (a través del empaquetado interno)
   - Aplicaciones Next.js completas
   - Componentes individuales

4. **Actualización automática**: Utiliza un sistema de hot-reload que detecta cambios en los archivos y actualiza la vista previa sin perder el estado de la aplicación (cuando es posible).

5. **Controles de navegación**: Incluye botones para:
   - Recargar la vista previa manualmente
   - Abrir la vista previa en una ventana externa del navegador
   - Cambiar entre diferentes dispositivos de previsualización (responsive, móvil, tablet, escritorio)

6. **Panel de errores**: Si hay errores de compilación o ejecución, se muestran en un panel inferior dentro de la vista previa, con enlaces directos a la línea de código problemática.

7. **Modo oscuro/claro**: Respeta la configuración de tema del IDE, mostrando la vista previa en modo oscuro o claro según la preferencia del usuario.

### Funcionamiento técnico:

- La vista previa se ejecuta en un **iframe** o **webview** dentro del panel del IDE
- Se comunica con el servidor de desarrollo local (Express en puerto 8742) para obtener los archivos compilados
- Utiliza WebSockets para recibir notificaciones de cambios en tiempo real
- Soporta la inyección de scripts de depuración para facilitar el desarrollo

### Ubicación en la interfaz:

La pestaña **Vista Previa** se encuentra típicamente en el panel derecho del IDE, junto a otras pestañas como "Explorador", "Git", "Extensiones" y "Terminal". Puede arrastrarse y reorganizarse según las preferencias del usuario.

### Beneficios para el desarrollador:

- **Feedback inmediato**: Permite ver los cambios al instante, acelerando el ciclo de desarrollo
- **Depuración visual**: Facilita la identificación de problemas de diseño o funcionalidad
- **Pruebas de responsividad**: Permite probar cómo se ve la aplicación en diferentes tamaños de pantalla
- **Colaboración**: Ideal para mostrar avances a otros miembros del equipo sin necesidad de desplegar la aplicación

En resumen, la pestaña **Vista Previa** es una herramienta esencial en Zeus IA que transforma el IDE en un entorno de desarrollo completo, eliminando la necesidad de cambiar constantemente entre el editor y el navegador para ver los resultados del trabajo.