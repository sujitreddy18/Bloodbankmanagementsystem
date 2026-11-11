import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createStore, CITIES, GROUPS, InputError } from './lib/store.js';

const root = fileURLToPath(new URL('.', import.meta.url));
export function createApp({ database = resolve(root, 'data/lifelink.sqlite'), seed = true } = {}) {
  const store = createStore(database, { seed });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return json(403, { error: 'Only local access is allowed.' });
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== url.origin) return json(403, { error: 'Cross-origin access is not allowed.' });
      const method = req.method;
      if (url.pathname.startsWith('/api/')) {
        if (method === 'GET' && url.pathname === '/api/meta') return json(200, { cities: CITIES, groups: GROUPS });
        if (method === 'GET' && url.pathname === '/api/donors') return json(200, { donors: store.search(url.searchParams) });
        if (method === 'GET' && url.pathname === '/api/activity') return json(200, { activity: store.activity() });
        const match = url.pathname.match(/^\/api\/donors\/([a-f0-9-]+)$/);
        if (method === 'GET' && match) { const donor = store.get(match[1]); return json(donor ? 200 : 404, donor ? { donor } : { error: 'Donor not found.' }); }
        if ((method === 'POST' && url.pathname === '/api/donors') || (method === 'PUT' && match)) {
          if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Send an application/json body.', 415);
          let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) throw new InputError('Profile is too large.', 413); }
          let input; try { input = JSON.parse(body); } catch { throw new InputError('Invalid JSON body.'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Provide a donor profile.');
          return json(method === 'POST' ? 201 : 200, { donor: store.save(input, match?.[1]) });
        }
        if (method === 'DELETE' && match) { store.remove(match[1]); return json(200, { success: true }); }
        return json(404, { error: 'Endpoint not found.' });
      }
      if (!['GET', 'HEAD'].includes(method)) return json(405, { error: 'Method not allowed.' });
      const paths = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
      const path = paths[url.pathname];
      if (!path) return json(404, { error: 'Page not found.' });
      const body = await readFile(resolve(root, 'public', path));
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(method === 'HEAD' ? undefined : body);
    } catch (error) { if (!(error instanceof InputError)) console.error(error); json(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' }); }
  });
  server.on('close', () => store.close());
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp({ database: process.env.DB_PATH || resolve(root, 'data/lifelink.sqlite'), seed: process.env.SEED_DEMO !== 'false' });
  server.listen(port, '127.0.0.1', () => console.log(`LifeLink is ready at http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Set PORT to use another port.` : error.message); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
