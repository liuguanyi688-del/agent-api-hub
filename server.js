'use strict';
/**
 * Agent API Hub —— 把任意兼容 API 一键接入 Claude Code / Codex / Gemini CLI
 *
 * 零依赖,Node 18+ 即可运行:node server.js
 * 原理:各 CLI 工具从固定路径的配置文件读取上游地址与密钥,
 *      本服务管理"供应商"列表,启用时把对应键值合并写入这些配置文件(写前自动备份)。
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.APIHUB_PORT || 8317);
// APIHUB_HOME / APIHUB_DATA_DIR 仅供测试时重定向"用户主目录"和"存储位置",默认用真实路径
const HOME = process.env.APIHUB_HOME || os.homedir();
const DATA_DIR = process.env.APIHUB_DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'providers.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const BACKUP_SUFFIX = '.apihub.bak';

const MARK_BEGIN = '# >>> Agent API Hub managed block (auto-generated, do not edit) >>>';
const MARK_END = '# <<< Agent API Hub managed block <<<';

const TARGETS = {
  claude: { label: 'Claude Code', protocol: 'anthropic' },
  codex: { label: 'Codex CLI', protocol: 'openai' },
  gemini: { label: 'Gemini CLI', protocol: 'gemini' },
};

/* ---------------- 数据存储(data/providers.json) ---------------- */

let store = { providers: [], active: { claude: null, codex: null, gemini: null } };

async function loadStore() {
  try {
    const parsed = JSON.parse(await fsp.readFile(STORE_FILE, 'utf8'));
    store.providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    store.active = Object.assign({ claude: null, codex: null, gemini: null }, parsed.active || {});
  } catch {
    /* 首次运行没有存储文件 */
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function saveStore() {
  return fsp.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

const newId = () => crypto.randomUUID();

/* ---------------- 通用文件工具 ---------------- */

function atomicWrite(file, content) {
  // 先写临时文件再 rename,避免写一半崩溃留下损坏的配置
  const tmp = file + '.tmp-' + process.pid;
  return fsp.writeFile(tmp, content, 'utf8').then(() => fsp.rename(tmp, file));
}

async function backup(file) {
  // 滚动备份:每次写入前把原文件复制为 *.apihub.bak(只保留最近一次)
  try {
    await fsp.copyFile(file, file + BACKUP_SUFFIX);
    return file + BACKUP_SUFFIX;
  } catch {
    return null;
  }
}

function maskKey(key) {
  if (!key) return '(空)';
  if (key.length <= 10) return key.slice(0, 3) + '****';
  return key.slice(0, 6) + '****' + key.slice(-4);
}

const tomlStr = (v) => JSON.stringify(String(v)); // TOML 基础字符串与 JSON 字符串转义兼容

/* ---------------- Claude Code:~/.claude/settings.json ----------------
 * CLI 读取 env 中的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 决定请求去向。
 * 只增改 env 下我们管理的键,其余用户设置原样保留。
 */

const CLAUDE_MANAGED_ENV = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'];

function claudeSettingsFile() {
  return path.join(HOME, '.claude', 'settings.json');
}

function buildClaudeEnv(p) {
  const env = { ANTHROPIC_BASE_URL: p.baseUrl, ANTHROPIC_AUTH_TOKEN: p.apiKey };
  if (p.model) env.ANTHROPIC_MODEL = p.model;
  return env;
}

async function activateClaude(p) {
  const file = claudeSettingsFile();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let settings = {};
  if (fs.existsSync(file)) {
    await backup(file);
    try {
      settings = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      throw new Error('settings.json 不是合法 JSON(' + e.message + '),已中止以免破坏你的配置');
    }
  }
  settings.env = Object.assign({}, settings.env, buildClaudeEnv(p));
  delete settings.env.ANTHROPIC_API_KEY; // 统一走令牌鉴权,避免两个鉴权变量打架
  await atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { file, backup: file + BACKUP_SUFFIX };
}

async function resetClaude() {
  const file = claudeSettingsFile();
  if (!fs.existsSync(file)) return null;
  await backup(file);
  let settings;
  try {
    settings = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    throw new Error('settings.json 不是合法 JSON,已中止:' + e.message);
  }
  if (settings.env) {
    for (const k of CLAUDE_MANAGED_ENV) delete settings.env[k];
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  await atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { file, backup: file + BACKUP_SUFFIX };
}

function readClaudeLive() {
  const file = claudeSettingsFile();
  if (!fs.existsSync(file)) return { file, exists: false };
  try {
    const env = (JSON.parse(fs.readFileSync(file, 'utf8')) || {}).env || {};
    return { file, exists: true, baseUrl: env.ANTHROPIC_BASE_URL || null, apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || null };
  } catch {
    return { file, exists: true, parseError: true };
  }
}

/* ---------------- Codex CLI:~/.codex/config.toml + auth.json ----------------
 * config.toml 顶层 model_provider 指向一个 [model_providers.xxx] 表;
 * auth.json 中的 OPENAI_API_KEY 作为密钥。
 * TOML 一旦出现 [table] 头就无法回到顶层,所以我们的管理块固定插在文件最顶部。
 */

function codexFiles() {
  return { toml: path.join(HOME, '.codex', 'config.toml'), auth: path.join(HOME, '.codex', 'auth.json') };
}

// 移除旧管理块 + 顶层的 model / model_provider 键(避免 TOML 重复键)
function stripCodexManaged(raw) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inManaged = false;
  let inRoot = true; // 第一个 [table] 头之前的键属于顶层
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('# >>> Agent API Hub')) { inManaged = true; continue; }
    if (t.startsWith('# <<< Agent API Hub')) { inManaged = false; continue; }
    if (inManaged) continue;
    if (t.startsWith('[')) inRoot = false;
    if (inRoot && /^\s*(model|model_provider)\s*=/.test(line)) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

function buildCodexBlock(p) {
  const L = [MARK_BEGIN, 'model_provider = "apihub"'];
  if (p.model) L.push('model = ' + tomlStr(p.model));
  L.push('', '[model_providers.apihub]', 'name = ' + tomlStr(p.name), 'base_url = ' + tomlStr(p.baseUrl), 'wire_api = ' + tomlStr(p.wireApi || 'chat'), MARK_END);
  return L.join('\n');
}

async function activateCodex(p) {
  const { toml, auth } = codexFiles();
  await fsp.mkdir(path.dirname(toml), { recursive: true });
  const backups = [];

  let raw = '';
  if (fs.existsSync(toml)) {
    backups.push(await backup(toml));
    raw = await fsp.readFile(toml, 'utf8');
  }
  const rest = stripCodexManaged(raw);
  const nextToml = buildCodexBlock(p) + (rest ? '\n\n' + rest + '\n' : '\n');
  await atomicWrite(toml, nextToml);

  let authData = {};
  if (fs.existsSync(auth)) {
    backups.push(await backup(auth));
    try {
      authData = JSON.parse(await fsp.readFile(auth, 'utf8')) || {};
    } catch (e) {
      throw new Error('auth.json 不是合法 JSON(' + e.message + '),已中止以免破坏你的配置');
    }
  }
  authData.OPENAI_API_KEY = p.apiKey;
  await atomicWrite(auth, JSON.stringify(authData, null, 2) + '\n');
  return { files: [toml, auth], backups };
}

async function resetCodex() {
  const { toml, auth } = codexFiles();
  const results = { files: [], backups: [] };
  if (fs.existsSync(toml)) {
    results.backups.push(await backup(toml));
    const cleaned = stripCodexManaged(await fsp.readFile(toml, 'utf8'));
    await atomicWrite(toml, cleaned ? cleaned + '\n' : '');
    results.files.push(toml);
  }
  if (fs.existsSync(auth)) {
    results.backups.push(await backup(auth));
    try {
      const authData = JSON.parse(await fsp.readFile(auth, 'utf8')) || {};
      delete authData.OPENAI_API_KEY;
      await atomicWrite(auth, JSON.stringify(authData, null, 2) + '\n');
      results.files.push(auth);
    } catch { /* auth.json 损坏时不动它 */ }
  }
  return results;
}

function readCodexLive() {
  const { toml, auth } = codexFiles();
  if (!fs.existsSync(toml)) return { file: toml, exists: false };
  const text = fs.readFileSync(toml, 'utf8');
  const managed = text.includes(MARK_BEGIN);
  const m = text.match(/\[model_providers\.apihub\][^\[]*?base_url\s*=\s*"([^"]+)"/);
  let apiKey = null;
  try {
    apiKey = JSON.parse(fs.readFileSync(auth, 'utf8')).OPENAI_API_KEY || null;
  } catch { /* ignore */ }
  return { file: toml, authFile: auth, exists: true, managedByHub: managed, baseUrl: managed ? (m && m[1]) || null : null, apiKey };
}

/* ---------------- Gemini CLI:~/.gemini/.env ----------------
 * CLI 从 .env 读取 GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL / GEMINI_MODEL。
 * 按行做"存在则替换,不存在则追加",其余行保留。
 */

const GEMINI_MANAGED = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GEMINI_MODEL'];

function geminiEnvFile() {
  return path.join(HOME, '.gemini', '.env');
}

function upsertEnvLine(text, key, value) {
  const re = new RegExp('^[ \\t]*' + key + '[ \\t]*=.*$', 'gm');
  const line = key + '=' + value;
  if (text.search(re) >= 0) return text.replace(re, () => line);
  const prefix = text && !text.endsWith('\n') ? text + '\n' : text;
  return prefix + line + '\n';
}

function removeEnvLine(text, keys) {
  return text
    .split('\n')
    .filter((l) => !keys.some((k) => new RegExp('^[ \\t]*' + k + '[ \\t]*=').test(l)))
    .join('\n');
}

function buildGeminiLines(p) {
  const lines = { GEMINI_API_KEY: p.apiKey || '', GOOGLE_GEMINI_BASE_URL: p.baseUrl };
  if (p.model) lines.GEMINI_MODEL = p.model;
  return lines;
}

async function activateGemini(p) {
  const file = geminiEnvFile();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  let text = '';
  if (fs.existsSync(file)) {
    await backup(file);
    text = await fsp.readFile(file, 'utf8');
  }
  for (const [k, v] of Object.entries(buildGeminiLines(p))) text = upsertEnvLine(text, k, v);
  await atomicWrite(file, text);
  return { file, backup: file + BACKUP_SUFFIX };
}

async function resetGemini() {
  const file = geminiEnvFile();
  if (!fs.existsSync(file)) return null;
  await backup(file);
  const cleaned = removeEnvLine(await fsp.readFile(file, 'utf8'), GEMINI_MANAGED);
  await atomicWrite(file, cleaned);
  return { file, backup: file + BACKUP_SUFFIX };
}

function readGeminiLive() {
  const file = geminiEnvFile();
  if (!fs.existsSync(file)) return { file, exists: false };
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { file, exists: true, baseUrl: env.GOOGLE_GEMINI_BASE_URL || null, apiKey: env.GEMINI_API_KEY || null };
}

/* ---------------- 三个目标的统一入口 ---------------- */

const ACTIVATORS = { claude: activateClaude, codex: activateCodex, gemini: activateGemini };
const RESETTERS = { claude: resetClaude, codex: resetCodex, gemini: resetGemini };

async function writeTarget(target, p) {
  const r = await ACTIVATORS[target](p);
  store.active[target] = p.id;
  await saveStore();
  return r;
}

async function resetTarget(target) {
  const r = await RESETTERS[target]();
  store.active[target] = null;
  await saveStore();
  return r;
}

/* ---------------- 连通性测试 ---------------- */

async function timedFetch(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

async function testAnthropic(base, p) {
  const headers = {
    'x-api-key': p.apiKey,
    Authorization: 'Bearer ' + p.apiKey, // 兼容把官方 key 套在网关后面的中转站
    'anthropic-version': '2023-06-01',
  };
  let res = await timedFetch(base + '/v1/models', { headers });
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const n = Array.isArray(data.data) ? data.data.length : '?';
    return `认证成功,可见 ${n} 个模型(GET /v1/models)`;
  }
  if (res.status === 404 || res.status === 405) {
    // 有些站点没实现 /v1/models,退一步用 1 token 的对话请求真刀真枪验证
    res = await timedFetch(base + '/v1/messages', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model: p.model || 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.ok) return '对话接口连通(POST /v1/messages)';
  }
  const body = (await res.text().catch(() => '')).slice(0, 160);
  throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText} ${body}`.trim()), { status: res.status });
}

async function testOpenAI(base, p) {
  const url = (base.endsWith('/v1') ? base : base + '/v1') + '/models';
  const res = await timedFetch(url, { headers: { Authorization: 'Bearer ' + p.apiKey } });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 160);
    throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText} ${body}`.trim()), { status: res.status });
  }
  const data = await res.json().catch(() => ({}));
  const n = Array.isArray(data.data) ? data.data.length : '?';
  return `认证成功,可见 ${n} 个模型(GET /v1/models)`;
}

async function testGemini(base, p) {
  const res = await timedFetch(base + '/v1beta/models?pageSize=50', { headers: { 'x-goog-api-key': p.apiKey } });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 160);
    throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText} ${body}`.trim()), { status: res.status });
  }
  const data = await res.json().catch(() => ({}));
  const n = Array.isArray(data.models) ? data.models.length : '?';
  return `认证成功,可见 ${n} 个模型(GET /v1beta/models)`;
}

async function testProvider(p) {
  const started = Date.now();
  const base = String(p.baseUrl || '').replace(/\/+$/, '');
  let ok = false;
  let detail = '';
  let httpStatus = null;
  try {
    if (!/^https?:\/\//.test(base)) throw new Error('Base URL 必须以 http(s):// 开头');
    const testers = { anthropic: testAnthropic, openai: testOpenAI, gemini: testGemini };
    detail = await testers[TARGETS[p.target].protocol](base, p);
    ok = true;
  } catch (e) {
    detail = e.name === 'TimeoutError' ? '请求超时(15s)' : e.message;
    httpStatus = e.status || null;
  }
  const result = { ok, latencyMs: Date.now() - started, detail, httpStatus, testedAt: new Date().toISOString() };
  Object.assign(p, {
    lastTest: { ok: result.ok, latencyMs: result.latencyMs, detail: result.detail, testedAt: result.testedAt },
  });
  await saveStore();
  return result;
}

/* ---------------- 预览(不写盘,只生成将要写入的内容) ---------------- */

async function previewProvider(p) {
  const files = [];
  if (p.target === 'claude') {
    files.push({
      path: claudeSettingsFile(),
      lang: 'json',
      action: '合并写入(仅增改 env 中以下键,其余设置保留;若原 env 有 ANTHROPIC_API_KEY 将被移除)',
      snippet: JSON.stringify({ env: buildClaudeEnv(p) }, null, 2),
    });
  } else if (p.target === 'codex') {
    const { toml, auth } = codexFiles();
    files.push({ path: toml, lang: 'toml', action: '管理块插入文件顶部(插入前移除旧管理块与顶层 model 键),其余配置保留', snippet: buildCodexBlock(p) });
    files.push({ path: auth, lang: 'json', action: '合并写入 OPENAI_API_KEY,其余键保留', snippet: JSON.stringify({ OPENAI_API_KEY: p.apiKey }, null, 2) });
  } else {
    files.push({
      path: geminiEnvFile(),
      lang: 'env',
      action: '按行 upsert,其余行保留',
      snippet: Object.entries(buildGeminiLines(p)).map(([k, v]) => k + '=' + v).join('\n'),
    });
  }
  return { target: p.target, label: TARGETS[p.target].label, files };
}

/* ---------------- 状态汇总(读各 CLI 的实时配置) ---------------- */

function matchProvider(target, baseUrl, apiKey) {
  if (!baseUrl) return null;
  return (
    store.providers.find((x) => x.target === target && x.baseUrl === baseUrl && x.apiKey === apiKey) ||
    store.providers.find((x) => x.target === target && x.baseUrl === baseUrl) ||
    null
  );
}

async function statusOverview() {
  const out = [];
  const claudeLive = readClaudeLive();
  const codexLive = readCodexLive();
  const geminiLive = readGeminiLive();

  const item = (target, live, extra = {}) => {
    const matched = matchProvider(target, live.baseUrl, live.apiKey);
    return {
      target,
      label: TARGETS[target].label,
      configExists: !!live.exists,
      liveBaseUrl: live.baseUrl || null,
      managedByHub: !!(matched && store.active[target] === matched.id) || !!live.managedByHub,
      activeProviderId: store.active[target] || null,
      activeProviderName: matched ? matched.name : null,
      parseError: !!live.parseError,
      ...extra,
    };
  };

  out.push(item('claude', claudeLive, { file: claudeLive.file }));
  out.push(item('codex', codexLive, { file: codexLive.file, authFile: codexLive.authFile }));
  out.push(item('gemini', geminiLive, { file: geminiLive.file }));
  return out;
}

/* ---------------- HTTP 服务 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validateProvider(input) {
  const p = {
    id: input.id || newId(),
    target: input.target,
    name: String(input.name || '').trim(),
    baseUrl: String(input.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(input.apiKey || ''),
    model: String(input.model || '').trim(),
    wireApi: input.target === 'codex' && input.wireApi === 'responses' ? 'responses' : 'chat',
    note: String(input.note || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
    lastTest: input.lastTest || null,
  };
  if (!TARGETS[p.target]) throw new Error('未知的目标 CLI: ' + p.target);
  if (!p.name) throw new Error('名称不能为空');
  if (!/^https?:\/\/.+/.test(p.baseUrl)) throw new Error('Base URL 必须以 http(s):// 开头');
  return p;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);

  /* ----- API ----- */
  if (parts[0] === 'api') {
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await statusOverview());
    if (req.method === 'GET' && url.pathname === '/api/providers') return send(res, 200, store.providers);

    if (req.method === 'POST' && url.pathname === '/api/providers') {
      const p = validateProvider(JSON.parse(await readBody(req)));
      store.providers.push(p);
      await saveStore();
      return send(res, 201, p);
    }

    if (parts[1] === 'providers' && parts[2]) {
      const p = store.providers.find((x) => x.id === parts[2]);
      if (!p) return send(res, 404, { error: '供应商不存在' });

      if (req.method === 'PUT' && parts[3] === undefined) {
        const next = validateProvider({ ...JSON.parse(await readBody(req)), id: p.id, createdAt: p.createdAt, lastTest: p.lastTest });
        Object.assign(p, next);
        await saveStore();
        return send(res, 200, p);
      }
      if (req.method === 'DELETE' && parts[3] === undefined) {
        store.providers = store.providers.filter((x) => x.id !== p.id);
        for (const t of Object.keys(store.active)) if (store.active[t] === p.id) store.active[t] = null;
        await saveStore();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[3] === 'activate') {
        const written = await writeTarget(p.target, p);
        return send(res, 200, { ok: true, written, provider: { id: p.id, name: p.name, target: p.target } });
      }
      if (req.method === 'POST' && parts[3] === 'test') return send(res, 200, await testProvider(p));
      if (req.method === 'GET' && parts[3] === 'preview') return send(res, 200, await previewProvider(p));
    }

    if (req.method === 'POST' && parts[1] === 'targets' && parts[2] && parts[3] === 'reset') {
      const target = parts[2];
      if (!TARGETS[target]) return send(res, 404, { error: '未知目标' });
      const r = await resetTarget(target);
      return send(res, 200, { ok: true, reset: r });
    }

    return send(res, 404, { error: '接口不存在' });
  }

  /* ----- 静态文件 ----- */
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store', // 面板迭代频繁,避免浏览器缓存旧版页面
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

(async () => {
  await loadStore();
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      console.error('[api-hub]', e.message);
      if (!res.headersSent) send(res, e.statusCode || 400, { error: e.message });
      else res.end();
    });
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Agent API Hub 已启动: http://127.0.0.1:${PORT}`);
    console.log(`用户主目录(配置写入位置): ${HOME}`);
    console.log(`供应商数据文件: ${STORE_FILE}`);
  });
})();

// 可选:随面板一起启动本地代理网关(--proxy 或环境变量 APIHUB_PROXY=1)
if (process.argv.includes('--proxy') || process.env.APIHUB_PROXY === '1') {
  const { startProxy } = require('./proxy');
  startProxy({ port: Number(process.env.APIHUB_PROXY_PORT || 8321), dataDir: DATA_DIR });
}
