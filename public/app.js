// Global Application State
const state = {
  user: null,
  csrfToken: null,
  activeTab: 'tab-chat',
  activeSubtab: 'subtab-invoices',
  chatHistory: [],
  recentTools: [],
  pendingApprovals: []
};

// Simple Markdown Renderer
function renderMarkdown(md) {
  if (!md) return '';
  
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>');

  // Handle tables
  const lines = html.split('\n');
  let inTable = false;
  let tableHtml = '';
  let processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table class="data-table"><tbody>';
      }
      if (line.includes('---')) {
        // Separator row
        continue;
      }
      const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      const isHeader = i === 0 || (lines[i-1] && !lines[i-1].startsWith('|'));
      const tag = (inTable && !tableHtml.includes('<tr>')) ? 'th' : 'td';
      tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += '</tbody></table>';
        processedLines.push(tableHtml);
      }
      processedLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table>';
    processedLines.push(tableHtml);
  }

  html = processedLines.join('\n');

  // Convert newlines to paragraphs/breaks
  return html
    .split('\n\n')
    .map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<table') || trimmed.startsWith('<blockquote')) {
        return trimmed;
      }
      if (trimmed.startsWith('- ')) {
        const items = trimmed.split('\n').map(item => `<li>${item.replace(/^- /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Fetch helper with CSRF token & credentials
async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.csrfToken ? { 'x-csrf-token': state.csrfToken } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    ...options,
    headers
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP Error ${res.status}`);
  }
  return data;
}

// ---------------------------------------------
// APP INITIALIZATION
// ---------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupChat();
  setupFilters();
  setupModals();

  // Initialize session
  await checkAuth();
  await refreshDashboard();
});

// Setup Main Navigation Tabs
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      state.activeTab = tabId;

      if (tabId === 'tab-data') loadSubtabData(state.activeSubtab);
      if (tabId === 'tab-approvals') loadApprovals();
      if (tabId === 'tab-audit') loadAuditLogs();
    });
  });

  // Subtabs inside Business Hub
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtabId = btn.dataset.subtab;
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.subtab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(subtabId).classList.add('active');
      state.activeSubtab = subtabId;
      loadSubtabData(subtabId);
    });
  });

  // Prompt chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      const input = document.getElementById('chat-input');
      input.value = prompt;
      document.getElementById('chat-form').dispatchEvent(new Event('submit'));
    });
  });

  // Switch demo user
  document.getElementById('user-switch-select').addEventListener('change', async (e) => {
    const username = e.target.value;
    try {
      const res = await apiFetch('/api/auth/switch-user', {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      state.user = res.user;
      state.csrfToken = res.csrfToken;
      updateUserUI();
      showToast(`Switched account to ${res.user.full_name} (${res.user.role.toUpperCase()})`, 'success');
      refreshDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Reset database button
  document.getElementById('btn-reset-db').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset the SQLite database to its initial deterministic seed data?')) {
      return;
    }
    try {
      const res = await apiFetch('/api/system/reset-db', { method: 'POST' });
      showToast(res.message, 'success');
      refreshDashboard();
      if (state.activeTab === 'tab-approvals') loadApprovals();
      if (state.activeTab === 'tab-audit') loadAuditLogs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-refresh-approvals').addEventListener('click', loadApprovals);
}

// ---------------------------------------------
// AUTHENTICATION
// ---------------------------------------------
async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.authenticated) {
      state.user = res.user;
      state.csrfToken = res.csrfToken;
    } else {
      // Default to staff user login for convenience
      const loginRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'staff', password: 'staff123' })
      });
      state.user = loginRes.user;
      state.csrfToken = loginRes.csrfToken;
    }
    updateUserUI();
  } catch (err) {
    console.error('Auth error:', err);
  }
}

function updateUserUI() {
  if (!state.user) return;
  document.getElementById('user-full-name').textContent = state.user.full_name;
  const roleBadge = document.getElementById('user-role-badge');
  roleBadge.textContent = state.user.role.toUpperCase();
  roleBadge.className = `user-role-badge role-${state.user.role}`;

  const select = document.getElementById('user-switch-select');
  if (select) select.value = state.user.username;
}

// ---------------------------------------------
// CHAT & AGENT WORKSPACE
// ---------------------------------------------
function setupChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const messagesContainer = document.getElementById('chat-messages');

  // Add initial welcome message
  appendAgentMessage({
    message: `👋 **Welcome to the Local MCP Business Operations Agent!**\n\n> **LOCAL MOCK AGENT — NO REAL AI CONNECTED**\n\nI am a deterministic operations assistant backed by a genuine Model Context Protocol (MCP) server connected directly to your local SQLite business database.\n\nTry asking queries like:\n- *"Which clients have overdue invoices?"*\n- *"Which clients have overdue invoices and active projects?"* *(Cross-system join)*\n- *"Show me the details of invoice INV-1002"*\n- *"Create a follow-up task for the client with the most overdue invoice"* *(Write with approval)*`,
    toolsInvoked: []
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    input.value = '';
    appendUserMessage(query);

    // Show loading bubble
    const loadingId = 'loading-' + Date.now();
    const loadingEl = document.createElement('div');
    loadingEl.id = loadingId;
    loadingEl.className = 'message-item agent-message';
    loadingEl.innerHTML = `
      <div class="message-sender">⚡ OpsPilot MCP Agent</div>
      <div class="message-bubble"><p>⏳ Executing MCP tools and synthesizing facts...</p></div>
    `;
    messagesContainer.appendChild(loadingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      const res = await apiFetch('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message: query })
      });

      document.getElementById(loadingId)?.remove();
      appendAgentMessage(res.response);

      // Refresh stats & tool activity
      refreshDashboard();
    } catch (err) {
      document.getElementById(loadingId)?.remove();
      appendAgentMessage({
        message: `❌ **Error:** ${err.message}`,
        toolsInvoked: []
      });
    }
  });
}

function appendUserMessage(text) {
  const container = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'message-item user-message';
  msgEl.innerHTML = `
    <div class="message-sender">👤 ${state.user ? state.user.username : 'User'}</div>
    <div class="message-bubble"><p>${escapeHtml(text)}</p></div>
  `;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function appendAgentMessage(response) {
  const container = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'message-item agent-message';

  let html = `
    <div class="message-sender">⚡ OpsPilot MCP Agent</div>
    <div class="message-bubble">
      ${renderMarkdown(response.message)}
  `;

  // Inline Approval Card if write action proposed
  if (response.pendingApproval) {
    const a = response.pendingApproval;
    html += `
      <div class="approval-card-inline" id="inline-appr-${a.id}">
        <h4>⚠️ Action Pending Approval</h4>
        <div class="preview-summary">${escapeHtml(a.preview_summary)}</div>
        <div class="approval-actions">
          <button class="btn btn-success btn-sm btn-approve" data-id="${a.id}">✅ Approve & Execute</button>
          <button class="btn btn-danger btn-sm btn-reject" data-id="${a.id}">❌ Reject</button>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  msgEl.innerHTML = html;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;

  // Bind inline approval buttons
  if (response.pendingApproval) {
    const inlineBox = document.getElementById(`inline-appr-${response.pendingApproval.id}`);
    inlineBox?.querySelector('.btn-approve')?.addEventListener('click', () => handleApprove(response.pendingApproval.id, inlineBox));
    inlineBox?.querySelector('.btn-reject')?.addEventListener('click', () => handleReject(response.pendingApproval.id, inlineBox));
  }

  // Update Right Drawer Tool Activity
  updateSidebarToolActivity(response.toolsInvoked);
}

function updateSidebarToolActivity(tools) {
  const container = document.getElementById('sidebar-tool-activity');
  const badge = document.getElementById('last-tool-count');

  if (!tools || tools.length === 0) {
    badge.textContent = '0 tools';
    return;
  }

  badge.textContent = `${tools.length} tool(s) invoked`;
  container.innerHTML = '';

  tools.forEach(t => {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-card-header">
        <span class="tool-name-tag">🔧 ${t.tool}</span>
        <span class="tool-time-tag">${t.executionTimeMs || 1}ms</span>
      </div>
      <div class="tool-args-preview"><strong>Args:</strong> ${JSON.stringify(t.args, null, 2)}</div>
    `;
    card.addEventListener('click', () => {
      showInspectorModal(`MCP Tool Result: ${t.tool}`, {
        tool: t.tool,
        arguments: t.args,
        outcome: t.outcome,
        result: t.result,
        error: t.error
      });
    });
    container.appendChild(card);
  });
}

// ---------------------------------------------
// APPROVAL WORKFLOWS
// ---------------------------------------------
async function handleApprove(approvalId, inlineElement) {
  try {
    const res = await apiFetch(`/api/approvals/${approvalId}/approve`, { method: 'POST' });
    showToast('Action approved and executed successfully in SQLite database!', 'success');
    
    if (inlineElement) {
      inlineElement.innerHTML = `
        <div style="color: var(--color-success); font-weight: 600;">
          ✅ Approved & Executed by ${state.user.username}
        </div>
      `;
    }

    refreshDashboard();
    if (state.activeTab === 'tab-approvals') loadApprovals();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleReject(approvalId, inlineElement) {
  const reason = prompt('Please enter a rejection reason:', 'Operational discrepancy');
  if (reason === null) return; // User cancelled prompt

  try {
    const res = await apiFetch(`/api/approvals/${approvalId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    showToast('Action rejected.', 'info');

    if (inlineElement) {
      inlineElement.innerHTML = `
        <div style="color: var(--color-danger); font-weight: 600;">
          ❌ Rejected: "${escapeHtml(reason)}"
        </div>
      `;
    }

    refreshDashboard();
    if (state.activeTab === 'tab-approvals') loadApprovals();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadApprovals() {
  const container = document.getElementById('approvals-list');
  container.innerHTML = '<div class="empty-state"><p>Loading approvals...</p></div>';

  try {
    const res = await apiFetch('/api/approvals');
    const list = res.approvals || [];
    const pendingCount = list.filter(a => a.status === 'pending').length;

    const badge = document.getElementById('pending-count-badge');
    badge.textContent = pendingCount;
    badge.classList.toggle('hidden', pendingCount === 0);

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No approval requests recorded.</p>
          <small>Write operations requested through the agent will appear here for verification.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    list.forEach(a => {
      const box = document.createElement('div');
      box.className = 'approval-box';
      const isPending = a.status === 'pending';

      box.innerHTML = `
        <div class="approval-box-header">
          <span class="approval-type">⚡ ${a.action_type.toUpperCase()}</span>
          <span class="badge badge-${a.status}">${a.status}</span>
        </div>
        <div class="approval-meta">
          Target: <strong>${escapeHtml(a.target_entity_name || a.target_entity_id)}</strong> (${a.target_entity_type})<br>
          Requested by: <strong>${a.requested_by_username || a.requested_by_user_id}</strong> on ${new Date(a.requested_at).toLocaleString()}
        </div>
        <div class="approval-preview">${escapeHtml(a.preview_summary)}</div>
        ${isPending ? `
          <div class="approval-actions">
            <button class="btn btn-success btn-sm btn-box-approve" data-id="${a.id}">Approve</button>
            <button class="btn btn-danger btn-sm btn-box-reject" data-id="${a.id}">Reject</button>
            <button class="btn btn-secondary btn-sm btn-box-json" data-id="${a.id}">Inspect Params</button>
          </div>
        ` : `
          <div class="approval-meta">
            ${a.reviewed_by_username ? `Reviewed by: <strong>${a.reviewed_by_username}</strong>` : ''}
            ${a.rejection_reason ? `<br>Reason: <em>${escapeHtml(a.rejection_reason)}</em>` : ''}
          </div>
        `}
      `;

      if (isPending) {
        box.querySelector('.btn-box-approve')?.addEventListener('click', () => handleApprove(a.id));
        box.querySelector('.btn-box-reject')?.addEventListener('click', () => handleReject(a.id));
        box.querySelector('.btn-box-json')?.addEventListener('click', () => {
          showInspectorModal(`Approval Request ${a.id}`, a);
        });
      }

      container.appendChild(box);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--color-danger)">${err.message}</p></div>`;
  }
}

// ---------------------------------------------
// BUSINESS DATA HUB
// ---------------------------------------------
async function refreshDashboard() {
  try {
    const stats = await apiFetch('/api/data/overview');
    document.getElementById('stat-clients').textContent = stats.clientsCount;
    document.getElementById('stat-projects').textContent = stats.activeProjectsCount;
    document.getElementById('stat-overdue-count').textContent = stats.overdueInvoicesCount;
    document.getElementById('stat-overdue-amount').textContent = `$${stats.totalOverdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    document.getElementById('stat-tasks').textContent = stats.openTasksCount;

    const badge = document.getElementById('pending-count-badge');
    badge.textContent = stats.pendingApprovalsCount;
    badge.classList.toggle('hidden', stats.pendingApprovalsCount === 0);
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

async function loadSubtabData(subtabId) {
  switch (subtabId) {
    case 'subtab-invoices':
      await loadInvoices();
      break;
    case 'subtab-projects':
      await loadProjects();
      break;
    case 'subtab-clients':
      await loadClients();
      break;
    case 'subtab-tasks':
      await loadTasks();
      break;
    case 'subtab-documents':
      await loadDocuments();
      break;
  }
}

async function loadInvoices() {
  const status = document.getElementById('filter-invoice-status').value;
  const url = status && status !== 'all' ? `/api/data/invoices?status=${status}` : '/api/data/invoices';
  const tbody = document.querySelector('#table-invoices tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading invoices...</td></tr>';

  try {
    const res = await apiFetch(url);
    tbody.innerHTML = '';
    (res.invoices || []).forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${i.invoice_number}</strong></td>
        <td>${escapeHtml(i.client_name)}</td>
        <td>$${i.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${i.currency}</td>
        <td><span class="badge badge-${i.status}">${i.status}</span></td>
        <td>${i.due_date}</td>
        <td>${escapeHtml(i.description || 'N/A')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

async function loadProjects() {
  const tbody = document.querySelector('#table-projects tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Loading projects...</td></tr>';

  try {
    const res = await apiFetch('/api/data/projects');
    tbody.innerHTML = '';
    (res.projects || []).forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${p.code}</code></td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.client_name)}</td>
        <td><span class="badge badge-${p.status}">${p.status}</span></td>
        <td>$${p.budget.toLocaleString()}</td>
        <td>${p.start_date} ~ ${p.target_completion_date}</td>
        <td>${escapeHtml(p.description)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

async function loadClients() {
  const tbody = document.querySelector('#table-clients tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Loading clients...</td></tr>';

  try {
    const res = await apiFetch('/api/data/clients');
    tbody.innerHTML = '';
    (res.clients || []).forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.industry)}</td>
        <td><span class="badge badge-${c.tier}">${c.tier}</span></td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
        <td>${escapeHtml(c.primary_contact_name)}</td>
        <td>${escapeHtml(c.primary_email)}<br><small>${escapeHtml(c.phone)}</small></td>
        <td><small>${escapeHtml(c.notes || '')}</small></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

async function loadTasks() {
  const tbody = document.querySelector('#table-tasks tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading tasks...</td></tr>';

  try {
    const res = await apiFetch('/api/data/tasks');
    tbody.innerHTML = '';
    (res.tasks || []).forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(t.title)}</strong></td>
        <td><span class="badge badge-${t.priority}">${t.priority}</span></td>
        <td><span class="badge badge-${t.status}">${t.status}</span></td>
        <td>${escapeHtml(t.client_name || 'N/A')}</td>
        <td>${escapeHtml(t.project_name || 'N/A')}</td>
        <td>${t.due_date || 'N/A'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

async function loadDocuments() {
  const tbody = document.querySelector('#table-documents tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Loading documents...</td></tr>';

  try {
    const res = await apiFetch('/api/data/documents');
    tbody.innerHTML = '';
    (res.documents || []).forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(d.title)}</strong></td>
        <td><span class="badge badge-primary">${d.doc_type}</span></td>
        <td>${escapeHtml(d.client_name || 'N/A')}</td>
        <td><code>${escapeHtml(d.file_path)}</code></td>
        <td>${escapeHtml(d.summary)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

// ---------------------------------------------
// AUDIT LOGS
// ---------------------------------------------
async function loadAuditLogs() {
  const tbody = document.querySelector('#table-audit-logs tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Loading audit records...</td></tr>';

  const tool = document.getElementById('audit-filter-tool').value;
  const outcome = document.getElementById('audit-filter-outcome').value;
  const search = document.getElementById('audit-filter-search').value.trim();

  let queryParams = new URLSearchParams();
  if (tool && tool !== 'all') queryParams.set('toolName', tool);
  if (outcome && outcome !== 'all') queryParams.set('outcome', outcome);
  if (search) queryParams.set('search', search);

  try {
    const res = await apiFetch(`/api/audit-logs?${queryParams.toString()}`);
    tbody.innerHTML = '';
    const logs = res.logs || [];

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-dim)">No audit logs match current filters.</td></tr>';
      return;
    }

    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><small>${new Date(log.created_at).toLocaleString()}</small></td>
        <td><strong>${escapeHtml(log.username)}</strong></td>
        <td><span class="user-role-badge role-${log.user_role}">${log.user_role}</span></td>
        <td><code>${escapeHtml(log.tool_name)}</code></td>
        <td>${log.target_entity_type ? `${log.target_entity_type}: ${log.target_entity_id}` : '-'}</td>
        <td><span class="badge badge-${log.outcome}">${log.outcome}</span></td>
        <td><button class="btn btn-secondary btn-sm btn-inspect-log">Inspect</button></td>
      `;
      tr.querySelector('.btn-inspect-log').addEventListener('click', () => {
        showInspectorModal(`Audit Event: ${log.tool_name} (${log.id})`, log);
      });
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${err.message}</td></tr>`;
  }
}

function setupFilters() {
  document.getElementById('filter-invoice-status')?.addEventListener('change', loadInvoices);
  document.getElementById('btn-apply-audit-filter')?.addEventListener('click', loadAuditLogs);
  document.getElementById('audit-filter-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadAuditLogs();
  });
}

// ---------------------------------------------
// MODALS
// ---------------------------------------------
function setupModals() {
  const modal = document.getElementById('inspector-modal');
  const closeBtn = document.getElementById('modal-close-btn');

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function showInspectorModal(title, jsonPayload) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-json-content').textContent = JSON.stringify(jsonPayload, null, 2);
  document.getElementById('inspector-modal').classList.remove('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
