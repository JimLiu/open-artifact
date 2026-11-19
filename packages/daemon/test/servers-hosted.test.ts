import './helpers.ts';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { OpenRequest } from '@open-artifact/protocol';
import { TypeServers } from '../src/servers.ts';
import type { TypeInfo } from '../src/types.ts';

test('type open forwards hosted isolation context only over the private open RPC', async () => {
  const requests: OpenRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: '/broker/', page_url: 'http://art_test.frame.localhost:1234/' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const type = { id: 'fixture', entry: { kind: 'url', url: `http://127.0.0.1:${port}/`, open: true } } as TypeInfo;
  const servers = new TypeServers({ daemonUrl: () => 'http://127.0.0.1:1234', tokenFor: () => 'private', log: () => {} });
  const record = { id: 'art_test', root: '/tmp/fixture', title: 'Fixture' };
  const hosted = { shellOrigin: 'https://shell.example', frameOrigin: 'https://art_test.frames.example', contentOrigin: 'https://content-art_test.frames.example', contentBootstrapUrl: 'https://content-art_test.frames.example/__hosting/content/capability' };
  try {
    const opened = await servers.open(type, record, { shell: hosted.shellOrigin, hosted });
    assert.deepEqual(requests[0]!.hosted, hosted);
    assert.equal(opened.url, `http://127.0.0.1:${port}/broker/`);
    assert.equal(opened.page_url, 'http://art_test.frame.localhost:1234/');
    await servers.open(type, record, { shell: 'http://127.0.0.1:1234' });
    assert.equal('hosted' in requests[1]!, false, 'Local opens retain the existing RPC shape');
  } finally {
    servers.closeAll();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
