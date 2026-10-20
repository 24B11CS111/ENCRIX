import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Local API Dev Middleware Plugin:
 * Serves /api/* routes directly inside the Vite dev server during `npm run dev`
 * and dynamically loads server secrets from .env.local into process.env.
 */
function localApiServerPlugin(): Plugin {
  return {
    name: 'local-api-server',
    configureServer(server) {
      const env = loadEnv(server.config.mode || 'development', process.cwd(), '');
      Object.assign(process.env, env);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        try {
          const urlPath = req.url.split('?')[0];
          const requestedPath = urlPath.replace(/^\/api\//, '');
          const relativePath = requestedPath === 'followups/reminders'
            ? 'cron/follow-up-reminders'
            : requestedPath;
          const tsFilePath = path.resolve(__dirname, 'api', `${relativePath}.ts`);

          if (!fs.existsSync(tsFilePath)) {
            return next();
          }

          // Parse query string parameters into req.query
          const parsedUrl = new URL(req.url, 'http://localhost');
          const queryParams: Record<string, string> = {};
          parsedUrl.searchParams.forEach((value, key) => {
            queryParams[key] = value;
          });
          (req as any).query = queryParams;

          // Parse JSON or url-encoded request body
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
            }
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            try {
              if (rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[')) {
                (req as any).body = JSON.parse(rawBody);
              } else if (rawBody.trim().length > 0) {
                const params = new URLSearchParams(rawBody);
                const formObj: Record<string, string> = {};
                params.forEach((v, k) => {
                  formObj[k] = v;
                });
                (req as any).body = formObj;
              } else {
                (req as any).body = {};
              }
            } catch {
              (req as any).body = {};
            }
          }

          // Enhance response with standard Express/Vercel helper methods
          const resObj = res as any;
          resObj.status = (statusCode: number) => {
            resObj.statusCode = statusCode;
            return resObj;
          };
          resObj.json = (data: any) => {
            if (!resObj.headersSent) {
              resObj.setHeader('Content-Type', 'application/json');
            }
            resObj.end(JSON.stringify(data));
            return resObj;
          };
          resObj.send = (data: any) => {
            if (!resObj.headersSent && typeof data === 'string' && data.trim().startsWith('<?xml')) {
              resObj.setHeader('Content-Type', 'text/xml');
            }
            resObj.end(data);
            return resObj;
          };

          const mod = await server.ssrLoadModule(tsFilePath);
          if (mod && typeof mod.default === 'function') {
            await mod.default(req, resObj);
          } else {
            resObj.status(500).json({ error: `Handler in ${relativePath}.ts is not a default export function` });
          }
        } catch (err: any) {
          if (!(res as any).headersSent) {
            (res as any).status(500).json({ error: err?.message || 'Internal server error in API route' });
          }
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), localApiServerPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Production Security: Never generate source maps in production to prevent leaking symbols or architecture
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
