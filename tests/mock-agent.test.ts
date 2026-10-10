import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { BusinessDb } from '../src/db/database.js';
import { IntentRouter } from '../src/agent/intent-router.js';
import { LocalMockAgent } from '../src/agent/mock-agent.js';
import type { SafeUser } from '../src/types/index.js';

describe('Local Mock Agent & Intent Routing', () => {
  let db: Database.Database;
  let businessDb: BusinessDb;
  let router: IntentRouter;
  let agent: LocalMockAgent;

  const staffUser: SafeUser = {
    id: 'usr-staff-01',
    username: 'staff',
    full_name: 'Marcus Rodriguez',
    role: 'staff',
    created_at: new Date().toISOString()
  };

  const readonlyUser: SafeUser = {
    id: 'usr-readonly-01',
    username: 'readonly',
    full_name: 'Alex Taylor',
    role: 'readonly',
    created_at: new Date().toISOString()
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    seedDatabase(db, true);
    businessDb = new BusinessDb(db);
    router = new IntentRouter();
    agent = new LocalMockAgent(businessDb);
  });

  afterEach(() => {
    db.close();
  });

  it('should route "Which clients have overdue invoices?" correctly', () => {
    const r = router.route('Which clients have overdue invoices?');
    expect(r.intent).toBe('OVERDUE_INVOICES');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('should route "Show me the details of invoice INV-1002" correctly and extract invoice ID', () => {
    const r = router.route('Show me the details of invoice INV-1002');
    expect(r.intent).toBe('INVOICE_DETAILS');
    expect(r.entities.invoiceId).toBe('INV-1002');
  });

  it('should route cross-system query "Which clients have overdue invoices and active projects?"', () => {
    const r = router.route('Which clients have overdue invoices and active projects?');
    expect(r.intent).toBe('OVERDUE_INVOICES_AND_ACTIVE_PROJECTS');
  });

  it('should route "Show the current status of the Atlas migration project"', () => {
    const r = router.route('Show the current status of the Atlas migration project');
    expect(r.intent).toBe('PROJECT_STATUS');
    expect(r.entities.projectName).toBe('PRJ-ATLAS');
  });

  it('should route "List all open tasks for Acme Corp"', () => {
    const r = router.route('List all open tasks for Acme Corp');
    expect(r.intent).toBe('CLIENT_OPEN_TASKS');
    expect(r.entities.clientName).toContain('Acme');
  });

  it('should route "Create a follow-up task for the client with the most overdue invoice"', () => {
    const r = router.route('Create a follow-up task for the client with the most overdue invoice');
    expect(r.intent).toBe('CREATE_FOLLOWUP_TASK_MOST_OVERDUE');
  });

  it('should route "Update the Atlas migration project to blocked"', () => {
    const r = router.route('Update the Atlas migration project to blocked');
    expect(r.intent).toBe('UPDATE_PROJECT_STATUS');
    expect(r.entities.projectName).toBe('PRJ-ATLAS');
    expect(r.entities.projectStatus).toBe('blocked');
  });

  it('should execute cross-system query and synthesize multiple MCP tool results accurately', async () => {
    const res = await agent.handleUserMessage('Which clients have overdue invoices and active projects?', staffUser);
    expect(res.intentRecognized).toBe(true);
    expect(res.toolsInvoked.length).toBeGreaterThanOrEqual(2);
    
    // Tools invoked should include list_overdue_invoices and list_projects
    const toolNames = res.toolsInvoked.map(t => t.tool);
    expect(toolNames).toContain('list_overdue_invoices');
    expect(toolNames).toContain('list_projects');

    // Message must mention the matching clients (e.g. Acme, Globex, Pied Piper)
    expect(res.message).toContain('Acme Corporation');
    expect(res.message).toContain('Globex Corporation');
  });

  it('should create write proposal without mutating database for "Create a follow-up task for most overdue invoice"', async () => {
    const taskCountBefore = businessDb.listTasks().length;

    const res = await agent.handleUserMessage('Create a follow-up task for the client with the most overdue invoice', staffUser);
    expect(res.intentRecognized).toBe(true);
    expect(res.pendingApproval).toBeDefined();
    expect(res.pendingApproval?.status).toBe('pending');
    expect(res.pendingApproval?.tool_name).toBe('create_followup_task');

    // Task count in SQLite must NOT have increased yet!
    const taskCountAfter = businessDb.listTasks().length;
    expect(taskCountAfter).toBe(taskCountBefore);
  });

  it('should block read-only user from proposing write actions', async () => {
    const res = await agent.handleUserMessage('Update the Atlas migration project to blocked', readonlyUser);
    expect(res.message).toContain('Access Denied');
    expect(res.pendingApproval).toBeUndefined();
  });

  it('should return clear help guidelines for unknown queries', async () => {
    const res = await agent.handleUserMessage('Make me a coffee', staffUser);
    expect(res.intentRecognized).toBe(false);
    expect(res.message).toContain('LOCAL MOCK AGENT — NO REAL AI CONNECTED');
    expect(res.message).toContain('Supported Commands');
  });
});
