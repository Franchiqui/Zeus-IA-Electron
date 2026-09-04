const pkg = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next',
  async rewrites() {
    return [
      {
        source: '/api/git/:path*',
        destination: 'http://localhost:8742/api/git/:path*',
      },
      {
        source: '/api/github/:path*',
        destination: 'http://localhost:8742/api/github/:path*',
      },
    ];
  },
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || pkg.name,
  },
  excludeDefaultMomentLocales: true,
  outputFileTracingExcludes: {
    '*': [
      'dist/**',
      'api/**',
      'terminal-server/**',
      'serve/**',
      'node_modules/**',
      '.next/**'
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zeus-basedatos.fly.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // El splitChunks custom es una optimización de producción.
      // En dev (next dev --webpack) parte el CSS en chunks con nombre
      // (framework.css/commons.css) que el runtime carga como JS y falla
      // al parsear CSS en crudo (* y @font-face). Solo aplicarlo en prod.
      if (process.env.NODE_ENV === 'production') {
        config.optimization.splitChunks = {
          ...config.optimization.splitChunks,
          chunks: 'all',
          maxInitialRequests: Infinity,
          minSize: 0,
          cacheGroups: {
            default: false,
            vendors: false,
            framework: {
              name: 'framework',
              chunks: 'all',
              test: /next|react|react-dom/,
              priority: 40,
              enforce: true,
            },
            lib: {
              test: /[/]node_modules[/]/,
              name: 'lib',
              priority: 30,
              minChunks: 1,
              reuseExistingChunk: true,
            },
            commons: {
              name: 'commons',
              chunks: 'all',
              priority: 20,
            },
            shared: {
              name(module, chunks) {
                return chunks.map((chunk) => chunk.name).join('-');
              },
              priority: 10,
              minChunks: 2,
              reuseExistingChunk: true,
            },
          },
        };
      }

      // Bundlea Monaco localmente y genera los workers (editor.worker,
      // ts.worker, json.worker, css.worker, html.worker). El host propio
      // de Zeus (lib/zeus-monaco/host.ts) usa el editor worker vía
      // `new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url)`.
      const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
      config.plugins.push(
        new MonacoWebpackPlugin({
          languages: ['typescript', 'javascript', 'json', 'css', 'html'],
          filename: 'static/[name].worker.[contenthash].js',
          publicPath: '/_next/',
        }),
      );
    }
    return config;
  },
};

module.exports = nextConfig;
