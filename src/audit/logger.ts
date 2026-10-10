import { v4 as uuidv4 } from 'uuid';
import { BusinessDb } from '../db/database.js';
import type { SafeUser, AuditLog, AuditOutcome } from '../types/index.js';

export class AuditService {
  constructor(private db: BusinessDb) {}

  private sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
    if (!args || typeof args !== 'object') return {};
    
    const sensitiveKeys = ['password', 'password_hash', 'token', 'session', 'secret', 'authorization', 'csrf'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeArguments(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  logToolExecution(params: {
    user: SafeUser;
    toolName: string;
    args: Record<string, unknown>;
    outcome: AuditOutcome;
    targetEntityType?: string;
    targetEntityId?: string;
    approvalId?: string;
    errorMessage?: string;
    executionResult?: unknown;
  }): AuditLog {
    const id = `aud-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
    const sanitizedArgs = this.sanitizeArguments(params.args);

    return this.db.createAuditLog({
      id,
      user_id: params.user.id,
      username: params.user.username,
      user_role: params.user.role,
      tool_name: params.toolName,
      target_entity_type: params.targetEntityType || null,
      target_entity_id: params.targetEntityId || null,
      arguments_json: JSON.stringify(sanitizedArgs),
      outcome: params.outcome,
      approval_id: params.approvalId || null,
      error_message: params.errorMessage || null,
      execution_result_json: params.executionResult ? JSON.stringify(params.executionResult) : null
    });
  }

  getAuditLogs(filters?: {
    username?: string;
    toolName?: string;
    outcome?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.db.searchAuditLogs(filters);
  }
}
