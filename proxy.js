'use strict';
/**
 * 本地代理网关(cc-switch Proxy 模式复刻,第三轮:故障转移)
 *
 * CLI 把 Base URL 指向 http://127.0.0.1:8321,本网关按路径把请求转发到
 * 各 target 当前"激活"的供应商(只读 providers.json,每请求重新读取):
 *   /v1/messages        → claude(Anthropic 协议)
 *   /v1/*               → codex(OpenAI 协议)
 *   /v1beta/*           → gemini
 * 故障转移:激活供应商连接失败或返回 5xx 时,自动依次尝试该 target 的
 * 其他供应商,直到成功或用尽(最后一个候选的 5xx 原样透传给客户端)。
 * 响应(含 SSE)边收边透传;完成后把状态码/延迟/token 用量/尝试次数
 * 串行化追加到 data/usage.json。
 *
 * 红线:本文件永不写任何 CLI 配置文件,只读本工具自己的供应商数据。
 *
 * 运行:node proxy.js(独立进程)或 node server.js --proxy(随面板一起)
 * 环境变量:APIHUB_PROXY_PORT(默认 8321)、APIHUB_DATA_DIR(默认 ./data)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const USAGE_MAX = 1000;

function json(res, code, data, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(data));
}

async function loadStore(dataDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dataDir, 'providers.json'), 'utf8'));
  } catch {
    return { providers: [], active: { claude: null, codex: null, gemini: null } };
  }
}

function resolveTarget(pathname) {
  if (pathname === '/v1/messages' || pathname.startsWith('/v1/messages/')) return 'claude';
  if (pathname.startsWith('/v1beta')) return 'gemini';
  if (pathname.startsWith('/v1/')) return 'codex';
  return null;
}

// codex 的 baseUrl 约定带 /v1 结尾,claude/gemini 是根地址;统一去掉尾部 /v1 再拼完整路径
function upstreamUrl(baseUrl, reqUrl) {
  const root = String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');
  return root + reqUrl;
}

function applyAuthHeaders(headers, provider, target) {
  const key = provider.apiKey || '';
  if (target === 'claude') {
    headers['x-api-key'] = key;
    headers['authorization'] = 'Bearer ' + key; // 兼容把官方 Key 挂在网关后的中转站
  } else if (target === 'gemini') {
    headers['x-goog-api-key'] = key;
    delete headers.authorization;
  } else {
    headers.authorization = 'Bearer ' + key;
    delete headers['x-api-key'];
  }
}

// 从响应体提取 usage:普通 JSON 直接取;SSE 取最后一条带 usage 的 data 行
function extractUsage(buf, contentType) {
  const text = buf.toString('utf8');
  if (String(contentType).includes('text/event-stream')) {
    let found = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^data:\s*(\{.*\})\s*$/);
      if (m && m[1].includes('"usage"')) {
        try {
          const parsed = JSON.parse(m[1]);
          if (parsed.usage) found = parsed.usage;
        } catch { /* 跳过残缺行 */ }
      }
    }
    return found;
  }
  try {
    return JSON.parse(text).usage || null;
  } catch {
    return null;
  }
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    promptTokens: n(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: n(usage.completion_tokens ?? usage.output_tokens),
  };
}

let usageQueue = Promise.resolve(); // 串行化读-改-写,避免并发日志互相覆盖

function logUsage(dataDir, entry) {
  usageQueue = usageQueue
    .then(async () => {
      const file = path.join(dataDir, 'usage.json');
      let list = [];
      try {
        list = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (!Array.isArray(list)) list = [];
      } catch { /* 首次写入 */ }
      list.unshift(entry);
      await fsp.writeFile(file, JSON.stringify(list.slice(0, USAGE_MAX), null, 2), 'utf8');
    })
    .catch(() => { /* 日志失败不影响转发 */ });
  return usageQueue;
}

async function readUsageCount(dataDir) {
  try {
    const list = JSON.parse(await fsp.readFile(path.join(dataDir, 'usage.json'), 'utf8'));
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

// 发起一次上游请求;结果二选一:{ upRes } 或 { error }。单次尝试 30s 超时,防止挂起的上游卡死转发
function attemptUpstream(url, { method, headers, body, timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    const mod = url.protocol === 'https:' ? https : http;
    const up = mod.request(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) }, (upRes) => resolve({ upRes }));
    up.on('error', (e) => resolve({ error: e }));
    if (body && body.length) up.write(body);
    up.end();
  });
}

// 转发候选:激活供应商优先,其余同 target 供应商按原顺序殿后
function buildCandidates(store, target) {
  const all = (store.providers || []).filter((p) => p.target === target);
  const activeId = store.active && store.active[target];
  const active = all.find((p) => p.id === activeId);
  if (!active) return { candidates: all, activeUsed: false };
  return { candidates: [active, ...all.filter((p) => p.id !== activeId)], activeUsed: true };
}

function startProxy({ port = 8321, dataDir = path.join(__dirname, 'data'), host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    (async () => {
      const started = Date.now();
      const pathname = (req.url || '/').split('?')[0];

      if (pathname === '/proxy-health') {
        // 仪表盘探测代理是否在线;带 CORS 允许跨端口访问
        return json(res, 200, { ok: true, requests: await readUsageCount(dataDir) }, { 'access-control-allow-origin': '*' });
      }

      const target = resolveTarget(pathname);
      const reqChunks = [];
      for await (const c of req) reqChunks.push(c);
      const body = Buffer.concat(reqChunks);

      if (!target) {
        return json(res, 404, { error: { message: 'Unknown path: ' + pathname + ' (/v1/*, /v1/messages, /v1beta/*)' } });
      }

      let model = null;
      try {
        model = JSON.parse(body.toString('utf8') || '{}').model || null;
      } catch { /* 非 JSON 体 */ }

      const store = await loadStore(dataDir);
      const { candidates, activeUsed } = buildCandidates(store, target);
      if (candidates.length === 0) {
        const entry = { time: new Date().toISOString(), target, providerId: null, providerName: null, path: pathname, model, status: 503, latencyMs: Date.now() - started, usage: null };
        await logUsage(dataDir, entry);
        return json(res, 503, { error: { message: `No active provider for target "${target}". 请在 Agent API Hub 面板启用一个供应商` } });
      }

      let lastError = 'all providers failed';
      let failoverFrom = null;
      let attempts = 0;

      for (const cand of candidates) {
        attempts++;
        const url = new URL(upstreamUrl(cand.baseUrl, req.url));
        const headers = { ...req.headers, host: url.host };
        delete headers.cookie;
        applyAuthHeaders(headers, cand, target);

        const out = await attemptUpstream(url, { method: req.method, headers, body });

        if (out.error) {
          lastError = out.error.message;
          if (!failoverFrom) failoverFrom = cand.id;
          continue; // 连接失败,试下一个候选
        }

        if ((out.upRes.statusCode || 500) >= 500 && attempts < candidates.length) {
          // 5xx 且还有候选:丢弃该响应继续转移(SSE 场景头已 200,不会走到这里)
          out.upRes.resume();
          if (!failoverFrom) failoverFrom = cand.id;
          continue;
        }

        // 成功(或最后一个候选原样透传):边收边转发
        res.writeHead(out.upRes.statusCode || 502, out.upRes.headers);
        const respChunks = [];
        out.upRes.on('data', (c) => {
          respChunks.push(c);
          res.write(c);
        });
        out.upRes.on('end', async () => {
          res.end();
          const usage = normalizeUsage(extractUsage(Buffer.concat(respChunks), out.upRes.headers['content-type']));
          await logUsage(dataDir, {
            time: new Date().toISOString(),
            target,
            providerId: cand.id,
            providerName: cand.name,
            path: pathname,
            model,
            status: out.upRes.statusCode || 502,
            latencyMs: Date.now() - started,
            usage,
            attempts,
            ...(failoverFrom ? { failoverFrom } : {}),
          });
        });
        out.upRes.on('error', () => res.end());
        return;
      }

      // 所有候选都失败
      await logUsage(dataDir, {
        time: new Date().toISOString(),
        target,
        providerId: null,
        providerName: null,
        path: pathname,
        model,
        status: 502,
        latencyMs: Date.now() - started,
        usage: null,
        attempts,
        error: lastError,
        ...(failoverFrom ? { failoverFrom } : {}),
      });
      json(res, 502, { error: { message: 'All providers failed: ' + lastError } });
    })().catch((e) => {
      if (!res.headersSent) json(res, 500, { error: { message: e.message } });
      else res.end();
    });
  });

  server.on('error', (e) => {
    console.error('[proxy] 启动失败:', e.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`[proxy] 本地代理网关已启动: http://${host}:${port} → 按路径转发到激活供应商(支持故障转移)`);
  });
  return server;
}

if (require.main === module) {
  startProxy({
    port: Number(process.env.APIHUB_PROXY_PORT || 8321),
    dataDir: process.env.APIHUB_DATA_DIR || path.join(__dirname, 'data'),
  });
}

module.exports = { startProxy, resolveTarget, upstreamUrl, extractUsage, normalizeUsage };
