import { createServer } from 'node:http';

if (process.env.SERVICE_ROLE === 'invitation-worker') {
  createServer((request, response) => {
    if (request.url === '/health/live' || request.url === '/health/ready') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify({
          status: request.url === '/health/live' ? 'ok' : 'ready',
        }),
      );
      return;
    }
    response.writeHead(404).end('Not found');
  }).listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0');
  await import('../apps/server/src/invitation-worker.ts');
} else {
  await import('../apps/server/src/api.ts');
}
