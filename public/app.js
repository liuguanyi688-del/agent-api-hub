/* Agent API Hub 前端逻辑(原生 JS,无构建步骤;文案经 i18n.js 的 t() 输出) */
'use strict';

const state = {
  providers: [], status: [], search: '', filterTarget: 'all', filterStatus: 'all', editingId: null, view: 'dash',
  usage: null, usageFilter: 'all',
  page: 1,
  pageSize: Number(localStorage.getItem('apihub-page-size')) || 20,
  hiddenCols: (() => { try { return JSON.parse(localStorage.getItem('apihub-hidden-cols') || '[]'); } catch { return []; } })(),
};

const TARGET_LABEL = { claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' };

/* 可隐藏的表格列(操作列恒显);显隐与分页偏好存 localStorage */
const COLUMNS = [
  { id: 'name', i18n: 'thName' },
  { id: 'target', i18n: 'thTarget' },
  { id: 'baseUrl', i18n: 'thBaseUrl' },
  { id: 'key', i18n: 'thKey' },
  { id: 'status', i18n: 'thStatus' },
  { id: 'test', i18n: 'thTest' },
];
const saveHiddenCols = () => localStorage.setItem('apihub-hidden-cols', JSON.stringify(state.hiddenCols));
const savePageSize = () => localStorage.setItem('apihub-page-size', String(state.pageSize));

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
    () => toast(t('toastCopied'), 'ok'),
    () => toast(t('toastCopyFailed'), 'err'),
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

function activeIdOf(target) {
  const s = state.status.find((x) => x.target === target);
  return s && s.managedByHub ? s.activeProviderId : null;
}

function visibleProviders() {
  const q = state.search.trim().toLowerCase();
  return state.providers.filter((p) => {
    if (state.filterTarget !== 'all' && p.target !== state.filterTarget) return false;
    if (state.filterStatus === 'active' && activeIdOf(p.target) !== p.id) return false;
    if (state.filterStatus === 'idle' && activeIdOf(p.target) === p.id) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.baseUrl.toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  renderChips();
  renderTable();
  renderDash();
  if (state.usage) renderUsage();
}

/* ---------------- 使用记录(本地代理日志) ---------------- */

async function loadUsage() {
  try {
    state.usage = await api('/api/usage');
  } catch (e) {
    toast(e.message, 'err');
    state.usage = { total: 0, requests: [] };
  }
  renderUsage();
}

function renderUsage() {
  if (!state.usage) return;
  const all = state.usage.requests || [];
  const list = state.usageFilter === 'all' ? all : all.filter((x) => x.target === state.usageFilter);

  const okCount = list.filter((x) => x.status >= 200 && x.status < 400).length;
  const errCount = list.length - okCount;
  const tokSum = list.reduce((s, x) => s + (x.usage?.promptTokens || 0) + (x.usage?.completionTokens || 0), 0);
  const latList = list.filter((x) => typeof x.latencyMs === 'number');
  const avgLat = latList.length ? Math.round(latList.reduce((s, x) => s + x.latencyMs, 0) / latList.length) + 'ms' : '—';

  $('#usageStats').innerHTML = `
    <div class="stat-card"><div class="num">${list.length}</div><div class="lbl">${esc(t('usageTotal'))}</div></div>
    <div class="stat-card"><div class="num">${okCount}</div><div class="lbl">${esc(t('usageOk'))}</div></div>
    <div class="stat-card"><div class="num">${errCount}</div><div class="lbl">${esc(t('usageErr'))}</div></div>
    <div class="stat-card"><div class="num">${tokSum}</div><div class="lbl">${esc(t('usageTokens'))}</div></div>
    <div class="stat-card"><div class="num">${esc(avgLat)}</div><div class="lbl">${esc(t('usageAvgLatency'))}</div></div>`;

  const cols = [
    ['thTime', (x) => esc(new Date(x.time).toLocaleString('zh-CN', { hour12: false }))],
    ['thTarget', (x) => `<span class="badge ${x.target}">${TARGET_LABEL[x.target] || x.target}</span>`],
    ['thProvider', (x) => esc(x.providerName || '—')],
    ['thModel', (x) => esc(x.model || '—')],
    ['thPath', (x) => `<span class="cell-url">${esc(x.path)}</span>`],
    ['thStatus', (x) => `<span class="test-cell ${x.status >= 200 && x.status < 400 ? 'ok' : 'err'}">${x.status}</span>`],
    ['thLatency', (x) => (typeof x.latencyMs === 'number' ? x.latencyMs + 'ms' : '—')],
    ['thPrompt', (x) => (x.usage?.promptTokens ?? '—')],
    ['thCompletion', (x) => (x.usage?.completionTokens ?? '—')],
  ];
  $('#usageHead').innerHTML = cols.map(([k]) => `<th>${esc(t(k))}</th>`).join('');
  $('#usageBody').innerHTML = list.slice(0, 200).map((x) => `<tr>${cols.map(([, fn]) => `<td>${fn(x)}</td>`).join('')}</tr>`).join('');
  $('#usageEmpty').classList.toggle('hidden', list.length > 0);
}

function renderChips() {
  $('#statusChips').innerHTML = state.status
    .map((s) => {
      const on = s.managedByHub && s.activeProviderName;
      const who = on
        ? esc(s.activeProviderName)
        : s.liveBaseUrl
          ? esc(t('chipExternal'))
          : s.configExists
            ? esc(t('chipDefault'))
            : esc(t('chipUnset'));
      const upstream = s.liveBaseUrl
        ? t('chipTooltipUpstream', { url: s.liveBaseUrl })
        : t('chipTooltipUpstreamDefault');
      const title = [
        s.file + (s.authFile ? ' + ' + s.authFile : ''),
        upstream,
        t('chipTooltipFilter'),
      ].join('\n');
      return `<div class="chip ${on ? 'on ' : ''}${s.target}" title="${esc(title)}" data-filter="${s.target}">
        <span class="dot"></span><b>${TARGET_LABEL[s.target]}</b><span class="who">${who}</span>
        <button class="reset" data-reset="${s.target}" title="${esc(t('chipResetTitle'))}">↺</button>
      </div>`;
    })
    .join('');

  document.querySelectorAll('#statusChips .chip').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.reset) return;
      setFilterTarget(el.dataset.filter);
    };
  });
  document.querySelectorAll('#statusChips [data-reset]').forEach((el) => {
    el.onclick = () => resetTarget(el.dataset.reset);
  });
}

function setFilterTarget(v) {
  state.filterTarget = v;
  $('#filterTarget').value = v;
  render();
}

function testCell(p) {
  if (!p.lastTest) return `<span class="test-cell none" title="${esc(t('testUntested'))}">—</span>`;
  const tt = p.lastTest;
  const when = t('testPassedAt', { when: new Date(tt.testedAt).toLocaleString('zh-CN', { hour12: false }) });
  if (tt.ok) return `<span class="test-cell ok" title="${esc(when)} · ${esc(tt.detail)}">${esc(t('testOk', { ms: tt.latencyMs }))}</span>`;
  const short = tt.detail.length > 18 ? tt.detail.slice(0, 18) + '…' : tt.detail;
  return `<span class="test-cell err" title="${esc(when)} · ${esc(tt.detail)}">✗ ${esc(short)}</span>`;
}

function cellHtml(col, p) {
  switch (col.id) {
    case 'name':
      return `<td class="cell-name">${esc(p.name)}${p.note ? `<span class="note" title="${esc(p.note)}">${esc(p.note)}</span>` : ''}</td>`;
    case 'target':
      return `<td><span class="badge ${p.target}">${TARGET_LABEL[p.target]}</span></td>`;
    case 'baseUrl':
      return `<td><span class="cell-url" title="${esc(p.baseUrl)}">${esc(p.baseUrl)}</span></td>`;
    case 'key':
      return `<td><span class="cell-key"><span>${esc(maskKey(p.apiKey))}</span><button class="copy-key" data-act="copykey" data-id="${p.id}" title="${esc(t('copyKeyTitle'))}">⧉</button></span></td>`;
    case 'status':
      return `<td>${activeIdOf(p.target) === p.id ? `<span class="pill live">${esc(t('pillLive'))}</span>` : `<span class="pill idle">${esc(t('pillIdle'))}</span>`}</td>`;
    case 'test':
      return `<td>${testCell(p)}</td>`;
    default:
      return '<td></td>';
  }
}

function renderTable() {
  const list = visibleProviders();
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);
  const pageList = list.slice((state.page - 1) * state.pageSize, to);

  const cols = COLUMNS.filter((c) => !state.hiddenCols.includes(c.id));
  $('#theadRow').innerHTML = cols.map((c) => `<th data-i18n="${c.i18n}">${esc(t(c.i18n))}</th>`).join('') + `<th class="th-ops">${esc(t('thOps'))}</th>`;

  $('#tableEmpty').classList.toggle('hidden', state.providers.length > 0);
  $('#pageInfo').textContent = t('resultPage', { from, to, total });
  $('#pageInd').textContent = `${state.page} / ${pages}`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= pages;

  $('#tbody').innerHTML = pageList
    .map((p) => {
      const isActive = activeIdOf(p.target) === p.id;
      return `<tr class="${isActive ? 'active-row' : ''}" data-id="${p.id}">
        ${cols.map((c) => cellHtml(c, p)).join('')}
        <td class="td-ops">
          ${isActive ? '' : `<button class="btn primary small" data-act="activate" data-id="${p.id}">${esc(t('btnEnable'))}</button>`}
          <button class="btn small" data-act="test" data-id="${p.id}">${esc(t('btnTest'))}</button>
          <button class="btn small" data-act="preview" data-id="${p.id}">${esc(t('btnPreview'))}</button>
          <button class="btn ghost small" data-act="copyurl" data-id="${p.id}" title="${esc(t('copyUrlTitle'))}">🔗</button>
          <button class="btn ghost small" data-act="edit" data-id="${p.id}">${esc(t('btnEdit'))}</button>
          <button class="btn danger small" data-act="delete" data-id="${p.id}">${esc(t('btnDelete'))}</button>
        </td>
      </tr>`;
    })
    .join('');
}

/* 事件委托:表格按钮 */
$('#tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const p = state.providers.find((x) => x.id === btn.dataset.id);
  if (!p) return;
  const act = btn.dataset.act;
  try {
    if (act === 'copykey') {
      copyText(p.apiKey || '');
      return;
    }
    if (act === 'copyurl') {
      copyText(p.baseUrl);
      return;
    }
    if (act === 'activate') {
      const preview = await api(`/api/providers/${p.id}/preview`);
      const fileList = preview.files.map((f) => `<code>${esc(f.path)}</code>`).join('、');
      const ok = await confirmBox(t('confirmEnableTitle', { name: esc(p.name) }), t('confirmEnableBody', { files: fileList }));
      if (!ok) return;
      btn.disabled = true;
      await api(`/api/providers/${p.id}/activate`, { method: 'POST' });
      logEvent(t('evtActivated', { name: p.name, target: TARGET_LABEL[p.target] }));
      toast(t('toastActivated', { target: TARGET_LABEL[p.target], name: p.name }), 'ok');
    } else if (act === 'test') {
      btn.disabled = true;
      btn.textContent = t('testing');
      const r = await api(`/api/providers/${p.id}/test`, { method: 'POST' });
      logEvent(r.ok ? t('evtTestOk', { name: p.name, ms: r.latencyMs }) : t('evtTestErr', { name: p.name, detail: r.detail }));
      toast(r.ok ? `✓ ${r.detail}(${r.latencyMs}ms)` : `✗ ${r.detail}`, r.ok ? 'ok' : 'err');
    } else if (act === 'preview') {
      await openPreview(p.id);
    } else if (act === 'edit') {
      openEdit(p);
    } else if (act === 'delete') {
      const ok = await confirmBox(t('confirmDeleteTitle'), t('confirmDeleteBody', { name: esc(p.name) }));
      if (!ok) return;
      await api(`/api/providers/${p.id}`, { method: 'DELETE' });
      logEvent(t('evtDeleted', { name: p.name }));
      toast(t('toastDeleted'), 'ok');
    }
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
    await refresh().catch(() => {});
  }
});

/* ---------------- 搜索 / 筛选 / 刷新 ---------------- */

$('#searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  state.page = 1;
  renderTable();
});
$('#filterTarget').addEventListener('change', (e) => {
  state.filterTarget = e.target.value;
  state.page = 1;
  renderTable();
});
$('#filterStatus').addEventListener('change', (e) => {
  state.filterStatus = e.target.value;
  state.page = 1;
  renderTable();
});

/* ---------------- 分页 / 列设置 ---------------- */

$('#pageSizeSel').addEventListener('change', (e) => {
  state.pageSize = Number(e.target.value) || 20;
  state.page = 1;
  savePageSize();
  renderTable();
});
$('#prevPage').addEventListener('click', () => {
  state.page -= 1;
  renderTable();
});
$('#nextPage').addEventListener('click', () => {
  state.page += 1;
  renderTable();
});

function buildColMenu() {
  $('#colMenu').innerHTML = COLUMNS.map(
    (c) => `<label><input type="checkbox" data-col="${c.id}" ${state.hiddenCols.includes(c.id) ? '' : 'checked'} /> ${esc(t(c.i18n))}</label>`,
  ).join('');
  $('#colMenu').querySelectorAll('input[data-col]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.col;
      state.hiddenCols = cb.checked ? state.hiddenCols.filter((x) => x !== id) : [...state.hiddenCols, id];
      saveHiddenCols();
      renderTable();
    });
  });
}
$('#colBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  buildColMenu();
  $('#colMenu').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.col-settings')) $('#colMenu').classList.add('hidden');
});
$('#pageSizeSel').value = String(state.pageSize);
$('#refreshBtn').onclick = async () => {
  await refresh().catch((e) => toast(t('toastRefreshFailed', { msg: e.message }), 'err'));
  toast(t('toastRefreshed'), 'ok');
};

/* ---------------- 恢复默认 ---------------- */

async function resetTarget(target) {
  const ok = await confirmBox(t('resetTitle', { target: TARGET_LABEL[target] }), t('resetBody'));
  if (!ok) return;
  await api(`/api/targets/${target}/reset`, { method: 'POST' });
  logEvent(t('evtReset', { target: TARGET_LABEL[target] }));
  toast(t('toastResetDone', { target: TARGET_LABEL[target] }), 'ok');
  await refresh();
}

/* ---------------- 新增 / 编辑 ---------------- */

function openEdit(p) {
  state.editingId = p ? p.id : null;
  $('#editTitle').textContent = p ? t('modalEdit') : t('modalAdd');
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
  const tKey = { claude: 'hintBaseClaude', codex: 'hintBaseCodex', gemini: 'hintBaseGemini' }[$('#f_target').value];
  $('#f_baseHint').textContent = t(tKey);
  $('#f_wireRow').style.display = $('#f_target').value === 'codex' ? '' : 'none';
}

$('#f_target').addEventListener('change', updateFormHints);
$('#toggleKey').onclick = () => {
  const input = $('#f_apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#toggleKey').textContent = show ? t('btnHide') : t('btnShow');
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
    logEvent(t('evtSaved', { name: body.name }));
    toast(t('toastSaved'), 'ok');
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
        <div class="file-path"><span>${esc(f.path)}</span><button class="btn ghost small" data-copy="${esc(f.path)}">${esc(t('btnCopyPath'))}</button></div>
        <div class="action">${esc(f.action)}</div>
        <pre>${esc(f.snippet)}</pre>
      </div>`,
    )
    .join('');
  $('#previewBody').querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copyText(el.dataset.copy)));
  openModal('previewModal');
}

/* ---------------- 通知中心(本地事件,localStorage 上限 50 条) ---------------- */

const EVENTS_MAX = 50;

function loadEvents() {
  try {
    return JSON.parse(localStorage.getItem('apihub-events') || '[]');
  } catch {
    return [];
  }
}

function logEvent(text) {
  const list = loadEvents();
  list.unshift({ text, time: Date.now() });
  localStorage.setItem('apihub-events', JSON.stringify(list.slice(0, EVENTS_MAX)));
  const unread = Math.min((Number(localStorage.getItem('apihub-events-unread')) || 0) + 1, 99);
  localStorage.setItem('apihub-events-unread', String(unread));
  renderBellDot(unread);
}

function renderBellDot(count) {
  const el = $('#bellCount');
  const n = count ?? (Number(localStorage.getItem('apihub-events-unread')) || 0);
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', n <= 0);
}

function renderBell() {
  const list = loadEvents();
  $('#bellList').innerHTML = list.length
    ? list
        .map(
          (ev) =>
            `<div class="bell-item"><div>${esc(ev.text)}</div><div class="evt-time">${esc(new Date(ev.time).toLocaleString('zh-CN', { hour12: false }))}</div></div>`,
        )
        .join('')
    : `<div class="bell-empty">${esc(t('bellEmpty'))}</div>`;
}

$('#bellBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  localStorage.setItem('apihub-events-unread', '0');
  renderBellDot(0);
  renderBell();
  $('#bellMenu').classList.toggle('hidden');
});
$('#bellClear').addEventListener('click', () => {
  localStorage.setItem('apihub-events', '[]');
  renderBell();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.bell-wrap')) $('#bellMenu').classList.add('hidden');
});
renderBellDot();

/* ---------------- 侧边栏收起 ---------------- */

function applySidebar(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('apihub-sidebar', collapsed ? 'collapsed' : 'expanded');
  $('#collapseText').textContent = collapsed ? t('expand') : t('collapse');
  $('#collapseBtn').title = collapsed ? t('expand') : t('collapse');
}
$('#collapseBtn').addEventListener('click', () => applySidebar(!document.body.classList.contains('sidebar-collapsed')));
applySidebar(localStorage.getItem('apihub-sidebar') === 'collapsed');

/* ---------------- 侧边栏 / 视图切换 / 主题 ---------------- */

function switchView(view) {
  state.view = ['providers', 'usage'].includes(view) ? view : 'dash';
  const views = { dash: 'viewDash', providers: 'viewProviders', usage: 'viewUsage' };
  for (const [name, id] of Object.entries(views)) $('#' + id).classList.toggle('hidden', name !== state.view);
  $('#navDash').classList.toggle('active', state.view === 'dash');
  $('#navMain').classList.toggle('active', state.view === 'providers');
  $('#navUsage').classList.toggle('active', state.view === 'usage');
  const titles = {
    dash: ['dashTitle', 'dashSubtitle'],
    providers: ['pageTitle', 'pageSubtitle'],
    usage: ['usageTitle', 'usageSubtitle'],
  };
  $('#viewTitle').textContent = t(titles[state.view][0]);
  $('#viewSubtitle').textContent = t(titles[state.view][1]);
  if (state.view === 'providers') renderTable();
  if (state.view === 'dash') renderDash();
}

function renderDash() {
  const providers = state.providers;
  const tested = providers.filter((p) => p.lastTest);
  const passed = tested.filter((p) => p.lastTest.ok).length;
  const connected = state.status.filter((s) => s.managedByHub && s.activeProviderName).length;
  const activeCount = Object.keys(TARGET_LABEL).filter((tg) => activeIdOf(tg)).length;
  const passRate = tested.length ? Math.round((passed / tested.length) * 100) + '%' : '—';
  $('#statGrid').innerHTML = `
    <div class="stat-card"><div class="num">${providers.length}</div><div class="lbl">${esc(t('statProviders'))}</div></div>
    <div class="stat-card"><div class="num">${connected} / ${state.status.length}</div><div class="lbl">${esc(t('statConnected'))}</div></div>
    <div class="stat-card"><div class="num">${activeCount}</div><div class="lbl">${esc(t('statActiveLabel'))}</div></div>
    <div class="stat-card"><div class="num">${esc(passRate)}</div><div class="lbl">${esc(t('statTestPass'))}</div><div class="sub">${esc(t('statTestDetail', { passed, tested: tested.length, untested: providers.length - tested.length }))}</div></div>`;

  $('#dashCli').innerHTML = state.status
    .map((s) => {
      const count = providers.filter((p) => p.target === s.target).length;
      const who = s.managedByHub && s.activeProviderName
        ? esc(s.activeProviderName)
        : s.liveBaseUrl
          ? esc(t('chipExternal'))
          : s.configExists
            ? esc(t('chipDefault'))
            : esc(t('chipUnset'));
      const files = s.file + (s.authFile ? ' + ' + s.authFile : '');
      const shortFile = files.split(/[\\/]/).slice(-2).join('/');
      const upstream = s.liveBaseUrl
        ? `<span class="mono" title="${esc(s.liveBaseUrl)}">${esc(s.liveBaseUrl)}</span>`
        : `<span>${esc(t('chipTooltipUpstreamDefault'))}</span>`;
      return `<div class="dash-row">
        <span class="k"><span class="badge ${s.target}">${TARGET_LABEL[s.target]}</span><span class="mono" title="${esc(files)}">${esc(shortFile)}</span></span>
        <span class="v">${who}<span class="mono">${upstream}</span><span class="pill idle">${count}</span></span>
      </div>`;
    })
    .join('');

  const recent = providers
    .filter((p) => p.lastTest)
    .sort((a, b) => new Date(b.lastTest.testedAt) - new Date(a.lastTest.testedAt))
    .slice(0, 5);
  $('#dashRecent').innerHTML = recent.length
    ? recent
        .map((p) => {
          const tt = p.lastTest;
          const result = tt.ok
            ? `<span class="test-cell ok">${esc(t('testOk', { ms: tt.latencyMs }))}</span>`
            : `<span class="test-cell err" title="${esc(tt.detail)}">✗ ${esc(tt.detail.length > 14 ? tt.detail.slice(0, 14) + '…' : tt.detail)}</span>`;
          const when = new Date(tt.testedAt).toLocaleString('zh-CN', { hour12: false });
          return `<div class="dash-row">
            <span class="k"><span class="badge ${p.target}">${TARGET_LABEL[p.target]}</span>${esc(p.name)}</span>
            <span class="v">${result}<span class="mono" title="${esc(t('testPassedAt', { when }))}">${esc(when)}</span></span>
          </div>`;
        })
        .join('')
    : `<div class="dash-row"><span class="k">${esc(t('dashNoTest'))}</span></div>`;
}

$('#navDash').onclick = (e) => {
  e.preventDefault();
  switchView('dash');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('#navMain').onclick = (e) => {
  e.preventDefault();
  switchView('providers');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('#navUsage').onclick = (e) => {
  e.preventDefault();
  switchView('usage');
  loadUsage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('#usageTarget').addEventListener('change', (e) => {
  state.usageFilter = e.target.value;
  renderUsage();
});
const gotoHelp = (e) => {
  e.preventDefault();
  switchView('providers');
  const help = $('#helpBlock');
  help.open = true;
  help.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
$('#navGuide').onclick = gotoHelp;
$('#navHow').onclick = gotoHelp;

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  localStorage.setItem('apihub-theme', light ? 'light' : 'dark');
  $('#themeText').textContent = light ? t('themeDark') : t('themeLight');
  $('#themeIconMoon').classList.toggle('hidden', light);
  $('#themeIconSun').classList.toggle('hidden', !light);
}
$('#themeToggle').onclick = () => applyTheme(!document.body.classList.contains('light'));
applyTheme(localStorage.getItem('apihub-theme') === 'light');

document.addEventListener('langchange', () => {
  updateFormHints();
  applyTheme(document.body.classList.contains('light'));
  applySidebar(document.body.classList.contains('sidebar-collapsed'));
  buildColMenu();
  switchView(state.view);
  render();
});

/* ---------------- 启动 ---------------- */

$('#addBtn').onclick = () => openEdit(null);
switchView(state.view);
refresh().catch((e) => toast(t('toastLoadFailed', { msg: e.message }), 'err'));
setInterval(() => api('/api/status').then((s) => ((state.status = s), renderChips(), renderDash())).catch(() => {}), 15000);
