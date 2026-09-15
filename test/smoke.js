'use strict';
/**
 * Smoke 测试:在沙盒主目录(.sandbox-home)里模拟三个 CLI 的既有配置,
 * 启动服务后走一遍完整流程,验证"合并写入不破坏用户配置"这一核心承诺。
 * 运行:npm test(或 node test/smoke.js)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SANDBOX = path.join(ROOT, '.sandbox-home');
const PORT = 8391;
const BASE = `http://127.0.0.1:${PORT}`;
const MARK = '# >>> Agent API Hub';

let passed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name} ${extra}`);
    process.exitCode = 1;
  }
}

const api = async (p, opts) => {
  const res = await fetch(BASE + p, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

async function setupSandbox() {
  await fsp.rm(SANDBOX, { recursive: true, force: true });
  await fsp.mkdir(path.join(SANDBOX, '.claude'), { recursive: true });
  await fsp.mkdir(path.join(SANDBOX, '.codex'), { recursive: true });
  await fsp.mkdir(path.join(SANDBOX, '.gemini'), { recursive: true });
  // 预置"用户自己的配置",里面故意放了不该被我们动的内容
  await fsp.writeFile(
    path.join(SANDBOX, '.claude', 'settings.json'),
    JSON.stringify(
      {
        permissions: { allow: ['Bash'] },
        env: { ANTHROPIC_API_KEY: 'sk-old-official', MY_CUSTOM: 'keep-me' },
        model: 'claude-opus-4-1',
      },
      null,
      2,
    ),
  );
  await fsp.writeFile(
    path.join(SANDBOX, '.codex', 'config.toml'),
    [
      'model = "gpt-5-codex"',
      'approval_policy = "on-request"',
      '',
      '[model_providers.mine]',
      'name = "my old provider"',
      'base_url = "https://old.example.com/v1"',
      '',
      '[profiles.fast]',
      'model = "gpt-5-mini"',
    ].join('\n'),
  );
  await fsp.writeFile(path.join(SANDBOX, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-old', tokens: { id_token: 'keep' } }));
  await fsp.writeFile(path.join(SANDBOX, '.gemini', '.env'), 'GEMINI_API_KEY=old-gemini-key\nMY_VAR=keep\n');
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + '/api/status');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('服务未能启动');
}

async function main() {
  console.log('── 准备沙盒主目录:', SANDBOX);
  await setupSandbox();

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, APIHUB_HOME: SANDBOX, APIHUB_DATA_DIR: path.join(SANDBOX, 'apihub-data'), APIHUB_PORT: String(PORT) },
    stdio: 'ignore',
  });
  const shutdown = () => server.kill();
  process.on('exit', shutdown);
  process.on('SIGINT', () => process.exit(1));

  try {
    await waitForServer();

    console.log('── 状态接口');
    let r = await api('/api/status');
    check('GET /api/status 返回三个目标', r.data.length === 3 && r.data.some((s) => s.target === 'claude' && s.configExists));

    console.log('── 供应商 CRUD');
    r = await api('/api/providers', { method: 'POST', body: { target: 'claude', name: '测试中转站', baseUrl: 'https://relay.example.com', apiKey: 'sk-relay-1234567890', model: 'claude-sonnet-4-5' } });
    const claudeProv = r.data;
    check('POST 创建 claude 供应商', r.status === 201 && claudeProv.id);

    r = await api(`/api/providers/${claudeProv.id}`, { method: 'PUT', body: { ...claudeProv, name: '测试中转站·改' } });
    check('PUT 更新供应商', r.status === 200 && r.data.name === '测试中转站·改');

    console.log('── 预览');
    r = await api(`/api/providers/${claudeProv.id}/preview`);
    check('预览返回 settings.json 且包含将写入的键', r.data.files[0].path.includes('settings.json') && r.data.files[0].snippet.includes('ANTHROPIC_BASE_URL'));

    console.log('── 启用 Claude 供应商(合并写入)');
    r = await api(`/api/providers/${claudeProv.id}/activate`, { method: 'POST' });
    check('activate 成功', r.data.ok);
    const settings = JSON.parse(await fsp.readFile(path.join(SANDBOX, '.claude', 'settings.json'), 'utf8'));
    check('BASE_URL / AUTH_TOKEN 已写入', settings.env.ANTHROPIC_BASE_URL === 'https://relay.example.com' && settings.env.ANTHROPIC_AUTH_TOKEN === 'sk-relay-1234567890');
    check('用户原有的 permissions / 自定义 env 保留', settings.permissions?.allow?.[0] === 'Bash' && settings.env.MY_CUSTOM === 'keep-me');
    check('冲突的 ANTHROPIC_API_KEY 已移除', !('ANTHROPIC_API_KEY' in settings.env));
    check('写前备份已生成', fs.existsSync(path.join(SANDBOX, '.claude', 'settings.json.apihub.bak')));

    console.log('── 启用 Codex 供应商(TOML 顶部管理块)');
    r = await api('/api/providers', { method: 'POST', body: { target: 'codex', name: 'openai 兼容站', baseUrl: 'https://oai.example.com/v1', apiKey: 'sk-oai-1234567890', wireApi: 'chat' } });
    const codexProv = r.data;
    r = await api(`/api/providers/${codexProv.id}/activate`, { method: 'POST' });
    check('activate 成功', r.data.ok);
    let toml = await fsp.readFile(path.join(SANDBOX, '.codex', 'config.toml'), 'utf8');
    check('管理块位于文件顶部(model_provider 在第一个 table 之前)', toml.startsWith(MARK) && toml.indexOf('model_provider') < toml.indexOf('[model_providers.mine]'));
    check('用户原有的 [model_providers.mine] / [profiles.fast] 保留', toml.includes('[model_providers.mine]') && toml.includes('[profiles.fast]') && toml.includes('approval_policy = "on-request"'));
    const auth = JSON.parse(await fsp.readFile(path.join(SANDBOX, '.codex', 'auth.json'), 'utf8'));
    check('auth.json 写入 OPENAI_API_KEY 且保留其他键', auth.OPENAI_API_KEY === 'sk-oai-1234567890' && auth.tokens?.id_token === 'keep');

    console.log('── 幂等:再次启用不产生重复块');
    r = await api('/api/providers', { method: 'POST', body: { target: 'codex', name: '另一家', baseUrl: 'https://oai2.example.com/v1', apiKey: 'sk-2' } });
    const codexProv2 = r.data;
    await api(`/api/providers/${codexProv2.id}/activate`, { method: 'POST' });
    toml = await fsp.readFile(path.join(SANDBOX, '.codex', 'config.toml'), 'utf8');
    check('管理块只有一份', toml.split(MARK).length - 1 === 1);
    check('旧供应商的顶层 model 键被清理(无重复键)', (toml.match(/^model\s*=/gm) || []).length === 1);
    check('用户原有配置仍在', toml.includes('[profiles.fast]'));

    console.log('── 启用 Gemini 供应商(.env 按行 upsert)');
    r = await api('/api/providers', { method: 'POST', body: { target: 'gemini', name: 'gemini 站', baseUrl: 'https://g.example.com', apiKey: 'g-key-1234567890' } });
    const gemProv = r.data;
    r = await api(`/api/providers/${gemProv.id}/activate`, { method: 'POST' });
    check('activate 成功', r.data.ok);
    const envText = await fsp.readFile(path.join(SANDBOX, '.gemini', '.env'), 'utf8');
    check('GEMINI_API_KEY 已替换', envText.includes('GEMINI_API_KEY=g-key-1234567890'));
    check('GOOGLE_GEMINI_BASE_URL 已追加', envText.includes('GOOGLE_GEMINI_BASE_URL=https://g.example.com'));
    check('用户原有行保留', envText.includes('MY_VAR=keep'));

    console.log('── 连通性测试(伪造地址,只验证错误处理路径)');
    r = await api(`/api/providers/${gemProv.id}/test`, { method: 'POST' });
    check('测试返回结构完整且 ok=false(连不上要优雅报错)', typeof r.data.ok === 'boolean' && r.data.ok === false && r.data.detail.length > 0 && r.data.latencyMs >= 0);

    console.log('── 恢复默认');
    r = await api('/api/targets/codex/reset', { method: 'POST' });
    check('reset 成功', r.data.ok);
    toml = await fsp.readFile(path.join(SANDBOX, '.codex', 'config.toml'), 'utf8');
    const rootSection = toml.slice(0, toml.indexOf('[')); // 第一个 table 头之前 = TOML 顶层
    check('管理块与顶层 model_provider 键已移除', !toml.includes(MARK) && !/^model_provider\s*=/m.test(toml));
    check('顶层 model 键已移除(表内的 model 不受影响)', !/^\s*model\s*=/m.test(rootSection) && toml.includes('model = "gpt-5-mini"'));
    check('用户原有 TOML 内容完好', toml.includes('[model_providers.mine]') && toml.includes('[profiles.fast]') && toml.includes('approval_policy = "on-request"'));
    r = await api('/api/status');
    check('状态显示 codex 已回到默认', r.data.find((s) => s.target === 'codex').managedByHub === false);

    console.log('── 删除供应商');
    r = await api(`/api/providers/${claudeProv.id}`, { method: 'DELETE' });
    r = await api('/api/providers');
    check('删除后列表不含该供应商', !r.data.some((x) => x.id === claudeProv.id));

    console.log('── 前端词条完整性(i18n)');
    const pubDir = path.join(ROOT, 'public');
    const i18nCode = fs.readFileSync(path.join(pubDir, 'i18n.js'), 'utf8');
    const sandbox = new Function(
      'document',
      'localStorage',
      'CustomEvent',
      i18nCode + '\n;return { I18N_DICT, t };',
    );
    const { I18N_DICT, t: tFn } = sandbox(
      { querySelectorAll: () => [], getElementById: () => null },
      { getItem: () => null, setItem: () => {} },
      function () {},
    );
    const htmlSrc = fs.readFileSync(path.join(pubDir, 'index.html'), 'utf8');
    const appSrc = fs.readFileSync(path.join(pubDir, 'app.js'), 'utf8');
    const usedKeys = new Set();
    for (const m of htmlSrc.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)) usedKeys.add(m[1]);
    for (const m of appSrc.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) usedKeys.add(m[1]);
    const missZh = [...usedKeys].filter((k) => !(k in I18N_DICT.zh));
    const missEn = [...usedKeys].filter((k) => !(k in I18N_DICT.en));
    check(`页面与脚本引用的 ${usedKeys.size} 个词条在 zh 词典齐全`, missZh.length === 0, missZh.join(','));
    check('词条在 en 词典齐全', missEn.length === 0, missEn.join(','));
    const expectedInterp = I18N_DICT.zh.resultPage.replace('{from}', 1).replace('{to}', 5).replace('{total}', 9);
    check('t() 插值正常', tFn('resultPage', { from: 1, to: 5, total: 9 }) === expectedInterp);
    check('缺键回退原文', tFn('__missing_key__') === '__missing_key__');
    check('仪表盘视图结构存在', htmlSrc.includes('id="viewDash"') && htmlSrc.includes('id="viewProviders"') && htmlSrc.includes('id="statGrid"'));
    check('通知中心与侧边栏收起结构存在', htmlSrc.includes('id="bellBtn"') && htmlSrc.includes('id="bellMenu"') && htmlSrc.includes('id="collapseBtn"'));

    console.log(`\n通过 ${passed} 项检查${process.exitCode ? '(存在失败!)' : ' ✅'}`);
  } finally {
    shutdown();
    await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('测试执行失败:', e);
  process.exit(1);
});
