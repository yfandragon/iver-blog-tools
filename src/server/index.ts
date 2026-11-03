import { createApplication } from './app.js';

const app = await createApplication();
const port = Number(process.env.PORT || 4173);

try {
  await app.listen({ host: '127.0.0.1', port });
  app.log.info(`IverBlog Tools 本机页面：http://localhost:${port}/`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

async function close(): Promise<void> { await app.close(); }
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
