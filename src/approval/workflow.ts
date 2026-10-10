import { v4 as uuidv4 } from 'uuid';
import { BusinessDb } from '../db/database.js';
import { ToolExecutor } from '../mcp/tools.js';
import { AuditService } from '../audit/logger.js';
import type { SafeUser, ApprovalRequest } from '../types/index.js';

export interface ProposedWriteAction {
  actionType: 'create_task' | 'add_client_note' | 'update_project_status';
  toolName: string;
  targetEntityType: 'client' | 'project' | 'invoice' | 'task';
  targetEntityId: string;
  targetEntityName?: string;
  parameters: Record<string, unknown>;
  previewSummary: string;
}

export class ApprovalWorkflowService {
  private toolExecutor: ToolExecutor;
  private auditService: AuditService;

  constructor(private db: BusinessDb) {
    this.toolExecutor = new ToolExecutor(db);
    this.auditService = new AuditService(db);
  }

  // Create a pending write proposal
  proposeAction(proposal: ProposedWriteAction, user: SafeUser): ApprovalRequest {
    if (user.role === 'readonly') {
      throw new Error('Read-only users are not permitted to propose write operations.');
    }

    const id = `appr-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 mins TTL

    const approval = this.db.createApprovalRequest({
      id,
      action_type: proposal.actionType,
      tool_name: proposal.toolName,
      target_entity_type: proposal.targetEntityType,
      target_entity_id: proposal.targetEntityId,
      target_entity_name: proposal.targetEntityName,
      parameters_json: JSON.stringify(proposal.parameters),
      preview_summary: proposal.previewSummary,
      requested_by_user_id: user.id,
      expires_at: expiresAt
    });

    // Log the proposed action audit event
    this.auditService.logToolExecution({
      user,
      toolName: proposal.toolName,
      args: proposal.parameters,
      outcome: 'proposed',
      targetEntityType: proposal.targetEntityType,
      targetEntityId: proposal.targetEntityId,
      approvalId: id,
      executionResult: {
        approvalId: id,
        preview: proposal.previewSummary,
        status: 'pending'
      }
    });

    return approval;
  }

  // Approve and execute a pending proposal
  async approveAction(approvalId: string, user: SafeUser): Promise<{
    success: boolean;
    approval: ApprovalRequest;
    executionResult?: unknown;
    error?: string;
  }> {
    if (user.role === 'readonly') {
      return {
        success: false,
        approval: this.db.getApprovalById(approvalId)!,
        error: 'Permission denied: Read-only users cannot approve actions.'
      };
    }

    const approval = this.db.getApprovalById(approvalId);
    if (!approval) {
      return {
        success: false,
        approval: null as any,
        error: `Approval request '${approvalId}' not found.`
      };
    }

    // Check if expired
    if (new Date(approval.expires_at) <= new Date() || approval.status === 'expired') {
      this.db.updateApprovalStatus(approval.id, 'expired', user.id);
      return {
        success: false,
        approval: this.db.getApprovalById(approvalId)!,
        error: 'Approval request has expired and cannot be executed.'
      };
    }

    // Check if already processed
    if (approval.status !== 'pending') {
      return {
        success: false,
        approval,
        error: `Approval request has already been ${approval.status}. Cannot execute again.`
      };
    }

    // Execute the underlying tool operation
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(approval.parameters_json);
    } catch {
      params = {};
    }

    const execResult = await this.toolExecutor.executeTool(approval.tool_name, params, user);

    if (!execResult.success) {
      this.auditService.logToolExecution({
        user,
        toolName: approval.tool_name,
        args: params,
        outcome: 'failure',
        targetEntityType: approval.target_entity_type,
        targetEntityId: approval.target_entity_id,
        approvalId: approval.id,
        errorMessage: execResult.error
      });

      return {
        success: false,
        approval,
        error: `Failed to execute approved action: ${execResult.error}`
      };
    }

    // Mark approval as approved
    const updatedApproval = this.db.updateApprovalStatus(approval.id, 'approved', user.id)!;

    // Log the successful execution audit event
    this.auditService.logToolExecution({
      user,
      toolName: approval.tool_name,
      args: params,
      outcome: 'approved_executed',
      targetEntityType: approval.target_entity_type,
      targetEntityId: approval.target_entity_id,
      approvalId: approval.id,
      executionResult: execResult.data
    });

    return {
      success: true,
      approval: updatedApproval,
      executionResult: execResult.data
    };
  }

  // Reject a pending action
  rejectAction(approvalId: string, user: SafeUser, reason?: string): {
    success: boolean;
    approval: ApprovalRequest;
    error?: string;
  } {
    if (user.role === 'readonly') {
      return {
        success: false,
        approval: this.db.getApprovalById(approvalId)!,
        error: 'Permission denied: Read-only users cannot reject actions.'
      };
    }

    const approval = this.db.getApprovalById(approvalId);
    if (!approval) {
      return {
        success: false,
        approval: null as any,
        error: `Approval request '${approvalId}' not found.`
      };
    }

    if (approval.status !== 'pending') {
      return {
        success: false,
        approval,
        error: `Approval request has already been ${approval.status}.`
      };
    }

    const updatedApproval = this.db.updateApprovalStatus(
      approval.id,
      'rejected',
      user.id,
      reason || 'Rejected by user.'
    )!;

    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(approval.parameters_json);
    } catch {
      params = {};
    }

    this.auditService.logToolExecution({
      user,
      toolName: approval.tool_name,
      args: params,
      outcome: 'rejected',
      targetEntityType: approval.target_entity_type,
      targetEntityId: approval.target_entity_id,
      approvalId: approval.id,
      errorMessage: reason || 'Rejected by user.'
    });

    return {
      success: true,
      approval: updatedApproval
    };
  }

  listApprovals(status?: string): ApprovalRequest[] {
    return this.db.listApprovals(status);
  }

  getApprovalById(id: string): ApprovalRequest | undefined {
    return this.db.getApprovalById(id);
  }
}
