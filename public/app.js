/* Agent API Hub 前端逻辑(原生 JS,无构建步骤) */
'use strict';

const state = { providers: [], status: [], filter: 'all', editingId: null };

const TARGET_LABEL = { claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' };
const BASE_HINT = {
  claude: '填根地址(不要带 /v1),CLI 会自动拼 /v1/messages。例:https://api.anthropic.com 或中转站根地址',
  codex: '通常以 /v1 结尾。例:https://api.openai.com/v1 或中转站给的 OpenAI 兼容地址',
  gemini: '例:https://generativelanguage.googleapis.com(CLI 自动拼 /v1beta/...)',
};

/* ---------------- 工具 ---------------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function maskKey(key) {
  if (!key) return '(空)';
  if (key.length <= 10) return key.slice(0, 3) + '****';
  return key.slice(0, 6) + '****' + key.slice(-4);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('已复制到剪贴板', 'ok'),
    () => toast('复制失败,请手动选择复制', 'err'),
  );
}

function confirmBox(title, html) {
  return new Promise((resolve) => {
    $('#confirmTitle').textContent = title;
    $('#confirmText').innerHTML = html;
    openModal('confirmModal');
    const yes = $('#confirmYes');
    const no = $('#confirmNo');
    const done = (v) => {
      closeModal('confirmModal');
      yes.onclick = no.onclick = null;
      resolve(v);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

const openModal = (id) => $('#' + id).classList.remove('hidden');
const closeModal = (id) => $('#' + id).classList.add('hidden');

document.querySelectorAll('[data-close]').forEach((el) => (el.onclick = () => closeModal(el.dataset.close)));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => e.target === m && m.classList.add('hidden')));

/* ---------------- 渲染 ---------------- */

async function refresh() {
  [state.providers, state.status] = await Promise.all([api('/api/providers'), api('/api/status')]);
  render();
}

function render() {
  renderChips();
  renderTabs();
  renderGrid();
}

function renderChips() {
  $('#statusChips').innerHTML = state.status
    .map((s) => {
      const on = s.managedByHub && s.activeProviderName;
      const who = on
        ? esc(s.activeProviderName)
        : s.liveBaseUrl
          ? '手动/外部配置'
          : s.configExists
            ? '默认配置'
            : '未配置';
      const title = [
        s.file + (s.authFile ? ' + ' + s.authFile : ''),
        s.liveBaseUrl ? '当前上游:' + s.liveBaseUrl : '当前上游:官方默认',
        '点击查看该目标的供应商',
      ].join('\n');
      return `<div class="chip ${on ? 'on ' : ''}${s.target}" title="${esc(title)}" data-filter="${s.target}">
        <span class="dot"></span><b>${TARGET_LABEL[s.target]}</b><span class="who">${who}</span>
        <button class="reset" data-reset="${s.target}" title="移除本工具写入的配置,恢复 CLI 默认">↺</button>
      </div>`;
    })
    .join('');

  document.querySelectorAll('#statusChips .chip').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.reset) return;
      setFilter(el.dataset.filter);
    };
  });
  document.querySelectorAll('#statusChips [data-reset]').forEach((el) => {
    el.onclick = () => resetTarget(el.dataset.reset);
  });
}

function renderTabs() {
  const tabs = [
    ['all', '全部'],
    ['claude', 'Claude Code'],
    ['codex', 'Codex CLI'],
    ['gemini', 'Gemini CLI'],
  ];
  $('#tabs').innerHTML = tabs
    .map(([id, label]) => `<button class="tab ${state.filter === id ? 'on' : ''}" data-tab="${id}">${label}</button>`)
    .join('');
  document.querySelectorAll('#tabs .tab').forEach((el) => (el.onclick = () => setFilter(el.dataset.tab)));
}

function setFilter(f) {
  state.filter = f;
  render();
}

function testLine(p) {
  const t = p.lastTest;
  if (!t) return '';
  const when = new Date(t.testedAt).toLocaleString('zh-CN', { hour12: false });
  const cls = t.ok ? 'ok' : 'err';
  const mark = t.ok ? '✓' : '✗';
  return `<div class="test-line ${cls}" title="测试于 ${esc(when)}">${mark} ${esc(t.detail)} <span class="lat">· ${t.latencyMs}ms</span></div>`;
}

function renderGrid() {
  const list = state.providers.filter((p) => state.filter === 'all' || p.target === state.filter);
  $('#empty').classList.toggle('hidden', state.providers.length > 0);

  $('#grid').innerHTML = list
    .map((p) => {
      const isActive = state.status.find((s) => s.target === p.target)?.activeProviderId === p.id && state.status.find((s) => s.target === p.target)?.managedByHub;
      return `<article class="card ${isActive ? 'active' : ''}">
        <div class="card-head">
          <span class="badge ${p.target}">${TARGET_LABEL[p.target]}</span>
          <span class="card-name" title="${esc(p.name)}">${esc(p.name)}</span>
          ${isActive ? '<span class="badge live">当前使用</span>' : ''}
        </div>
        <div class="kv"><span class="k">Base URL</span><span class="v">${esc(p.baseUrl)}</span></div>
        <div class="kv"><span class="k">Key</span><span class="v">${esc(maskKey(p.apiKey))}</span></div>
        ${p.model ? `<div class="kv"><span class="k">模型</span><span class="v">${esc(p.model)}</span></div>` : ''}
        ${p.target === 'codex' ? `<div class="kv"><span class="k">接口</span><span class="v">wire_api = ${esc(p.wireApi)}</span></div>` : ''}
        ${p.note ? `<div class="kv"><span class="k">备注</span><span class="v">${esc(p.note)}</span></div>` : ''}
        ${testLine(p)}
        <div class="card-foot">
          ${isActive ? '' : `<button class="btn primary small" data-act="activate" data-id="${p.id}">启用</button>`}
          <button class="btn small" data-act="test" data-id="${p.id}">测试</button>
          <button class="btn small" data-act="preview" data-id="${p.id}">预览</button>
          <span class="spacer"></span>
          <button class="btn ghost small" data-act="edit" data-id="${p.id}">编辑</button>
          <button class="btn ghost small" data-act="delete" data-id="${p.id}">删除</button>
        </div>
      </article>`;
    })
    .join('');
}

/* 事件委托:卡片按钮 */
$('#grid').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const p = state.providers.find((x) => x.id === btn.dataset.id);
  if (!p) return;
  const act = btn.dataset.act;
  try {
    if (act === 'activate') {
      const preview = await api(`/api/providers/${p.id}/preview`);
      const fileList = preview.files.map((f) => `<code>${esc(f.path)}</code>`).join('、');
      const ok = await confirmBox(
        `启用「${esc(p.name)}」?`,
        `将合并写入:${fileList}<br/>写入前会自动备份原文件为 <code>*.apihub.bak</code>,其他已有配置保留。`,
      );
      if (!ok) return;
      btn.disabled = true;
      await api(`/api/providers/${p.id}/activate`, { method: 'POST' });
      toast(`已启用:${TARGET_LABEL[p.target]} 现在指向「${p.name}」。若 CLI 正在运行,请重启会话生效`, 'ok');
    } else if (act === 'test') {
      btn.disabled = true;
      btn.textContent = '测试中…';
      const r = await api(`/api/providers/${p.id}/test`, { method: 'POST' });
      toast(r.ok ? `✓ ${r.detail}(${r.latencyMs}ms)` : `✗ ${r.detail}`, r.ok ? 'ok' : 'err');
    } else if (act === 'preview') {
      await openPreview(p.id);
    } else if (act === 'edit') {
      openEdit(p);
    } else if (act === 'delete') {
      const ok = await confirmBox('删除供应商?', `仅从面板移除「${esc(p.name)}」,不会改写 CLI 配置文件。`);
      if (!ok) return;
      await api(`/api/providers/${p.id}`, { method: 'DELETE' });
      toast('已删除', 'ok');
    }
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
    await refresh().catch(() => {});
  }
});

/* ---------------- 恢复默认 ---------------- */

async function resetTarget(target) {
  const ok = await confirmBox(
    `恢复 ${TARGET_LABEL[target]} 官方默认?`,
    '将移除本工具写入该 CLI 配置文件中的键(原文件已备份为 <code>*.apihub.bak</code>)。你自己手动加的其他配置不受影响。',
  );
  if (!ok) return;
  await api(`/api/targets/${target}/reset`, { method: 'POST' });
  toast(`${TARGET_LABEL[target]} 已恢复默认`, 'ok');
  await refresh();
}

/* ---------------- 新增 / 编辑 ---------------- */

function openEdit(p) {
  state.editingId = p ? p.id : null;
  $('#editTitle').textContent = p ? '编辑供应商' : '添加供应商';
  $('#f_target').value = p ? p.target : 'claude';
  $('#f_name').value = p ? p.name : '';
  $('#f_baseUrl').value = p ? p.baseUrl : '';
  $('#f_apiKey').value = p ? p.apiKey : '';
  $('#f_model').value = p ? p.model || '' : '';
  $('#f_wireApi').value = p ? p.wireApi || 'chat' : 'chat';
  $('#f_note').value = p ? p.note || '' : '';
  updateFormHints();
  openModal('editModal');
  $('#f_name').focus();
}

function updateFormHints() {
  const t = $('#f_target').value;
  $('#f_baseHint').textContent = BASE_HINT[t];
  $('#f_wireRow').style.display = t === 'codex' ? '' : 'none';
}

$('#f_target').addEventListener('change', updateFormHints);
$('#toggleKey').onclick = () => {
  const input = $('#f_apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggleKey').textContent = show ? '隐藏' : '显示';
};

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    target: $('#f_target').value,
    name: $('#f_name').value,
    baseUrl: $('#f_baseUrl').value,
    apiKey: $('#f_apiKey').value,
    model: $('#f_model').value,
    wireApi: $('#f_wireApi').value,
    note: $('#f_note').value,
  };
  try {
    if (state.editingId) await api(`/api/providers/${state.editingId}`, { method: 'PUT', body });
    else await api('/api/providers', { method: 'POST', body });
    closeModal('editModal');
    toast('已保存', 'ok');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ---------------- 预览 ---------------- */

async function openPreview(id) {
  const data = await api(`/api/providers/${id}/preview`);
  $('#previewBody').innerHTML = data.files
    .map(
      (f) => `<div class="preview-file">
        <div class="file-path"><span>${esc(f.path)}</span><button class="btn ghost small" data-copy="${esc(f.path)}">复制路径</button></div>
        <div class="action">${esc(f.action)}</div>
        <pre>${esc(f.snippet)}</pre>
      </div>`,
    )
    .join('');
  $('#previewBody').querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copyText(el.dataset.copy)));
  openModal('previewModal');
}

/* ---------------- 启动 ---------------- */

$('#addBtn').onclick = () => openEdit(null);
refresh().catch((e) => toast('加载失败:' + e.message, 'err'));
setInterval(() => api('/api/status').then((s) => ((state.status = s), renderChips())).catch(() => {}), 15000);
