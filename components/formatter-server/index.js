// Formateador de Código Escapado - Servidor Principal
const app = require('./server');

// Iniciar la aplicación
const PORT = process.env.PORT || 3010;

app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('Formateador de Código Escapado');
    console.log('='.repeat(50));
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('API Endpoints disponibles:');
    console.log('  POST /api/format - Formatear código escapado');
    console.log('  POST /api/validate-json - Validar JSON');
    console.log('='.repeat(50));
});
