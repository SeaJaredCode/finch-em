import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';
import { getStore } from './store/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const app = express();
app.disable('x-powered-by');
// One proxy (the load balancer) in front: req.secure follows X-Forwarded-Proto, so the session
// cookie (src/auth.js, d-29) is Secure on https and plain in tests and local development.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  const store = getStore();
  let db = 'ok';
  try {
    await store.ping();
  } catch (err) {
    db = 'error: ' + err.message;
  }
  res.json({ status: 'ok', store: store.kind, db });
});

app.use('/api', apiRouter);

// The client: static ES modules under public/ (d-7).
app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));

export default app;
