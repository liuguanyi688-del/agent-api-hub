'use strict';
/* 临时调试:最小化复现代理故障转移,定位挂起点 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const log = (...a) => console.log(Date.now() % 100000, ...a);

(async () => {
  // 好上游
  const mockUp = http.createServer((req, res) => {
    log('mockUp hit', req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, usage: { prompt_tokens: 11, completion_tokens: 13 } }));
  });
  await new Promise((r) => mockUp.listen(0, '127.0.0.1', r));
  // 断连上游
  const mockDrop = http.createServer((req, res) => {
    log('mockDrop hit → destroy');
    req.socket.destroy();
  });
  await new Promise((r) => mockDrop.listen(0, '127.0.0.1', r));

  const dir = path.join(__dirname, '.debug-proxy');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'providers.json'),
    JSON.stringify({
      providers: [
        { id: 'p-bad', target: 'codex', name: 'drop', baseUrl: `http://127.0.0.1:${mockDrop.address().port}/v1`, apiKey: 'k1' },
        { id: 'p-good', target: 'codex', name: 'good', baseUrl: `http://127.0.0.1:${mockUp.address().port}/v1`, apiKey: 'k2' },
      ],
      active: { codex: 'p-bad', claude: null, gemini: null },
    }),
  );
  log('starting proxy');
  const proxy = spawn(process.execPath, ['proxy.js'], {
    env: { ...process.env, APIHUB_PROXY_PORT: '8395', APIHUB_DATA_DIR: dir },
    stdio: 'inherit',
  });
  await new Promise((r) => setTimeout(r, 600));

  log('fetch /v1/models (failover expected)');
  const res = await fetch('http://127.0.0.1:8395/v1/models');
  log('status:', res.status, 'body:', await res.text());

  log('fetch /proxy-health');
  const h = await fetch('http://127.0.0.1:8395/proxy-health');
  log('health:', await h.text());

  log('done');
  proxy.kill();
  mockUp.close();
  mockDrop.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.error('DEBUG-FAIL:', e);
  process.exit(1);
});
