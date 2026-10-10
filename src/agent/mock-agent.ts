import { IntentRouter } from './intent-router.js';
import { ToolExecutor } from '../mcp/tools.js';
import { ApprovalWorkflowService } from '../approval/workflow.js';
import { AuditService } from '../audit/logger.js';
import { BusinessDb } from '../db/database.js';
import type { SafeUser, AgentResponse, ToolInvocationRecord } from '../types/index.js';

export class LocalMockAgent {
  private router: IntentRouter;
  private toolExecutor: ToolExecutor;
  private approvalService: ApprovalWorkflowService;
  private auditService: AuditService;

  constructor(private db: BusinessDb) {
    this.router = new IntentRouter();
    this.toolExecutor = new ToolExecutor(db);
    this.approvalService = new ApprovalWorkflowService(db);
    this.auditService = new AuditService(db);
  }

  async handleUserMessage(query: string, user: SafeUser): Promise<AgentResponse> {
    const recognized = this.router.route(query);
    const toolsInvoked: ToolInvocationRecord[] = [];

    const callTool = async (name: string, args: Record<string, unknown>) => {
      const startTime = Date.now();
      const res = await this.toolExecutor.executeTool(name, args, user);
      const duration = Date.now() - startTime;

      const record: ToolInvocationRecord = {
        tool: name,
        args,
        result: res.data,
        outcome: res.success ? 'success' : 'failure',
        error: res.error,
        executionTimeMs: duration
      };
      toolsInvoked.push(record);

      // Audit read tools
      if (!res.isWriteOperation) {
        this.auditService.logToolExecution({
          user,
          toolName: name,
          args,
          outcome: res.success ? 'success' : 'failure',
          targetEntityType: (args as any)?.clientId ? 'client' : (args as any)?.projectId ? 'project' : (args as any)?.invoiceId ? 'invoice' : undefined,
          targetEntityId: (args as any)?.clientId || (args as any)?.projectId || (args as any)?.invoiceId || undefined,
          errorMessage: res.error,
          executionResult: res.data
        });
      }

      return res;
    };

    switch (recognized.intent) {
      // 1. Overdue invoices
      case 'OVERDUE_INVOICES': {
        const toolRes = await callTool('list_overdue_invoices', {});
        if (!toolRes.success) {
          return {
            message: `⚠️ **Error retrieving overdue invoices:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const data = toolRes.data;
        if (data.count === 0) {
          return {
            message: `✅ **No Overdue Invoices Found.** All client accounts are currently in good standing.`,
            toolsInvoked,
            data,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        let msg = `### 📋 Overdue Invoices Report\n\n`;
        msg += `Found **${data.count}** overdue invoice(s) totaling **$${data.totalOverdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}**:\n\n`;
        msg += `| Invoice # | Client | Amount | Due Date | Overdue By |\n`;
        msg += `|:---|:---|:---|:---|:---|\n`;

        for (const inv of data.overdueInvoices) {
          msg += `| **${inv.invoice_number}** | ${inv.client_name} | **$${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}** | ${inv.due_date} | 🚨 ${inv.days_overdue} days |\n`;
        }

        msg += `\n> *Data retrieved in real-time from SQLite database via MCP tool \`list_overdue_invoices\`.*`;

        return {
          message: msg,
          toolsInvoked,
          data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 2. Specific invoice details
      case 'INVOICE_DETAILS': {
        const invId = recognized.entities.invoiceId || 'INV-1002';
        const toolRes = await callTool('get_invoice_details', { invoiceId: invId });

        if (!toolRes.success) {
          return {
            message: `⚠️ **Invoice Lookup Failed:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { invoice, client } = toolRes.data;
        const statusEmoji = invoice.status === 'paid' ? '✅' : invoice.status === 'overdue' ? '🚨' : '⏳';

        let msg = `### 🧾 Invoice Summary: \`${invoice.invoice_number}\`\n\n`;
        msg += `- **Client:** ${client ? client.name : invoice.client_name} (\`${invoice.client_id}\`)\n`;
        msg += `- **Amount:** **$${invoice.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${invoice.currency}**\n`;
        msg += `- **Status:** ${statusEmoji} **${invoice.status.toUpperCase()}**\n`;
        msg += `- **Issue Date:** ${invoice.issue_date}\n`;
        msg += `- **Due Date:** ${invoice.due_date}\n`;
        if (invoice.paid_at) {
          msg += `- **Paid At:** ${new Date(invoice.paid_at).toLocaleString()}\n`;
        }
        if (invoice.description) {
          msg += `- **Description:** ${invoice.description}\n`;
        }

        if (client) {
          msg += `\n**Primary Contact:** ${client.primary_contact_name} (${client.primary_email} | ${client.phone})\n`;
        }

        return {
          message: msg,
          toolsInvoked,
          data: toolRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 3. Cross-system query: Overdue invoices AND active projects
      case 'OVERDUE_INVOICES_AND_ACTIVE_PROJECTS': {
        const [overdueRes, projectsRes] = await Promise.all([
          callTool('list_overdue_invoices', {}),
          callTool('list_projects', { status: 'active' })
        ]);

        if (!overdueRes.success || !projectsRes.success) {
          return {
            message: `⚠️ **Cross-system query failed:** ${overdueRes.error || projectsRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const overdueInvoices = overdueRes.data.overdueInvoices || [];
        const activeProjects = projectsRes.data.projects || [];

        // Build mapping
        const clientOverdueMap = new Map<string, typeof overdueInvoices>();
        for (const inv of overdueInvoices) {
          if (!clientOverdueMap.has(inv.client_id)) {
            clientOverdueMap.set(inv.client_id, []);
          }
          clientOverdueMap.get(inv.client_id)!.push(inv);
        }

        const clientActiveProjectsMap = new Map<string, typeof activeProjects>();
        for (const prj of activeProjects) {
          if (!clientActiveProjectsMap.has(prj.client_id)) {
            clientActiveProjectsMap.set(prj.client_id, []);
          }
          clientActiveProjectsMap.get(prj.client_id)!.push(prj);
        }

        // Find intersection of clients
        const intersectingClientIds = Array.from(clientOverdueMap.keys()).filter(id => clientActiveProjectsMap.has(id));

        if (intersectingClientIds.length === 0) {
          return {
            message: `ℹ️ **No clients currently have both overdue invoices and active projects simultaneously.**`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        // Fetch client details for richer synthesis
        const clientDetails = await Promise.all(
          intersectingClientIds.map(id => callTool('get_client_details', { clientId: id }))
        );

        let msg = `### 🔍 Cross-System Analysis: Clients with Overdue Invoices & Active Projects\n\n`;
        msg += `Identified **${intersectingClientIds.length}** client account(s) requiring immediate operational attention:\n\n`;

        for (const cRes of clientDetails) {
          if (!cRes.success) continue;
          const { client } = cRes.data;
          const invoices = clientOverdueMap.get(client.id) || [];
          const projects = clientActiveProjectsMap.get(client.id) || [];
          const totalOverdue = invoices.reduce((sum: number, i: any) => sum + i.amount, 0);

          msg += `#### 🏢 **${client.name}** (${client.industry} — Tier: \`${client.tier}\`)\n`;
          msg += `- **Primary Contact:** ${client.primary_contact_name} ([${client.primary_email}](mailto:${client.primary_email}))\n`;
          msg += `- **Total Overdue:** **$${totalOverdue.toLocaleString('en-US', { minimumFractionDigits: 2 })}** across ${invoices.length} invoice(s):\n`;
          for (const inv of invoices) {
            msg += `  - 🚨 \`${inv.invoice_number}\`: $${inv.amount.toLocaleString()} (Due: ${inv.due_date}, ${inv.days_overdue} days overdue)\n`;
          }
          msg += `- **Active Project(s):**\n`;
          for (const prj of projects) {
            msg += `  - ⚡ **${prj.name}** (\`${prj.code}\`) — Budget: $${prj.budget.toLocaleString()}\n`;
          }
          msg += `\n`;
        }

        msg += `> *Combined data from MCP tools: \`list_overdue_invoices\`, \`list_projects\`, and \`get_client_details\`.*`;

        return {
          message: msg,
          toolsInvoked,
          data: {
            matchingClientsCount: intersectingClientIds.length,
            clientIds: intersectingClientIds
          },
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 4. Project status
      case 'PROJECT_STATUS': {
        const projId = recognized.entities.projectName || 'PRJ-ATLAS';
        const toolRes = await callTool('get_project_status', { projectId: projId });

        if (!toolRes.success) {
          return {
            message: `⚠️ **Project Lookup Failed:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { project, client, tasks, metrics, documents } = toolRes.data;
        const statusEmoji = project.status === 'active' ? '🟢' : project.status === 'blocked' ? '🔴' : '🟡';

        let msg = `### 📊 Project Overview: **${project.name}** (\`${project.code}\`)\n\n`;
        msg += `- **Client:** ${client ? client.name : 'Unknown'}\n`;
        msg += `- **Status:** ${statusEmoji} **${project.status.toUpperCase()}**\n`;
        msg += `- **Budget:** $${project.budget.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
        msg += `- **Timeline:** ${project.start_date} to ${project.target_completion_date}\n`;
        msg += `- **Description:** ${project.description}\n\n`;

        msg += `#### 📌 Tasks (${metrics.openTasks} open / ${metrics.totalTasks} total):\n`;
        if (tasks.length === 0) {
          msg += `_No tasks recorded for this project._\n`;
        } else {
          for (const t of tasks) {
            const taskEmoji = t.status === 'completed' ? '✅' : t.priority === 'urgent' ? '🚨' : '🔹';
            msg += `- ${taskEmoji} **${t.title}** [Status: \`${t.status}\`, Priority: \`${t.priority}\`]\n`;
          }
        }

        if (documents && documents.length > 0) {
          msg += `\n#### 📄 Attached Documents:\n`;
          for (const doc of documents) {
            msg += `- 📎 **${doc.title}** (\`${doc.doc_type}\`)\n`;
          }
        }

        return {
          message: msg,
          toolsInvoked,
          data: toolRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 5. Open tasks for client
      case 'CLIENT_OPEN_TASKS': {
        const clientName = recognized.entities.clientName || 'Acme';
        // First find the client
        const searchRes = await callTool('search_clients', { query: clientName });
        if (!searchRes.success || searchRes.data.clients.length === 0) {
          return {
            message: `⚠️ **Client not found:** No client found matching "${clientName}".`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const client = searchRes.data.clients[0];
        const tasksRes = await callTool('list_open_tasks', { clientId: client.id });

        if (!tasksRes.success) {
          return {
            message: `⚠️ **Error loading tasks:** ${tasksRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { tasks, count } = tasksRes.data;
        let msg = `### 📝 Open Tasks for **${client.name}**\n\n`;
        if (count === 0) {
          msg += `No open tasks currently on file for ${client.name}.\n`;
        } else {
          msg += `Found **${count}** open task(s):\n\n`;
          for (const t of tasks) {
            const prioBadge = t.priority === 'urgent' ? '🚨 URGENT' : t.priority === 'high' ? '⚠️ HIGH' : '🔹 ' + t.priority.toUpperCase();
            msg += `- **${t.title}**\n`;
            msg += `  - **Priority:** ${prioBadge} | **Status:** \`${t.status}\` | **Due:** ${t.due_date || 'No date'}\n`;
            if (t.project_name) {
              msg += `  - **Project:** ${t.project_name}\n`;
            }
          }
        }

        return {
          message: msg,
          toolsInvoked,
          data: tasksRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 6. List all open tasks
      case 'LIST_OPEN_TASKS': {
        const toolRes = await callTool('list_open_tasks', {});
        if (!toolRes.success) {
          return {
            message: `⚠️ **Error listing tasks:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { tasks, count } = toolRes.data;
        let msg = `### 📋 All Open Operations Tasks (${count})\n\n`;
        for (const t of tasks) {
          const prioEmoji = t.priority === 'urgent' ? '🚨' : t.priority === 'high' ? '⚡' : '📌';
          msg += `- ${prioEmoji} **${t.title}**\n`;
          msg += `  - Client: **${t.client_name || 'N/A'}** | Project: *${t.project_name || 'N/A'}* | Due: ${t.due_date || 'N/A'}\n`;
        }

        return {
          message: msg,
          toolsInvoked,
          data: toolRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 7. Search clients
      case 'SEARCH_CLIENTS':
      case 'CLIENT_DETAILS': {
        const searchRes = await callTool('search_clients', { query: recognized.entities.searchQuery || recognized.entities.clientName });
        if (!searchRes.success) {
          return {
            message: `⚠️ **Error searching clients:** ${searchRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const clients = searchRes.data.clients;
        if (clients.length === 0) {
          return {
            message: `ℹ️ No clients found matching your search.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        if (clients.length === 1 || recognized.intent === 'CLIENT_DETAILS') {
          const detailsRes = await callTool('get_client_details', { clientId: clients[0].id });
          if (detailsRes.success) {
            const { client, summary, projects, invoices } = detailsRes.data;
            let msg = `### 🏢 Client Profile: **${client.name}**\n\n`;
            msg += `- **Industry:** ${client.industry} | **Tier:** \`${client.tier}\` | **Status:** \`${client.status}\`\n`;
            msg += `- **Primary Contact:** ${client.primary_contact_name} (${client.primary_email} | ${client.phone})\n`;
            msg += `- **Summary:** ${summary.activeProjects} active project(s), ${summary.overdueInvoices} overdue invoice(s), ${summary.openTasks} open task(s)\n`;
            if (client.notes) {
              msg += `\n**Client Notes:**\n\`\`\`\n${client.notes}\n\`\`\`\n`;
            }
            return {
              message: msg,
              toolsInvoked,
              data: detailsRes.data,
              intentRecognized: true,
              intentName: recognized.intent
            };
          }
        }

        let msg = `### 👥 Clients (${clients.length} found)\n\n`;
        for (const c of clients) {
          msg += `- **${c.name}** (${c.industry}) — Contact: ${c.primary_contact_name} (${c.primary_email})\n`;
        }

        return {
          message: msg,
          toolsInvoked,
          data: searchRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 8. List projects
      case 'LIST_PROJECTS': {
        const toolRes = await callTool('list_projects', {});
        if (!toolRes.success) {
          return {
            message: `⚠️ **Error listing projects:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { projects, count } = toolRes.data;
        let msg = `### 📁 Enterprise Projects (${count})\n\n`;
        for (const p of projects) {
          const statusEmoji = p.status === 'active' ? '🟢' : p.status === 'blocked' ? '🔴' : '🟡';
          msg += `- ${statusEmoji} **${p.name}** (\`${p.code}\`) — Client: **${p.client_name}** | Status: \`${p.status}\` | Budget: $${p.budget.toLocaleString()}\n`;
        }

        return {
          message: msg,
          toolsInvoked,
          data: toolRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 9. Search documents
      case 'SEARCH_DOCUMENTS': {
        const toolRes = await callTool('search_documents', { query: recognized.entities.searchQuery });
        if (!toolRes.success) {
          return {
            message: `⚠️ **Error searching documents:** ${toolRes.error}`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { documents, count } = toolRes.data;
        let msg = `### 📄 Document Repository (${count} found)\n\n`;
        if (count === 0) {
          msg += `No documents matching "${recognized.entities.searchQuery || ''}".\n`;
        } else {
          for (const d of documents) {
            msg += `- 📎 **${d.title}** (\`${d.doc_type}\`)\n`;
            msg += `  - Client: **${d.client_name || 'N/A'}** | Path: \`${d.file_path}\`\n`;
            msg += `  - Summary: ${d.summary}\n`;
          }
        }

        return {
          message: msg,
          toolsInvoked,
          data: toolRes.data,
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 10. WRITE ACTION: Create follow-up task for most overdue invoice
      case 'CREATE_FOLLOWUP_TASK_MOST_OVERDUE': {
        // Read-only permission check
        if (user.role === 'readonly') {
          return {
            message: `⛔ **Access Denied:** Read-only users (${user.username}) cannot propose or perform write actions.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        // 1. Fetch overdue invoices to find the top one
        const overdueRes = await callTool('list_overdue_invoices', {});
        if (!overdueRes.success || overdueRes.data.overdueInvoices.length === 0) {
          return {
            message: `ℹ️ **No overdue invoices found.** No follow-up task is required.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const topInvoice = overdueRes.data.overdueInvoices[0]; // Highest overdue
        const clientRes = await callTool('get_client_details', { clientId: topInvoice.client_id });
        const client = clientRes.success ? clientRes.data.client : null;

        const taskTitle = `Urgent collections follow-up for overdue invoice ${topInvoice.invoice_number} ($${topInvoice.amount.toLocaleString()})`;
        const previewSummary = `Create urgent follow-up task for ${topInvoice.client_name} regarding overdue invoice ${topInvoice.invoice_number} ($${topInvoice.amount.toLocaleString()}, ${topInvoice.days_overdue} days overdue).`;

        // Propose action (Pending Approval)
        const approval = this.approvalService.proposeAction(
          {
            actionType: 'create_task',
            toolName: 'create_followup_task',
            targetEntityType: 'client',
            targetEntityId: topInvoice.client_id,
            targetEntityName: topInvoice.client_name,
            parameters: {
              clientId: topInvoice.client_id,
              title: taskTitle,
              priority: 'urgent',
              dueDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]
            },
            previewSummary
          },
          user
        );

        let msg = `### ⚠️ Write Operation Proposed — Requires Approval\n\n`;
        msg += `Identified client **${topInvoice.client_name}** with the highest overdue invoice:\n`;
        msg += `- **Invoice:** \`${topInvoice.invoice_number}\`\n`;
        msg += `- **Overdue Amount:** **$${topInvoice.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}** (${topInvoice.days_overdue} days overdue)\n`;
        msg += `- **Proposed Task:** "${taskTitle}"\n`;
        msg += `- **Priority:** \`urgent\`\n\n`;
        msg += `> **Security Policy Notice:** Changes are stored as pending proposals and will not take effect in SQLite until approved by an authorized user.`;

        return {
          message: msg,
          toolsInvoked,
          pendingApproval: approval,
          data: { topInvoice, approval },
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 11. WRITE ACTION: Generic create follow-up task
      case 'CREATE_FOLLOWUP_TASK': {
        if (user.role === 'readonly') {
          return {
            message: `⛔ **Access Denied:** Read-only users cannot propose write actions.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const clientName = recognized.entities.clientName || 'Acme Corporation';
        const searchRes = await callTool('search_clients', { query: clientName });
        const client = searchRes.success && searchRes.data.clients.length > 0 ? searchRes.data.clients[0] : null;

        if (!client) {
          return {
            message: `⚠️ **Client not found:** Could not resolve client "${clientName}" for creating task.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const title = recognized.entities.taskTitle || `Follow-up regarding account review for ${client.name}`;
        const previewSummary = `Create follow-up task for ${client.name}: "${title}"`;

        const approval = this.approvalService.proposeAction(
          {
            actionType: 'create_task',
            toolName: 'create_followup_task',
            targetEntityType: 'client',
            targetEntityId: client.id,
            targetEntityName: client.name,
            parameters: {
              clientId: client.id,
              title,
              priority: 'high',
              dueDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
            },
            previewSummary
          },
          user
        );

        let msg = `### ⚠️ Write Operation Proposed — Requires Approval\n\n`;
        msg += `- **Target Client:** **${client.name}**\n`;
        msg += `- **Task Title:** "${title}"\n`;
        msg += `- **Priority:** \`high\`\n\n`;
        msg += `> **Security Policy Notice:** Click **Approve** to execute this database mutation.`;

        return {
          message: msg,
          toolsInvoked,
          pendingApproval: approval,
          data: { approval },
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 12. WRITE ACTION: Update project status
      case 'UPDATE_PROJECT_STATUS': {
        if (user.role === 'readonly') {
          return {
            message: `⛔ **Access Denied:** Read-only users cannot propose write actions.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const projIdentifier = recognized.entities.projectName || 'PRJ-ATLAS';
        const newStatus = recognized.entities.projectStatus || 'blocked';

        const projRes = await callTool('get_project_status', { projectId: projIdentifier });
        if (!projRes.success) {
          return {
            message: `⚠️ **Project not found:** Could not find project matching "${projIdentifier}".`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const { project, client } = projRes.data;
        const previewSummary = `Update project "${project.name}" (${project.code}) status from "${project.status}" to "${newStatus}".`;

        const approval = this.approvalService.proposeAction(
          {
            actionType: 'update_project_status',
            toolName: 'update_project_status',
            targetEntityType: 'project',
            targetEntityId: project.id,
            targetEntityName: project.name,
            parameters: {
              projectId: project.id,
              status: newStatus
            },
            previewSummary
          },
          user
        );

        let msg = `### ⚠️ Project Status Change Proposed — Requires Approval\n\n`;
        msg += `- **Project:** **${project.name}** (\`${project.code}\`)\n`;
        msg += `- **Client:** ${client ? client.name : 'Unknown'}\n`;
        msg += `- **Current Status:** \`${project.status}\`\n`;
        msg += `- **Proposed New Status:** 🔄 **\`${newStatus.toUpperCase()}\`**\n\n`;
        msg += `> **Security Policy Notice:** This write operation has been queued for verification. Click **Approve** below to commit the change to SQLite.`;

        return {
          message: msg,
          toolsInvoked,
          pendingApproval: approval,
          data: { project, approval },
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 13. WRITE ACTION: Add client note
      case 'ADD_CLIENT_NOTE': {
        if (user.role === 'readonly') {
          return {
            message: `⛔ **Access Denied:** Read-only users cannot propose write actions.`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const clientName = recognized.entities.clientName || 'Acme';
        const searchRes = await callTool('search_clients', { query: clientName });
        if (!searchRes.success || searchRes.data.clients.length === 0) {
          return {
            message: `⚠️ **Client not found:** Could not locate client record matching "${clientName}".`,
            toolsInvoked,
            intentRecognized: true,
            intentName: recognized.intent
          };
        }

        const client = searchRes.data.clients[0];
        const noteText = recognized.entities.noteText || 'Operational note logged via mock agent.';
        const previewSummary = `Append note to client "${client.name}": "${noteText}"`;

        const approval = this.approvalService.proposeAction(
          {
            actionType: 'add_client_note',
            toolName: 'add_client_note',
            targetEntityType: 'client',
            targetEntityId: client.id,
            targetEntityName: client.name,
            parameters: {
              clientId: client.id,
              note: noteText
            },
            previewSummary
          },
          user
        );

        let msg = `### ⚠️ Client Note Proposed — Requires Approval\n\n`;
        msg += `- **Target Client:** **${client.name}** (\`${client.id}\`)\n`;
        msg += `- **Proposed Note Text:**\n  > "${noteText}"\n\n`;
        msg += `> **Security Policy Notice:** Click **Approve** to commit this note to the client's SQLite record.`;

        return {
          message: msg,
          toolsInvoked,
          pendingApproval: approval,
          data: { client, approval },
          intentRecognized: true,
          intentName: recognized.intent
        };
      }

      // 14. Help / Unsupported
      case 'HELP':
      case 'UNKNOWN':
      default: {
        let msg = `### 🤖 Local Mock Agent Console\n`;
        msg += `> **LOCAL MOCK AGENT — NO REAL AI CONNECTED**\n\n`;
        msg += `This interface runs a deterministic, pattern-based operations router powered by a real MCP tool execution engine and SQLite database.\n\n`;
        msg += `#### 💡 Supported Commands & Queries:\n\n`;
        msg += `**1. Cross-System & Accounting Lookups:**\n`;
        msg += `- \`"Which clients have overdue invoices?"\`\n`;
        msg += `- \`"Show me the details of invoice INV-1002"\`\n`;
        msg += `- \`"Which clients have overdue invoices and active projects?"\` *(Cross-system join)*\n\n`;
        msg += `**2. Projects, Tasks & Documents:**\n`;
        msg += `- \`"Show the current status of the Atlas migration project"\`\n`;
        msg += `- \`"List all open tasks for Acme Corp"\`\n`;
        msg += `- \`"List all projects"\`\n`;
        msg += `- \`"Search documents for contract"\`\n\n`;
        msg += `**3. Write Operations (Requires Approval Workflow):**\n`;
        msg += `- \`"Create a follow-up task for the client with the most overdue invoice"\`\n`;
        msg += `- \`"Update the Atlas migration project to blocked"\`\n`;
        msg += `- \`"Add a note to Acme Corp: Payment promised next Tuesday"\`\n\n`;
        msg += `_Try typing one of the example queries or clicking the quick suggestion chips above!_`;

        return {
          message: msg,
          toolsInvoked,
          intentRecognized: recognized.intent === 'HELP',
          intentName: recognized.intent
        };
      }
    }
  }
}
