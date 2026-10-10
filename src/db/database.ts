import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeSchema } from './schema.js';
import type {
  User,
  SafeUser,
  Client,
  Invoice,
  Project,
  Task,
  Document,
  ApprovalRequest,
  AuditLog
} from '../types/index.js';

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  const targetPath = dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'business_ops.sqlite');
  
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  initializeSchema(db);

  if (!dbPath) {
    dbInstance = db;
  }

  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Repository query helpers
export class BusinessDb {
  constructor(private db: Database.Database) {}

  // Users
  getUserById(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  getUserByUsername(username: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  }

  getAllUsers(): User[] {
    return this.db.prepare('SELECT * FROM users ORDER BY username ASC').all() as User[];
  }

  // Clients
  searchClients(query?: string, tier?: string, status?: string): Client[] {
    let sql = 'SELECT * FROM clients WHERE 1=1';
    const params: (string | number)[] = [];

    if (query && query.trim() !== '') {
      sql += ' AND (name LIKE ? OR primary_contact_name LIKE ? OR primary_email LIKE ? OR industry LIKE ?)';
      const wildcard = `%${query.trim()}%`;
      params.push(wildcard, wildcard, wildcard, wildcard);
    }

    if (tier && tier !== 'all') {
      sql += ' AND tier = ?';
      params.push(tier);
    }

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY name ASC';
    return this.db.prepare(sql).all(...params) as Client[];
  }

  getClientById(id: string): Client | undefined {
    return this.db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as Client | undefined;
  }

  getClientByName(name: string): Client | undefined {
    return this.db.prepare('SELECT * FROM clients WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)').get(name, `%${name}%`) as Client | undefined;
  }

  updateClientNotes(id: string, notes: string): Client | undefined {
    const existing = this.getClientById(id);
    if (!existing) return undefined;
    
    const updatedNotes = existing.notes ? `${existing.notes}\n[${new Date().toISOString()}] ${notes}` : `[${new Date().toISOString()}] ${notes}`;
    this.db.prepare('UPDATE clients SET notes = ? WHERE id = ?').run(updatedNotes, id);
    return this.getClientById(id);
  }

  // Invoices
  listInvoices(clientId?: string, status?: string): (Invoice & { client_name: string })[] {
    let sql = `
      SELECT i.*, c.name as client_name 
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (clientId) {
      sql += ' AND i.client_id = ?';
      params.push(clientId);
    }

    if (status && status !== 'all') {
      sql += ' AND i.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY i.due_date ASC';
    return this.db.prepare(sql).all(...params) as (Invoice & { client_name: string })[];
  }

  listOverdueInvoices(): (Invoice & { client_name: string; days_overdue: number })[] {
    const sql = `
      SELECT 
        i.*, 
        c.name as client_name,
        CAST((julianday('now') - julianday(i.due_date)) AS INTEGER) as days_overdue
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status = 'overdue' OR (i.status = 'unpaid' AND date(i.due_date) < date('now'))
      ORDER BY i.amount DESC
    `;
    return this.db.prepare(sql).all() as (Invoice & { client_name: string; days_overdue: number })[];
  }

  getInvoiceById(idOrNumber: string): (Invoice & { client_name: string }) | undefined {
    return this.db.prepare(`
      SELECT i.*, c.name as client_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.id = ? OR UPPER(i.invoice_number) = UPPER(?)
    `).get(idOrNumber, idOrNumber) as (Invoice & { client_name: string }) | undefined;
  }

  // Projects
  listProjects(clientId?: string, status?: string): (Project & { client_name: string })[] {
    let sql = `
      SELECT p.*, c.name as client_name
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (clientId) {
      sql += ' AND p.client_id = ?';
      params.push(clientId);
    }

    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY p.name ASC';
    return this.db.prepare(sql).all(...params) as (Project & { client_name: string })[];
  }

  getProjectByIdOrCode(idOrCode: string): (Project & { client_name: string }) | undefined {
    return this.db.prepare(`
      SELECT p.*, c.name as client_name
      FROM projects p
      JOIN clients c ON p.client_id = c.id
      WHERE p.id = ? OR UPPER(p.code) = UPPER(?) OR LOWER(p.name) LIKE LOWER(?)
    `).get(idOrCode, idOrCode, `%${idOrCode}%`) as (Project & { client_name: string }) | undefined;
  }

  updateProjectStatus(id: string, status: string): Project | undefined {
    this.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, id);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }

  // Tasks
  listTasks(clientId?: string, projectId?: string, status?: string): (Task & { client_name?: string; project_name?: string; assigned_user_name?: string })[] {
    let sql = `
      SELECT t.*, c.name as client_name, p.name as project_name, u.full_name as assigned_user_name
      FROM tasks t
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assigned_to_user_id = u.id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (clientId) {
      sql += ' AND t.client_id = ?';
      params.push(clientId);
    }

    if (projectId) {
      sql += ' AND t.project_id = ?';
      params.push(projectId);
    }

    if (status && status !== 'all') {
      sql += ' AND t.status = ?';
      params.push(status);
    }

    sql += " ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.created_at DESC";
    return this.db.prepare(sql).all(...params) as (Task & { client_name?: string; project_name?: string; assigned_user_name?: string })[];
  }

  createTask(task: {
    id: string;
    title: string;
    project_id?: string | null;
    client_id?: string | null;
    assigned_to_user_id?: string | null;
    status?: string;
    priority?: string;
    due_date?: string | null;
  }): Task {
    const status = task.status || 'open';
    const priority = task.priority || 'medium';
    this.db.prepare(`
      INSERT INTO tasks (id, title, project_id, client_id, assigned_to_user_id, status, priority, due_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      task.id,
      task.title,
      task.project_id || null,
      task.client_id || null,
      task.assigned_to_user_id || null,
      status,
      priority,
      task.due_date || null
    );

    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;
  }

  // Documents
  searchDocuments(query?: string, docType?: string, clientId?: string): (Document & { client_name?: string; project_name?: string })[] {
    let sql = `
      SELECT d.*, c.name as client_name, p.name as project_name
      FROM documents d
      LEFT JOIN clients c ON d.client_id = c.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (query && query.trim() !== '') {
      sql += ' AND (d.title LIKE ? OR d.summary LIKE ? OR d.file_path LIKE ?)';
      const wildcard = `%${query.trim()}%`;
      params.push(wildcard, wildcard, wildcard);
    }

    if (docType && docType !== 'all') {
      sql += ' AND d.doc_type = ?';
      params.push(docType);
    }

    if (clientId) {
      sql += ' AND d.client_id = ?';
      params.push(clientId);
    }

    sql += ' ORDER BY d.created_at DESC';
    return this.db.prepare(sql).all(...params) as (Document & { client_name?: string; project_name?: string })[];
  }

  getDocumentById(id: string): (Document & { client_name?: string; project_name?: string }) | undefined {
    return this.db.prepare(`
      SELECT d.*, c.name as client_name, p.name as project_name
      FROM documents d
      LEFT JOIN clients c ON d.client_id = c.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE d.id = ?
    `).get(id) as (Document & { client_name?: string; project_name?: string }) | undefined;
  }

  // Approvals
  createApprovalRequest(req: {
    id: string;
    action_type: string;
    tool_name: string;
    target_entity_type: string;
    target_entity_id: string;
    target_entity_name?: string;
    parameters_json: string;
    preview_summary: string;
    requested_by_user_id: string;
    expires_at: string;
  }): ApprovalRequest {
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, action_type, tool_name, target_entity_type, target_entity_id, 
        target_entity_name, parameters_json, preview_summary, status, 
        requested_by_user_id, requested_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), ?)
    `).run(
      req.id,
      req.action_type,
      req.tool_name,
      req.target_entity_type,
      req.target_entity_id,
      req.target_entity_name || null,
      req.parameters_json,
      req.preview_summary,
      req.requested_by_user_id,
      req.expires_at
    );

    return this.getApprovalById(req.id)!;
  }

  getApprovalById(id: string): ApprovalRequest | undefined {
    // Check expiration on read
    this.db.prepare(`
      UPDATE approval_requests
      SET status = 'expired'
      WHERE id = ? AND status = 'pending' AND datetime(expires_at) < datetime('now')
    `).run(id);

    return this.db.prepare(`
      SELECT 
        a.*,
        u1.username as requested_by_username,
        u2.username as reviewed_by_username
      FROM approval_requests a
      LEFT JOIN users u1 ON a.requested_by_user_id = u1.id
      LEFT JOIN users u2 ON a.reviewed_by_user_id = u2.id
      WHERE a.id = ?
    `).get(id) as ApprovalRequest | undefined;
  }

  listApprovals(status?: string): ApprovalRequest[] {
    // Auto expire pending ones
    this.db.prepare(`
      UPDATE approval_requests
      SET status = 'expired'
      WHERE status = 'pending' AND datetime(expires_at) < datetime('now')
    `).run();

    let sql = `
      SELECT 
        a.*,
        u1.username as requested_by_username,
        u2.username as reviewed_by_username
      FROM approval_requests a
      LEFT JOIN users u1 ON a.requested_by_user_id = u1.id
      LEFT JOIN users u2 ON a.reviewed_by_user_id = u2.id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (status && status !== 'all') {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY a.requested_at DESC';
    return this.db.prepare(sql).all(...params) as ApprovalRequest[];
  }

  updateApprovalStatus(id: string, status: 'approved' | 'rejected' | 'expired', reviewedByUserId?: string, rejectionReason?: string): ApprovalRequest | undefined {
    this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, reviewed_by_user_id = ?, rejection_reason = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(status, reviewedByUserId || null, rejectionReason || null, id);

    return this.getApprovalById(id);
  }

  // Audit Logs
  createAuditLog(log: {
    id: string;
    user_id: string;
    username: string;
    user_role: string;
    tool_name: string;
    target_entity_type?: string | null;
    target_entity_id?: string | null;
    arguments_json: string;
    outcome: string;
    approval_id?: string | null;
    error_message?: string | null;
    execution_result_json?: string | null;
  }): AuditLog {
    this.db.prepare(`
      INSERT INTO audit_logs (
        id, user_id, username, user_role, tool_name, target_entity_type,
        target_entity_id, arguments_json, outcome, approval_id, error_message,
        execution_result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      log.id,
      log.user_id,
      log.username,
      log.user_role,
      log.tool_name,
      log.target_entity_type || null,
      log.target_entity_id || null,
      log.arguments_json,
      log.outcome,
      log.approval_id || null,
      log.error_message || null,
      log.execution_result_json || null
    );

    return this.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(log.id) as AuditLog;
  }

  searchAuditLogs(filters?: {
    username?: string;
    toolName?: string;
    outcome?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { logs: AuditLog[]; total: number } {
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
    const params: (string | number)[] = [];
    const countParams: (string | number)[] = [];

    if (filters?.username && filters.username !== 'all') {
      sql += ' AND username = ?';
      countSql += ' AND username = ?';
      params.push(filters.username);
      countParams.push(filters.username);
    }

    if (filters?.toolName && filters.toolName !== 'all') {
      sql += ' AND tool_name = ?';
      countSql += ' AND tool_name = ?';
      params.push(filters.toolName);
      countParams.push(filters.toolName);
    }

    if (filters?.outcome && filters.outcome !== 'all') {
      sql += ' AND outcome = ?';
      countSql += ' AND outcome = ?';
      params.push(filters.outcome);
      countParams.push(filters.outcome);
    }

    if (filters?.search && filters.search.trim() !== '') {
      const wildcard = `%${filters.search.trim()}%`;
      sql += ' AND (arguments_json LIKE ? OR execution_result_json LIKE ? OR error_message LIKE ? OR target_entity_type LIKE ?)';
      countSql += ' AND (arguments_json LIKE ? OR execution_result_json LIKE ? OR error_message LIKE ? OR target_entity_type LIKE ?)';
      params.push(wildcard, wildcard, wildcard, wildcard);
      countParams.push(wildcard, wildcard, wildcard, wildcard);
    }

    sql += ' ORDER BY created_at DESC';

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = this.db.prepare(sql).all(...params) as AuditLog[];
    const totalResult = this.db.prepare(countSql).get(...countParams) as { count: number };

    return {
      logs,
      total: totalResult.count
    };
  }

  // Session storage
  createSession(token: string, userId: string, csrfToken: string, durationHours = 24): void {
    const expiresAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (token, user_id, csrf_token, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(token, userId, csrfToken, expiresAt);
  }

  getSession(token: string): { user: SafeUser; csrf_token: string } | undefined {
    const row = this.db.prepare(`
      SELECT s.token, s.csrf_token, s.expires_at, u.id, u.username, u.full_name, u.role, u.created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(token) as { token: string; csrf_token: string; expires_at: string; id: string; username: string; full_name: string; role: any; created_at: string } | undefined;

    if (!row) return undefined;

    return {
      user: {
        id: row.id,
        username: row.username,
        full_name: row.full_name,
        role: row.role,
        created_at: row.created_at
      },
      csrf_token: row.csrf_token
    };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
