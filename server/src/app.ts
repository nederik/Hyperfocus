import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { apiRoutes } from './routes/api';
import type { AppEnv, Deps } from './types';

/** The application, independent of the platform: the same code runs on Node and on Cloudflare Workers. */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('db', deps.db);
    c.set('config', deps.config);
    c.set('storage', deps.storage);
    c.set('clientIp', deps.clientIp(c));
    await next();
  });

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        // blob: images and music decrypted in the browser
        connectSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Changing requests must come from this site (extra protection on top of the SameSite cookie).
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      const host = new URL(c.req.url).host;
      if (origin && new URL(origin).host !== host && new URL(origin).host !== c.req.header('x-forwarded-host'))
        return c.json({ error: 'Request from another site' }, 403);
    }
    await next();
  });

  app.route('/api', apiRoutes);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // ---- The page (production only; in development Vite serves it) ----
  const readHtml = deps.readHtml;
  if (readHtml) {
    app.get('*', async (c) => {
      const html = await readHtml();
      if (!html) return c.text('index.html not found. Did you run "npm run build"?', 500);
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow');
      return c.html(html);
    });
  }

  return app;
}
