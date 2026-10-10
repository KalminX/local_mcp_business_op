import { Router } from 'express';
import { BusinessDb } from '../db/database.js';
import { AuthService, requireAuth, requireRole, verifyCsrf, type AuthenticatedRequest } from '../auth/session.js';
import { LocalMockAgent } from '../agent/mock-agent.js';
import { ApprovalWorkflowService } from '../approval/workflow.js';
import { AuditService } from '../audit/logger.js';
import { seedDatabase } from '../db/seed.js';

export function createApiRouter(db: BusinessDb): Router {
  const router = Router();
  const authService = new AuthService(db);
  const agent = new LocalMockAgent(db);
  const approvalService = new ApprovalWorkflowService(db);
  const auditService = new AuditService(db);

  // ---------------------------------------------
  // AUTH ROUTES
  // ---------------------------------------------
  router.post('/auth/login', (req: AuthenticatedRequest, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = authService.authenticate(username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.cookie('ops_session', result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 3600 * 1000
    });

    return res.json({
      success: true,
      user: result.user,
      csrfToken: result.csrfToken
    });
  });

  router.post('/auth/logout', (req: AuthenticatedRequest, res) => {
    const sessionToken = req.cookies?.['ops_session'];
    if (sessionToken) {
      authService.logout(sessionToken);
    }
    res.clearCookie('ops_session');
    return res.json({ success: true });
  });

  router.get('/auth/me', (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.json({ authenticated: false, user: null, csrfToken: null });
    }
    return res.json({
      authenticated: true,
      user: req.user,
      csrfToken: req.csrfToken
    });
  });

  // Quick switch for local demo convenience
  router.post('/auth/switch-user', (req: AuthenticatedRequest, res) => {
    const { username } = req.body || {};
    const validUsers: Record<string, string> = {
      admin: 'admin123',
      staff: 'staff123',
      readonly: 'readonly123'
    };

    if (!validUsers[username]) {
      return res.status(400).json({ error: 'Invalid demo user. Use "admin", "staff", or "readonly"' });
    }

    const result = authService.authenticate(username, validUsers[username]);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.cookie('ops_session', result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 3600 * 1000
    });

    return res.json({
      success: true,
      user: result.user,
      csrfToken: result.csrfToken
    });
  });

  // ---------------------------------------------
  // AGENT CHAT ROUTE
  // ---------------------------------------------
  router.post('/agent/chat', requireAuth, verifyCsrf, async (req: AuthenticatedRequest, res) => {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    try {
      const response = await agent.handleUserMessage(message, req.user!);
      return res.json({
        success: true,
        response
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Agent processing error: ${err.message || String(err)}`
      });
    }
  });

  // ---------------------------------------------
  // APPROVALS ROUTES
  // ---------------------------------------------
  router.get('/approvals', requireAuth, (req: AuthenticatedRequest, res) => {
    const status = req.query.status as string;
    const approvals = approvalService.listApprovals(status);
    return res.json({ approvals });
  });

  router.get('/approvals/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string;
    const approval = approvalService.getApprovalById(id);
    if (!approval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }
    return res.json({ approval });
  });

  router.post('/approvals/:id/approve', requireAuth, verifyCsrf, async (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string;
    const result = await approvalService.approveAction(id, req.user!);
    if (!result.success) {
      return res.status(400).json({ error: result.error, approval: result.approval });
    }
    return res.json(result);
  });

  router.post('/approvals/:id/reject', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res) => {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    const result = approvalService.rejectAction(id, req.user!, reason);
    if (!result.success) {
      return res.status(400).json({ error: result.error, approval: result.approval });
    }
    return res.json(result);
  });

  // ---------------------------------------------
  // AUDIT LOGS ROUTE
  // ---------------------------------------------
  router.get('/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    // Only staff and admin can view full audit logs
    if (req.user?.role === 'readonly') {
      // Return redacted/limited logs or allow read-only viewing of logs
    }

    const { username, toolName, outcome, search, limit, offset } = req.query;
    const results = auditService.getAuditLogs({
      username: username as string,
      toolName: toolName as string,
      outcome: outcome as string,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0
    });

    return res.json(results);
  });

  // ---------------------------------------------
  // DATA EXPLORER ROUTES
  // ---------------------------------------------
  router.get('/data/overview', requireAuth, (req: AuthenticatedRequest, res) => {
    const clients = db.searchClients();
    const invoices = db.listInvoices();
    const overdueInvoices = db.listOverdueInvoices();
    const projects = db.listProjects();
    const tasks = db.listTasks();
    const pendingApprovals = db.listApprovals('pending');

    const totalOverdueAmount = overdueInvoices.reduce((s, i) => s + i.amount, 0);

    return res.json({
      clientsCount: clients.length,
      invoicesCount: invoices.length,
      overdueInvoicesCount: overdueInvoices.length,
      totalOverdueAmount,
      activeProjectsCount: projects.filter(p => p.status === 'active').length,
      openTasksCount: tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length,
      pendingApprovalsCount: pendingApprovals.length
    });
  });

  router.get('/data/clients', requireAuth, (req: AuthenticatedRequest, res) => {
    const { query, tier, status } = req.query;
    const clients = db.searchClients(query as string, tier as string, status as string);
    return res.json({ clients });
  });

  router.get('/data/invoices', requireAuth, (req: AuthenticatedRequest, res) => {
    const { clientId, status } = req.query;
    const invoices = db.listInvoices(clientId as string, status as string);
    return res.json({ invoices });
  });

  router.get('/data/projects', requireAuth, (req: AuthenticatedRequest, res) => {
    const { clientId, status } = req.query;
    const projects = db.listProjects(clientId as string, status as string);
    return res.json({ projects });
  });

  router.get('/data/tasks', requireAuth, (req: AuthenticatedRequest, res) => {
    const { clientId, projectId, status } = req.query;
    const tasks = db.listTasks(clientId as string, projectId as string, status as string);
    return res.json({ tasks });
  });

  router.get('/data/documents', requireAuth, (req: AuthenticatedRequest, res) => {
    const { query, docType, clientId } = req.query;
    const documents = db.searchDocuments(query as string, docType as string, clientId as string);
    return res.json({ documents });
  });

  // ---------------------------------------------
  // SYSTEM / DATABASE RESET
  // ---------------------------------------------
  router.post('/system/reset-db', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can reset the demo database' });
    }

    try {
      const rawDb = (db as any).db;
      seedDatabase(rawDb, true);
      return res.json({ success: true, message: 'Database reset to initial deterministic state.' });
    } catch (err: any) {
      return res.status(500).json({ error: `Reset failed: ${err.message}` });
    }
  });

  return router;
}
