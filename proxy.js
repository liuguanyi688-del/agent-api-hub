'use strict';
/**
 * 本地代理网关(cc-switch Proxy 模式复刻,第一轮:转发 + SSE 透传 + 用量日志)
 *
 * CLI 把 Base URL 指向 http://127.0.0.1:8321,本网关按路径把请求转发到
 * 各 target 当前"激活"的供应商(只读 providers.json,每请求重新读取):
 *   /v1/messages        → claude(Anthropic 协议)
 *   /v1/*               → codex(OpenAI 协议)
 *   /v1beta/*           → gemini
 * 响应(含 SSE)边收边透传;完成后把状态码/延迟/token 用量追加到 data/usage.json。
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

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
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

function startProxy({ port = 8321, dataDir = path.join(__dirname, 'data'), host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    (async () => {
      const started = Date.now();
      const pathname = (req.url || '/').split('?')[0];
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
      const activeId = store.active && store.active[target];
      const provider = (store.providers || []).find((p) => p.id === activeId);
      if (!provider) {
        const noActive = {
          time: new Date().toISOString(),
          target,
          providerId: null,
          providerName: null,
          path: pathname,
          model,
          status: 503,
          latencyMs: Date.now() - started,
          usage: null,
        };
        await logUsage(dataDir, noActive);
        return json(res, 503, { error: { message: `No active provider for target "${target}". 请在 Agent API Hub 面板启用一个供应商` } });
      }

      const url = new URL(upstreamUrl(provider.baseUrl, req.url));
      const headers = { ...req.headers, host: url.host };
      delete headers.cookie;
      applyAuthHeaders(headers, provider, target);

      const mod = url.protocol === 'https:' ? https : http;
      await new Promise((resolve) => {
        const up = mod.request(url, { method: req.method, headers }, (upRes) => {
          res.writeHead(upRes.statusCode || 502, upRes.headers);
          const respChunks = [];
          upRes.on('data', (c) => {
            respChunks.push(c);
            res.write(c); // SSE / 普通响应统一边收边透传
          });
          upRes.on('end', async () => {
            res.end();
            const usage = normalizeUsage(extractUsage(Buffer.concat(respChunks), upRes.headers['content-type']));
            await logUsage(dataDir, {
              time: new Date().toISOString(),
              target,
              providerId: provider.id,
              providerName: provider.name,
              path: pathname,
              model,
              status: upRes.statusCode || 502,
              latencyMs: Date.now() - started,
              usage,
            });
            resolve();
          });
          upRes.on('error', () => {
            res.end();
            resolve();
          });
        });
        up.on('error', async (e) => {
          logUsage(dataDir, {
            time: new Date().toISOString(),
            target,
            providerId: provider.id,
            providerName: provider.name,
            path: pathname,
            model,
            status: 502,
            latencyMs: Date.now() - started,
            usage: null,
            error: e.message,
          });
          json(res, 502, { error: { message: 'Upstream error: ' + e.message } });
          resolve();
        });
        if (body.length) up.write(body);
        up.end();
      });
    })().catch((e) => {
      if (!res.headersSent) json(res, 500, { error: { message: e.message } });
      else res.end();
    });
  });

  server.listen(port, host, () => {
    console.log(`[proxy] 本地代理网关已启动: http://${host}:${port} → 按路径转发到激活供应商`);
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
