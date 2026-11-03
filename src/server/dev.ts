import { createServer } from 'vite';
import { createApplication } from './app.js';

const vite = await createServer({ server: { middlewareMode: true } });
const app = await createApplication({ vite });
const port = Number(process.env.PORT || 4173);

try {
  await app.listen({ host: '127.0.0.1', port });
  app.log.info(`IverBlog Tools 本机页面：http://localhost:${port}/`);
} catch (error) {
  await vite.close();
  app.log.error(error);
  process.exitCode = 1;
}

async function close(): Promise<void> {
  await app.close();
  await vite.close();
}
process.once('SIGINT', () => { void close().finally(() => { process.exitCode = 0; }); });
process.once('SIGTERM', () => { void close().finally(() => { process.exitCode = 0; }); });
