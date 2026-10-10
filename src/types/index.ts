export type UserRole = 'admin' | 'staff' | 'readonly';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export type SafeUser = Omit<User, 'password_hash'>;

export interface Client {
  id: string;
  name: string;
  industry: string;
  tier: 'tier_1' | 'tier_2' | 'tier_3' | 'enterprise';
  status: 'active' | 'inactive' | 'prospect';
  primary_contact_name: string;
  primary_email: string;
  phone: string;
  notes?: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  amount: number;
  currency: string;
  status: 'draft' | 'paid' | 'unpaid' | 'overdue' | 'cancelled';
  due_date: string;
  issue_date: string;
  paid_at?: string | null;
  description?: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  client_id: string;
  status: 'planning' | 'active' | 'blocked' | 'on_hold' | 'completed';
  budget: number;
  description: string;
  start_date: string;
  target_completion_date: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  project_id?: string | null;
  client_id?: string | null;
  assigned_to_user_id?: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  title: string;
  doc_type: 'contract' | 'proposal' | 'invoice_pdf' | 'report' | 'spec';
  client_id?: string | null;
  project_id?: string | null;
  file_path: string;
  summary: string;
  created_at: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  action_type: 'create_task' | 'add_client_note' | 'update_project_status';
  tool_name: string;
  target_entity_type: string;
  target_entity_id: string;
  target_entity_name?: string;
  parameters_json: string;
  preview_summary: string;
  status: ApprovalStatus;
  requested_by_user_id: string;
  requested_by_username?: string;
  reviewed_by_user_id?: string | null;
  reviewed_by_username?: string | null;
  rejection_reason?: string | null;
  requested_at: string;
  reviewed_at?: string | null;
  expires_at: string;
}

export type AuditOutcome = 'success' | 'failure' | 'proposed' | 'approved_executed' | 'rejected';

export interface AuditLog {
  id: string;
  user_id: string;
  username: string;
  user_role: UserRole;
  tool_name: string;
  target_entity_type?: string | null;
  target_entity_id?: string | null;
  arguments_json: string;
  outcome: AuditOutcome;
  approval_id?: string | null;
  error_message?: string | null;
  execution_result_json?: string | null;
  created_at: string;
}

export interface ToolInvocationRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  outcome: 'success' | 'failure' | 'proposed';
  error?: string;
  executionTimeMs?: number;
}

export interface AgentResponse {
  message: string;
  toolsInvoked: ToolInvocationRecord[];
  pendingApproval?: ApprovalRequest | null;
  data?: unknown;
  intentRecognized: boolean;
  intentName?: string;
}
