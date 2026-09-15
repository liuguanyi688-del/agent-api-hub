/* Agent API Hub 双语词条(zh 默认 / en),无构建步骤的全局脚本 */
'use strict';

const I18N_DICT = {
  zh: {
    navProviders: '供应商管理',
    navDash: '仪表盘',
    dashTitle: '仪表盘',
    dashSubtitle: '站点与 CLI 接入总览',
    statProviders: '供应商总数',
    statConnected: '已接入 CLI',
    statActiveLabel: '启用中的供应商',
    statTestPass: '测试通过率',
    statTestDetail: '{passed}/{tested} 已测 · {untested} 未测',
    dashCliTitle: 'CLI 接入状态',
    dashRecentTitle: '最近测试',
    dashNoTest: '暂无测试记录',
    dashConfigFile: '配置文件',
    dashUpstream: '当前上游',
    dashNeverTested: '未测试',
    navGuide: '快速上手',
    navHow: '工作原理',
    navGitHub: 'GitHub 仓库',
    themeLight: '浅色模式',
    themeDark: '深色模式',
    langSwitchTo: 'English',
    pageTitle: '供应商管理',
    pageSubtitle: '管理接入 Claude Code / Codex / Gemini CLI 的 API 供应商',
    searchPlaceholder: '搜索名称或 Base URL...',
    filterAllTargets: '全部目标',
    filterAllStatus: '全部状态',
    statusActive: '当前使用',
    statusIdle: '未启用',
    addProvider: '添加供应商',
    thName: '名称',
    thTarget: '目标',
    thBaseUrl: 'Base URL',
    thKey: 'API Key',
    thStatus: '状态',
    thTest: '测试',
    thOps: '操作',
    emptyTitle: '还没有供应商',
    emptyDesc: '添加一个 API 供应商(官方或中转站地址均可),点「启用」即可写入对应 CLI 的配置文件。',
    emptyBtn: '添加第一个供应商',
    resultPage: '显示 {from} 至 {to},共 {total} 条结果',
    pageSizeLabel: '每页',
    colSettings: '列设置',
    refreshTitle: '刷新列表',
    copyUrlTitle: '复制 Base URL',
    prevPage: '上一页',
    nextPage: '下一页',
    footLocal: '本地服务 · 127.0.0.1:8317',
    helpSummary: '快速上手 & 工作原理 & 安全说明',
    chipExternal: '手动/外部配置',
    chipDefault: '默认配置',
    chipUnset: '未配置',
    chipTooltipFilter: '点击筛选该目标的供应商',
    chipTooltipUpstream: '当前上游:{url}',
    chipTooltipUpstreamDefault: '当前上游:官方默认',
    chipResetTitle: '移除本工具写入的配置,恢复 CLI 默认',
    pillLive: '当前使用',
    pillIdle: '未启用',
    testUntested: '尚未测试',
    testOk: '✓ 通过 · {ms}ms',
    testPassedAt: '测试于 {when}',
    btnEnable: '启用',
    btnTest: '测试',
    btnPreview: '预览',
    btnEdit: '编辑',
    btnDelete: '删除',
    testing: '测试中…',
    copyKeyTitle: '复制完整 Key',
    confirmTitle: '确认',
    confirmEnableTitle: '启用「{name}」?',
    confirmEnableBody: '将合并写入:{files}<br/>写入前会自动备份原文件为 <code>*.apihub.bak</code>,其他已有配置保留。',
    confirmDeleteTitle: '删除供应商?',
    confirmDeleteBody: '仅从面板移除「{name}」,不会改写 CLI 配置文件。',
    resetTitle: '恢复 {target} 官方默认?',
    resetBody: '将移除本工具写入该 CLI 配置文件中的键(原文件已备份为 <code>*.apihub.bak</code>)。你自己手动加的其他配置不受影响。',
    toastCopied: '已复制到剪贴板',
    toastCopyFailed: '复制失败,请手动选择复制',
    toastSaved: '已保存',
    toastDeleted: '已删除',
    toastRefreshed: '已刷新',
    toastRefreshFailed: '刷新失败:{msg}',
    toastLoadFailed: '加载失败:{msg}',
    toastActivated: '已启用:{target} 现在指向「{name}」。若 CLI 正在运行,请重启会话生效',
    toastResetDone: '{target} 已恢复默认',
    modalAdd: '添加供应商',
    modalEdit: '编辑供应商',
    fTarget: '接入目标',
    fTargetClaude: 'Claude Code(Anthropic 协议)',
    fTargetCodex: 'Codex CLI(OpenAI 协议)',
    fTargetGemini: 'Gemini CLI(Gemini 协议)',
    fName: '名称',
    fNamePlaceholder: '例如:某中转站 · Sonnet',
    fApiKey: 'API Key',
    fModel: '默认模型(可选)',
    fModelPlaceholder: '留空则不指定',
    fModelHint: 'Claude Code → ANTHROPIC_MODEL;Codex → model;Gemini CLI → GEMINI_MODEL',
    fWire: 'Codex 接口风格',
    fWireChat: 'chat(/v1/chat/completions,中转站通用)',
    fWireResponses: 'responses(/v1/responses,官方新接口)',
    fNote: '备注(可选)',
    fNotePlaceholder: '价格 / 来源 / 到期时间等',
    fOptional: '',
    btnCancel: '取消',
    btnSave: '保存',
    btnClose: '关闭',
    btnOk: '确定',
    btnShow: '显示',
    btnHide: '隐藏',
    btnCopyPath: '复制路径',
    previewTitle: '将写入的配置预览',
    previewFootHint: '以上文件在写入前都会自动备份为 <code>*.apihub.bak</code>',
    hintBaseClaude: '填根地址(不要带 /v1),CLI 会自动拼 /v1/messages。例:https://api.anthropic.com 或中转站根地址',
    hintBaseCodex: '通常以 /v1 结尾。例:https://api.openai.com/v1 或中转站给的 OpenAI 兼容地址',
    hintBaseGemini: '例:https://generativelanguage.googleapis.com(CLI 自动拼 /v1beta/...)',
    helpBody: `<p><b>四步接入:</b>① 「添加供应商」填 Base URL 和 Key → ② 点「测试」验证鉴权 → ③ 点「预览」确认将写入的内容 → ④ 点「启用」,重启 CLI 会话生效。点状态徽章上的 ↺ 可恢复 CLI 官方默认。</p>
        <pre class="flow">你的 CLI Agent(Claude Code / Codex / Gemini CLI)
        │  读取固定路径的配置文件(见下表)
        ▼
Agent API Hub 面板 ── 启用 ──► 合并写入对应配置文件(写前自动备份为 *.apihub.bak)
        │
        ▼
请求按你填的 Base URL + API Key 发往上游(官方 / 中转站)</pre>
        <table class="files">
          <thead><tr><th>目标 CLI</th><th>配置文件</th><th>写入的键</th></tr></thead>
          <tbody>
            <tr><td>Claude Code</td><td><code>~/.claude/settings.json</code></td><td><code>env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL</code></td></tr>
            <tr><td>Codex CLI</td><td><code>~/.codex/config.toml</code> + <code>auth.json</code></td><td>顶部管理块 <code>model_provider</code> + <code>[model_providers.apihub]</code>;<code>auth.json</code> 的 <code>OPENAI_API_KEY</code></td></tr>
            <tr><td>Gemini CLI</td><td><code>~/.gemini/.env</code></td><td><code>GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL / GEMINI_MODEL</code></td></tr>
          </tbody>
        </table>
        <ul>
          <li>合并写入:只增改本工具管理的键,你已有的其他配置一律保留;每次写入前滚动备份一份 <code>*.apihub.bak</code>。</li>
          <li>供应商列表保存在本地 <code>data/providers.json</code>,API Key 明文存储 —— 这是单机小工具的取舍,请勿把项目目录分享给他人。</li>
          <li>「测试」会向上游发一个真实的小请求验证鉴权(GET /v1/models,失败则退化为 1 token 对话请求),几乎不产生费用。</li>
          <li>本服务只监听 127.0.0.1,不对外网开放。</li>
        </ul>`,
  },
  en: {
    navProviders: 'Providers',
    navDash: 'Dashboard',
    dashTitle: 'Dashboard',
    dashSubtitle: 'Overview of providers and CLI connections',
    statProviders: 'Total providers',
    statConnected: 'Connected CLIs',
    statActiveLabel: 'Enabled providers',
    statTestPass: 'Test pass rate',
    statTestDetail: '{passed}/{tested} tested · {untested} untested',
    dashCliTitle: 'CLI status',
    dashRecentTitle: 'Recent tests',
    dashNoTest: 'No test records yet',
    dashConfigFile: 'Config file',
    dashUpstream: 'Upstream',
    dashNeverTested: 'Not tested',
    navGuide: 'Quick Start',
    navHow: 'How It Works',
    navGitHub: 'GitHub Repo',
    themeLight: 'Light Mode',
    themeDark: 'Dark Mode',
    langSwitchTo: '中文',
    pageTitle: 'Providers',
    pageSubtitle: 'Manage API providers for Claude Code / Codex / Gemini CLI',
    searchPlaceholder: 'Search name or Base URL...',
    filterAllTargets: 'All targets',
    filterAllStatus: 'All statuses',
    statusActive: 'Active',
    statusIdle: 'Idle',
    addProvider: 'Add Provider',
    thName: 'Name',
    thTarget: 'Target',
    thBaseUrl: 'Base URL',
    thKey: 'API Key',
    thStatus: 'Status',
    thTest: 'Test',
    thOps: 'Actions',
    emptyTitle: 'No providers yet',
    emptyDesc: 'Add an API provider (official or relay endpoint), then click "Enable" to write it into the CLI config file.',
    emptyBtn: 'Add your first provider',
    resultPage: 'Showing {from}-{to} of {total}',
    pageSizeLabel: 'Per page',
    colSettings: 'Columns',
    refreshTitle: 'Refresh',
    copyUrlTitle: 'Copy Base URL',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    footLocal: 'Local service · 127.0.0.1:8317',
    helpSummary: 'Quick Start & How It Works & Safety Notes',
    chipExternal: 'Manual/external',
    chipDefault: 'Default config',
    chipUnset: 'Not configured',
    chipTooltipFilter: 'Click to filter providers for this target',
    chipTooltipUpstream: 'Upstream: {url}',
    chipTooltipUpstreamDefault: 'Upstream: official default',
    chipResetTitle: 'Remove keys written by this tool and restore CLI defaults',
    pillLive: 'In use',
    pillIdle: 'Idle',
    testUntested: 'Not tested',
    testOk: '✓ Pass · {ms}ms',
    testPassedAt: 'Tested at {when}',
    btnEnable: 'Enable',
    btnTest: 'Test',
    btnPreview: 'Preview',
    btnEdit: 'Edit',
    btnDelete: 'Delete',
    testing: 'Testing...',
    copyKeyTitle: 'Copy full key',
    confirmTitle: 'Confirm',
    confirmEnableTitle: 'Enable "{name}"?',
    confirmEnableBody: 'Will merge-write: {files}<br/>Original files are backed up as <code>*.apihub.bak</code>; other existing settings are preserved.',
    confirmDeleteTitle: 'Delete provider?',
    confirmDeleteBody: 'Removes "{name}" from the panel only; CLI config files are not modified.',
    resetTitle: 'Restore {target} to official defaults?',
    resetBody: 'Removes the keys this tool wrote into the CLI config (the original file is backed up as <code>*.apihub.bak</code>). Your own manual settings are not affected.',
    toastCopied: 'Copied to clipboard',
    toastCopyFailed: 'Copy failed, please copy manually',
    toastSaved: 'Saved',
    toastDeleted: 'Deleted',
    toastRefreshed: 'Refreshed',
    toastRefreshFailed: 'Refresh failed: {msg}',
    toastLoadFailed: 'Load failed: {msg}',
    toastActivated: 'Enabled: {target} now points to "{name}". Restart the CLI session to take effect',
    toastResetDone: '{target} restored to defaults',
    modalAdd: 'Add Provider',
    modalEdit: 'Edit Provider',
    fTarget: 'Target CLI',
    fTargetClaude: 'Claude Code (Anthropic protocol)',
    fTargetCodex: 'Codex CLI (OpenAI protocol)',
    fTargetGemini: 'Gemini CLI (Gemini protocol)',
    fName: 'Name',
    fNamePlaceholder: 'e.g. My Relay · Sonnet',
    fApiKey: 'API Key',
    fModel: 'Default model (optional)',
    fModelPlaceholder: 'Leave empty to keep unset',
    fModelHint: 'Claude Code → ANTHROPIC_MODEL; Codex → model; Gemini CLI → GEMINI_MODEL',
    fWire: 'Codex wire API',
    fWireChat: 'chat (/v1/chat/completions, common for relays)',
    fWireResponses: 'responses (/v1/responses, official new API)',
    fNote: 'Note (optional)',
    fNotePlaceholder: 'price / source / expiry, etc.',
    fOptional: '',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    btnClose: 'Close',
    btnOk: 'OK',
    btnShow: 'Show',
    btnHide: 'Hide',
    btnCopyPath: 'Copy path',
    previewTitle: 'Config write preview',
    previewFootHint: 'All files above are backed up as <code>*.apihub.bak</code> before writing',
    hintBaseClaude: 'Root URL (no /v1); the CLI appends /v1/messages itself. e.g. https://api.anthropic.com or your relay root URL',
    hintBaseCodex: 'Usually ends with /v1. e.g. https://api.openai.com/v1 or the OpenAI-compatible URL from your relay',
    hintBaseGemini: 'e.g. https://generativelanguage.googleapis.com (the CLI appends /v1beta/...)',
    helpBody: `<p><b>Four steps:</b> ① "Add Provider" with Base URL and Key → ② "Test" to verify auth → ③ "Preview" what will be written → ④ "Enable", then restart your CLI session. The ↺ on a status chip restores the CLI's official defaults.</p>
        <pre class="flow">Your CLI Agent (Claude Code / Codex / Gemini CLI)
        │  reads its config file at a fixed path (see table)
        ▼
Agent API Hub panel ── Enable ──► merge-writes the config file (auto-backup as *.apihub.bak first)
        │
        ▼
Requests go to your chosen Base URL + API Key (official / relay)</pre>
        <table class="files">
          <thead><tr><th>Target CLI</th><th>Config file</th><th>Keys written</th></tr></thead>
          <tbody>
            <tr><td>Claude Code</td><td><code>~/.claude/settings.json</code></td><td><code>env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL</code></td></tr>
            <tr><td>Codex CLI</td><td><code>~/.codex/config.toml</code> + <code>auth.json</code></td><td>managed block <code>model_provider</code> + <code>[model_providers.apihub]</code>; <code>OPENAI_API_KEY</code> in <code>auth.json</code></td></tr>
            <tr><td>Gemini CLI</td><td><code>~/.gemini/.env</code></td><td><code>GEMINI_API_KEY / GOOGLE_GEMINI_BASE_URL / GEMINI_MODEL</code></td></tr>
          </tbody>
        </table>
        <ul>
          <li>Merge write: only keys managed by this tool are touched; all your other settings are preserved. A rolling <code>*.apihub.bak</code> backup is made before every write.</li>
          <li>Providers are stored locally in <code>data/providers.json</code> with plaintext API keys — a trade-off of a single-machine tool; do not share this folder.</li>
          <li>"Test" sends a tiny real request upstream (GET /v1/models, falling back to a 1-token chat request) — essentially free.</li>
          <li>This service listens on 127.0.0.1 only and is not exposed to the internet.</li>
        </ul>`,
  },
};

let __lang = localStorage.getItem('apihub-lang') === 'en' ? 'en' : 'zh';

function t(key, vars) {
  let s = (I18N_DICT[__lang] && I18N_DICT[__lang][key]) || I18N_DICT.zh[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}

function getLang() {
  return __lang;
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}

function setLang(lang) {
  __lang = lang === 'en' ? 'en' : 'zh';
  localStorage.setItem('apihub-lang', __lang);
  const label = document.getElementById('langText');
  if (label) label.textContent = t('langSwitchTo');
  applyStaticI18n();
  document.dispatchEvent(new CustomEvent('langchange'));
}

(function initLang() {
  const btn = document.getElementById('langToggle');
  if (btn) btn.onclick = () => setLang(getLang() === 'zh' ? 'en' : 'zh');
  const label = document.getElementById('langText');
  if (label) label.textContent = t('langSwitchTo');
  applyStaticI18n();
})();
