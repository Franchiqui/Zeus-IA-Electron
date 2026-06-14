const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API para Manipulación de Aplicaciones con IA',
      version: '1.0.0',
      description: 'API que permite a una IA crear, manipular y planificar aplicaciones',
    },
    servers: [
      {
        url: 'http://localhost:8742/api',
        description: 'Servidor local',
      },
    ],
    components: {
      schemas: {
        Folder: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
          },
        },
        File: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            extension: { type: 'string' },
            type: { type: 'string' },
            path: { type: 'string' },
          },
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            extension: { type: 'string' },
            type: { type: 'string' },
            path: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js'],
};

module.exports = swaggerJsdoc(options);