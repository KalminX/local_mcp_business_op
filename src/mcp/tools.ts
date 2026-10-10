import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { BusinessDb } from '../db/database.js';
import type { SafeUser } from '../types/index.js';

// Zod schemas for all tools
export const SearchClientsSchema = z.object({
  query: z.string().optional().describe('Search term for client name, contact name, email, or industry'),
  tier: z.enum(['tier_1', 'tier_2', 'tier_3', 'enterprise', 'all']).optional().describe('Filter by client tier'),
  status: z.enum(['active', 'inactive', 'prospect', 'all']).optional().describe('Filter by client status')
});

export const GetClientDetailsSchema = z.object({
  clientId: z.string().min(1, 'clientId is required').describe('ID or exact name of the client')
});

export const ListInvoicesSchema = z.object({
  clientId: z.string().optional().describe('Filter by client ID'),
  status: z.enum(['draft', 'paid', 'unpaid', 'overdue', 'cancelled', 'all']).optional().describe('Filter by invoice status')
});

export const ListOverdueInvoicesSchema = z.object({
  // No required arguments
});

export const GetInvoiceDetailsSchema = z.object({
  invoiceId: z.string().min(1, 'invoiceId is required').describe('Invoice ID or invoice number (e.g., INV-1002)')
});

export const ListProjectsSchema = z.object({
  clientId: z.string().optional().describe('Filter by client ID'),
  status: z.enum(['planning', 'active', 'blocked', 'on_hold', 'completed', 'all']).optional().describe('Filter by project status')
});

export const GetProjectStatusSchema = z.object({
  projectId: z.string().min(1, 'projectId is required').describe('Project ID, project code (e.g. PRJ-ATLAS), or project name')
});

export const ListOpenTasksSchema = z.object({
  clientId: z.string().optional().describe('Filter by client ID'),
  projectId: z.string().optional().describe('Filter by project ID')
});

export const SearchDocumentsSchema = z.object({
  query: z.string().optional().describe('Search term in document title or summary'),
  docType: z.enum(['contract', 'proposal', 'invoice_pdf', 'report', 'spec', 'all']).optional().describe('Filter by document type'),
  clientId: z.string().optional().describe('Filter by client ID')
});

export const GetDocumentMetadataSchema = z.object({
  documentId: z.string().min(1, 'documentId is required').describe('Document ID')
});

export const CreateFollowupTaskSchema = z.object({
  clientId: z.string().min(1, 'clientId is required').describe('Client ID for which the task is created'),
  title: z.string().min(3, 'Task title must be at least 3 characters').describe('Title / summary of the follow-up task'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium').describe('Priority of the task'),
  dueDate: z.string().optional().describe('Due date in ISO or YYYY-MM-DD format (optional)'),
  projectId: z.string().optional().describe('Associated project ID (optional)')
});

export const AddClientNoteSchema = z.object({
  clientId: z.string().min(1, 'clientId is required').describe('Target client ID'),
  note: z.string().min(2, 'Note must not be empty').describe('Note text to append to client record')
});

export const UpdateProjectStatusSchema = z.object({
  projectId: z.string().min(1, 'projectId is required').describe('Project ID or Project Code (e.g. PRJ-ATLAS)'),
  status: z.enum(['planning', 'active', 'blocked', 'on_hold', 'completed']).describe('New status for the project')
});

// Tool Definitions for MCP
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  isWriteOperation: boolean;
}

export const MCP_TOOLS: Record<string, ToolDefinition> = {
  search_clients: {
    name: 'search_clients',
    description: 'Search clients across CRM by name, contact name, email, industry, tier, or status.',
    schema: SearchClientsSchema,
    isWriteOperation: false
  },
  get_client_details: {
    name: 'get_client_details',
    description: 'Retrieve detailed client profile including active projects, invoices, open tasks, and documents.',
    schema: GetClientDetailsSchema,
    isWriteOperation: false
  },
  list_invoices: {
    name: 'list_invoices',
    description: 'List billing invoices with optional filtering by client and payment status.',
    schema: ListInvoicesSchema,
    isWriteOperation: false
  },
  list_overdue_invoices: {
    name: 'list_overdue_invoices',
    description: 'List all overdue invoices sorted by amount descending, including days overdue and client details.',
    schema: ListOverdueInvoicesSchema,
    isWriteOperation: false
  },
  get_invoice_details: {
    name: 'get_invoice_details',
    description: 'Get comprehensive details of a specific invoice by ID or invoice number (e.g., INV-1002).',
    schema: GetInvoiceDetailsSchema,
    isWriteOperation: false
  },
  list_projects: {
    name: 'list_projects',
    description: 'List enterprise projects with optional filtering by client and lifecycle status.',
    schema: ListProjectsSchema,
    isWriteOperation: false
  },
  get_project_status: {
    name: 'get_project_status',
    description: 'Retrieve current operational status, budget, timelines, and open tasks for a project by code or name.',
    schema: GetProjectStatusSchema,
    isWriteOperation: false
  },
  list_open_tasks: {
    name: 'list_open_tasks',
    description: 'List open and in-progress operational tasks filtered by client or project.',
    schema: ListOpenTasksSchema,
    isWriteOperation: false
  },
  search_documents: {
    name: 'search_documents',
    description: 'Search document repository for contracts, proposals, specs, or reports.',
    schema: SearchDocumentsSchema,
    isWriteOperation: false
  },
  get_document_metadata: {
    name: 'get_document_metadata',
    description: 'Retrieve metadata and summaries for a specific business document by ID.',
    schema: GetDocumentMetadataSchema,
    isWriteOperation: false
  },
  create_followup_task: {
    name: 'create_followup_task',
    description: 'Create a new operational or billing follow-up task for a client (Requires write approval).',
    schema: CreateFollowupTaskSchema,
    isWriteOperation: true
  },
  add_client_note: {
    name: 'add_client_note',
    description: 'Append an operational or communication note to a client record (Requires write approval).',
    schema: AddClientNoteSchema,
    isWriteOperation: true
  },
  update_project_status: {
    name: 'update_project_status',
    description: 'Change the lifecycle status of a project (e.g. active, blocked, on_hold, completed) (Requires write approval).',
    schema: UpdateProjectStatusSchema,
    isWriteOperation: true
  }
};

// Tool Executor
export class ToolExecutor {
  constructor(private db: BusinessDb) {}

  async executeTool(toolName: string, rawArgs: unknown, user?: SafeUser): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    isWriteOperation: boolean;
  }> {
    const toolDef = MCP_TOOLS[toolName];
    if (!toolDef) {
      return {
        success: false,
        error: `Unknown tool: '${toolName}'`,
        isWriteOperation: false
      };
    }

    // Validate arguments with Zod
    const parseResult = toolDef.schema.safeParse(rawArgs || {});
    if (!parseResult.success) {
      const issues = parseResult.error.issues || (parseResult.error as any).errors || [];
      const errorMsg = issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ') || parseResult.error.message;
      return {
        success: false,
        error: `Argument validation failed: ${errorMsg}`,
        isWriteOperation: toolDef.isWriteOperation
      };
    }

    const args: any = parseResult.data;

    try {
      switch (toolName) {
        // CRM
        case 'search_clients': {
          const clients = this.db.searchClients(args.query, args.tier, args.status);
          return {
            success: true,
            data: { clients, count: clients.length },
            isWriteOperation: false
          };
        }

        case 'get_client_details': {
          let client = this.db.getClientById(args.clientId);
          if (!client) {
            client = this.db.getClientByName(args.clientId);
          }

          if (!client) {
            return {
              success: false,
              error: `Client not found with identifier '${args.clientId}'`,
              isWriteOperation: false
            };
          }

          const invoices = this.db.listInvoices(client.id);
          const projects = this.db.listProjects(client.id);
          const tasks = this.db.listTasks(client.id);
          const documents = this.db.searchDocuments(undefined, undefined, client.id);

          return {
            success: true,
            data: {
              client,
              invoices,
              projects,
              tasks,
              documents,
              summary: {
                totalInvoices: invoices.length,
                overdueInvoices: invoices.filter(i => i.status === 'overdue').length,
                activeProjects: projects.filter(p => p.status === 'active').length,
                openTasks: tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length
              }
            },
            isWriteOperation: false
          };
        }

        // Accounting
        case 'list_invoices': {
          const invoices = this.db.listInvoices(args.clientId, args.status);
          return {
            success: true,
            data: { invoices, count: invoices.length },
            isWriteOperation: false
          };
        }

        case 'list_overdue_invoices': {
          const overdue = this.db.listOverdueInvoices();
          const totalOverdueAmount = overdue.reduce((sum, inv) => sum + inv.amount, 0);
          return {
            success: true,
            data: {
              overdueInvoices: overdue,
              count: overdue.length,
              totalOverdueAmount: totalOverdueAmount
            },
            isWriteOperation: false
          };
        }

        case 'get_invoice_details': {
          const invoice = this.db.getInvoiceById(args.invoiceId);
          if (!invoice) {
            return {
              success: false,
              error: `Invoice not found for '${args.invoiceId}'`,
              isWriteOperation: false
            };
          }

          const client = this.db.getClientById(invoice.client_id);
          return {
            success: true,
            data: {
              invoice,
              client
            },
            isWriteOperation: false
          };
        }

        // Project Management
        case 'list_projects': {
          const projects = this.db.listProjects(args.clientId, args.status);
          return {
            success: true,
            data: { projects, count: projects.length },
            isWriteOperation: false
          };
        }

        case 'get_project_status': {
          const project = this.db.getProjectByIdOrCode(args.projectId);
          if (!project) {
            return {
              success: false,
              error: `Project not found for identifier '${args.projectId}'`,
              isWriteOperation: false
            };
          }

          const client = this.db.getClientById(project.client_id);
          const tasks = this.db.listTasks(undefined, project.id);
          const documents = this.db.searchDocuments(undefined, undefined, undefined).filter(d => d.project_id === project.id);

          return {
            success: true,
            data: {
              project,
              client,
              tasks,
              documents,
              metrics: {
                totalTasks: tasks.length,
                openTasks: tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length,
                completedTasks: tasks.filter(t => t.status === 'completed').length
              }
            },
            isWriteOperation: false
          };
        }

        case 'list_open_tasks': {
          const tasks = this.db.listTasks(args.clientId, args.projectId);
          const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
          return {
            success: true,
            data: { tasks: openTasks, count: openTasks.length },
            isWriteOperation: false
          };
        }

        // Documents
        case 'search_documents': {
          const documents = this.db.searchDocuments(args.query, args.docType, args.clientId);
          return {
            success: true,
            data: { documents, count: documents.length },
            isWriteOperation: false
          };
        }

        case 'get_document_metadata': {
          const doc = this.db.getDocumentById(args.documentId);
          if (!doc) {
            return {
              success: false,
              error: `Document not found for id '${args.documentId}'`,
              isWriteOperation: false
            };
          }
          return {
            success: true,
            data: { document: doc },
            isWriteOperation: false
          };
        }

        // Direct write executions (used by approval executor after authorization)
        case 'create_followup_task': {
          let client = this.db.getClientById(args.clientId);
          if (!client) {
            client = this.db.getClientByName(args.clientId);
          }
          if (!client) {
            return {
              success: false,
              error: `Target client '${args.clientId}' does not exist`,
              isWriteOperation: true
            };
          }

          const taskId = `tsk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
          const task = this.db.createTask({
            id: taskId,
            title: args.title,
            client_id: client.id,
            project_id: args.projectId || null,
            priority: args.priority || 'medium',
            status: 'open',
            due_date: args.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
          });

          return {
            success: true,
            data: { task, message: `Created follow-up task "${task.title}" for ${client.name}` },
            isWriteOperation: true
          };
        }

        case 'add_client_note': {
          let client = this.db.getClientById(args.clientId);
          if (!client) {
            client = this.db.getClientByName(args.clientId);
          }
          if (!client) {
            return {
              success: false,
              error: `Client '${args.clientId}' does not exist`,
              isWriteOperation: true
            };
          }

          const updatedClient = this.db.updateClientNotes(client.id, args.note);
          return {
            success: true,
            data: { client: updatedClient, message: `Appended note to client "${client.name}"` },
            isWriteOperation: true
          };
        }

        case 'update_project_status': {
          const project = this.db.getProjectByIdOrCode(args.projectId);
          if (!project) {
            return {
              success: false,
              error: `Project '${args.projectId}' not found`,
              isWriteOperation: true
            };
          }

          const previousStatus = project.status;
          const updatedProject = this.db.updateProjectStatus(project.id, args.status);

          return {
            success: true,
            data: {
              project: updatedProject,
              previousStatus,
              newStatus: args.status,
              message: `Updated project "${project.name}" status from "${previousStatus}" to "${args.status}"`
            },
            isWriteOperation: true
          };
        }

        default:
          return {
            success: false,
            error: `Unsupported tool: ${toolName}`,
            isWriteOperation: false
          };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution error: ${err.message || String(err)}`,
        isWriteOperation: toolDef.isWriteOperation
      };
    }
  }
}
