import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { BusinessDb } from '../src/db/database.js';
import { ToolExecutor, MCP_TOOLS } from '../src/mcp/tools.js';

describe('MCP Tools & Business Logic', () => {
  let db: Database.Database;
  let businessDb: BusinessDb;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    seedDatabase(db, true);
    businessDb = new BusinessDb(db);
    toolExecutor = new ToolExecutor(businessDb);
  });

  afterEach(() => {
    db.close();
  });

  it('should list all registered MCP tools with valid schemas', () => {
    expect(Object.keys(MCP_TOOLS).length).toBeGreaterThanOrEqual(10);
    expect(MCP_TOOLS.search_clients).toBeDefined();
    expect(MCP_TOOLS.list_overdue_invoices).toBeDefined();
    expect(MCP_TOOLS.get_invoice_details).toBeDefined();
    expect(MCP_TOOLS.get_project_status).toBeDefined();
    expect(MCP_TOOLS.create_followup_task).toBeDefined();
  });

  it('should validate tool arguments using Zod and reject invalid payloads', async () => {
    // Missing required clientId
    const res1 = await toolExecutor.executeTool('get_client_details', {});
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('clientId');

    // Missing required invoiceId
    const res2 = await toolExecutor.executeTool('get_invoice_details', {});
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('invoiceId');

    // Invalid priority enum
    const res3 = await toolExecutor.executeTool('create_followup_task', {
      clientId: 'cli-acme-01',
      title: 'Valid title',
      priority: 'super_ultra_high'
    });
    expect(res3.success).toBe(false);
    expect(res3.error).toContain('priority');
  });

  it('should look up overdue invoices accurately with days overdue calculated', async () => {
    const res = await toolExecutor.executeTool('list_overdue_invoices', {});
    expect(res.success).toBe(true);
    expect(res.data.count).toBeGreaterThan(0);
    expect(res.data.totalOverdueAmount).toBeGreaterThan(0);

    const first = res.data.overdueInvoices[0];
    expect(first.client_name).toBeDefined();
    expect(first.days_overdue).toBeGreaterThan(0);
    expect(first.amount).toBeGreaterThan(0);
  });

  it('should look up invoice details by ID or invoice number (INV-1002)', async () => {
    const res = await toolExecutor.executeTool('get_invoice_details', { invoiceId: 'INV-1002' });
    expect(res.success).toBe(true);
    expect(res.data.invoice.invoice_number).toBe('INV-1002');
    expect(res.data.invoice.amount).toBe(78000);
    expect(res.data.client.name).toBe('Acme Corporation');
  });

  it('should handle nonexistent invoice lookups gracefully', async () => {
    const res = await toolExecutor.executeTool('get_invoice_details', { invoiceId: 'INV-999999' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invoice not found');
  });

  it('should retrieve project status and linked tasks for PRJ-ATLAS', async () => {
    const res = await toolExecutor.executeTool('get_project_status', { projectId: 'PRJ-ATLAS' });
    expect(res.success).toBe(true);
    expect(res.data.project.code).toBe('PRJ-ATLAS');
    expect(res.data.client.name).toBe('Acme Corporation');
    expect(res.data.metrics.totalTasks).toBeGreaterThan(0);
  });

  it('should search documents repository by type and keywords', async () => {
    const res = await toolExecutor.executeTool('search_documents', { query: 'MSA' });
    expect(res.success).toBe(true);
    expect(res.data.documents.length).toBeGreaterThan(0);
    expect(res.data.documents[0].title).toContain('Master Services Agreement');
  });
});
