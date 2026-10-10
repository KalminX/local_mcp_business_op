import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { BusinessDb } from '../src/db/database.js';
import { ApprovalWorkflowService } from '../src/approval/workflow.js';
import { AuditService } from '../src/audit/logger.js';
import type { SafeUser } from '../src/types/index.js';

describe('Approval Workflows & Security Policies', () => {
  let db: Database.Database;
  let businessDb: BusinessDb;
  let approvalService: ApprovalWorkflowService;
  let auditService: AuditService;

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

  const adminUser: SafeUser = {
    id: 'usr-admin-01',
    username: 'admin',
    full_name: 'Sarah Chen',
    role: 'admin',
    created_at: new Date().toISOString()
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    seedDatabase(db, true);
    businessDb = new BusinessDb(db);
    approvalService = new ApprovalWorkflowService(businessDb);
    auditService = new AuditService(businessDb);
  });

  afterEach(() => {
    db.close();
  });

  it('should allow staff to propose write actions with preview summary', () => {
    const proposal = approvalService.proposeAction(
      {
        actionType: 'update_project_status',
        toolName: 'update_project_status',
        targetEntityType: 'project',
        targetEntityId: 'prj-atlas-01',
        targetEntityName: 'Atlas ERP Migration',
        parameters: { projectId: 'prj-atlas-01', status: 'blocked' },
        previewSummary: 'Update Atlas ERP Migration status to blocked.'
      },
      staffUser
    );

    expect(proposal.id).toBeDefined();
    expect(proposal.status).toBe('pending');
    expect(proposal.preview_summary).toBe('Update Atlas ERP Migration status to blocked.');
    expect(proposal.requested_by_user_id).toBe(staffUser.id);

    // Verify audit log has 'proposed' entry
    const auditRes = auditService.getAuditLogs({ toolName: 'update_project_status' });
    expect(auditRes.logs.length).toBeGreaterThanOrEqual(1);
    expect(auditRes.logs[0].outcome).toBe('proposed');
  });

  it('should reject write proposals from read-only users', () => {
    expect(() => {
      approvalService.proposeAction(
        {
          actionType: 'update_project_status',
          toolName: 'update_project_status',
          targetEntityType: 'project',
          targetEntityId: 'prj-atlas-01',
          parameters: { projectId: 'prj-atlas-01', status: 'blocked' },
          previewSummary: 'Unauthorized update'
        },
        readonlyUser
      );
    }).toThrow(/Read-only users/);
  });

  it('should execute database mutation only upon valid approval', async () => {
    // 1. Initial project status is active
    const projectBefore = businessDb.getProjectByIdOrCode('PRJ-ATLAS')!;
    expect(projectBefore.status).toBe('active');

    // 2. Propose change
    const proposal = approvalService.proposeAction(
      {
        actionType: 'update_project_status',
        toolName: 'update_project_status',
        targetEntityType: 'project',
        targetEntityId: projectBefore.id,
        targetEntityName: projectBefore.name,
        parameters: { projectId: projectBefore.id, status: 'blocked' },
        previewSummary: 'Update status to blocked'
      },
      staffUser
    );

    // Project should STILL be active before approval!
    expect(businessDb.getProjectByIdOrCode('PRJ-ATLAS')!.status).toBe('active');

    // 3. Approve change
    const approveRes = await approvalService.approveAction(proposal.id, adminUser);
    expect(approveRes.success).toBe(true);
    expect(approveRes.approval.status).toBe('approved');

    // Project should NOW be blocked in SQLite!
    const projectAfter = businessDb.getProjectByIdOrCode('PRJ-ATLAS')!;
    expect(projectAfter.status).toBe('blocked');

    // Audit log should have approved_executed entry
    const auditRes = auditService.getAuditLogs({ outcome: 'approved_executed' });
    expect(auditRes.logs.length).toBeGreaterThanOrEqual(1);
    expect(auditRes.logs[0].approval_id).toBe(proposal.id);
  });

  it('should prevent duplicate approval executions (idempotency)', async () => {
    const proposal = approvalService.proposeAction(
      {
        actionType: 'create_task',
        toolName: 'create_followup_task',
        targetEntityType: 'client',
        targetEntityId: 'cli-acme-01',
        parameters: { clientId: 'cli-acme-01', title: 'Test idempotent task', priority: 'high' },
        previewSummary: 'Create task'
      },
      staffUser
    );

    // First approval succeeds
    const firstRes = await approvalService.approveAction(proposal.id, staffUser);
    expect(firstRes.success).toBe(true);

    // Count tasks for acme
    const taskCountBefore = businessDb.listTasks('cli-acme-01').length;

    // Second approval attempt MUST fail
    const secondRes = await approvalService.approveAction(proposal.id, staffUser);
    expect(secondRes.success).toBe(false);
    expect(secondRes.error).toContain('already been approved');

    // No extra task should have been created
    const taskCountAfter = businessDb.listTasks('cli-acme-01').length;
    expect(taskCountAfter).toBe(taskCountBefore);
  });

  it('should reject actions and record reason without modifying database', async () => {
    const proposal = approvalService.proposeAction(
      {
        actionType: 'add_client_note',
        toolName: 'add_client_note',
        targetEntityType: 'client',
        targetEntityId: 'cli-acme-01',
        parameters: { clientId: 'cli-acme-01', note: 'Rejected note content' },
        previewSummary: 'Add client note'
      },
      staffUser
    );

    const clientBefore = businessDb.getClientById('cli-acme-01')!;
    const notesBefore = clientBefore.notes;

    const rejectRes = approvalService.rejectAction(proposal.id, adminUser, 'Unverified customer communication');
    expect(rejectRes.success).toBe(true);
    expect(rejectRes.approval.status).toBe('rejected');
    expect(rejectRes.approval.rejection_reason).toBe('Unverified customer communication');

    // Notes must NOT have changed
    const clientAfter = businessDb.getClientById('cli-acme-01')!;
    expect(clientAfter.notes).toBe(notesBefore);

    // Trying to approve a rejected request must fail
    const approveAttempt = await approvalService.approveAction(proposal.id, staffUser);
    expect(approveAttempt.success).toBe(false);
    expect(approveAttempt.error).toContain('already been rejected');
  });

  it('should expire stale approval requests and block execution', async () => {
    // Propose an action
    const proposal = approvalService.proposeAction(
      {
        actionType: 'update_project_status',
        toolName: 'update_project_status',
        targetEntityType: 'project',
        targetEntityId: 'prj-atlas-01',
        parameters: { projectId: 'prj-atlas-01', status: 'completed' },
        previewSummary: 'Mark project complete'
      },
      staffUser
    );

    // Artificially expire the proposal in SQLite
    db.prepare("UPDATE approval_requests SET expires_at = datetime('now', '-5 minutes') WHERE id = ?").run(proposal.id);

    // Attempting to approve must fail due to expiry
    const approveRes = await approvalService.approveAction(proposal.id, adminUser);
    expect(approveRes.success).toBe(false);
    expect(approveRes.error).toContain('expired');

    const updated = businessDb.getApprovalById(proposal.id)!;
    expect(updated.status).toBe('expired');
  });
});
