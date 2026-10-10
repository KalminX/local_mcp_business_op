export interface RecognizedIntent {
  intent:
    | 'OVERDUE_INVOICES'
    | 'INVOICE_DETAILS'
    | 'OVERDUE_INVOICES_AND_ACTIVE_PROJECTS'
    | 'PROJECT_STATUS'
    | 'LIST_PROJECTS'
    | 'CLIENT_OPEN_TASKS'
    | 'LIST_OPEN_TASKS'
    | 'SEARCH_CLIENTS'
    | 'CLIENT_DETAILS'
    | 'SEARCH_DOCUMENTS'
    | 'CREATE_FOLLOWUP_TASK_MOST_OVERDUE'
    | 'CREATE_FOLLOWUP_TASK'
    | 'UPDATE_PROJECT_STATUS'
    | 'ADD_CLIENT_NOTE'
    | 'HELP'
    | 'UNKNOWN';
  confidence: number;
  entities: {
    invoiceId?: string;
    projectName?: string;
    projectId?: string;
    projectStatus?: string;
    clientName?: string;
    clientId?: string;
    taskTitle?: string;
    noteText?: string;
    searchQuery?: string;
    priority?: string;
    dueDate?: string;
  };
  rawQuery: string;
}

export class IntentRouter {
  /**
   * Deterministically parses user input and extracts entities based on explicit keywords and regex patterns.
   */
  route(input: string): RecognizedIntent {
    const raw = input.trim();
    const normalized = raw.toLowerCase().replace(/[?,.!]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!normalized || normalized === 'help' || normalized === 'commands' || normalized === 'what can you do') {
      return {
        intent: 'HELP',
        confidence: 1.0,
        entities: {},
        rawQuery: raw
      };
    }

    // 1. Cross-system query: Overdue invoices AND active projects
    if (
      (normalized.includes('overdue') && normalized.includes('active') && (normalized.includes('project') || normalized.includes('projects'))) ||
      (normalized.includes('overdue invoice') && normalized.includes('active project')) ||
      (normalized.includes('clients have overdue') && normalized.includes('active'))
    ) {
      return {
        intent: 'OVERDUE_INVOICES_AND_ACTIVE_PROJECTS',
        confidence: 0.98,
        entities: {},
        rawQuery: raw
      };
    }

    // 2. Write Action: Create follow-up task for the client with the most overdue invoice
    if (
      normalized.includes('follow-up') || normalized.includes('followup') || normalized.includes('follow up')
    ) {
      if (normalized.includes('most overdue') || normalized.includes('highest overdue') || normalized.includes('biggest overdue') || normalized.includes('top overdue')) {
        return {
          intent: 'CREATE_FOLLOWUP_TASK_MOST_OVERDUE',
          confidence: 0.95,
          entities: {},
          rawQuery: raw
        };
      }

      // Generic create follow-up task
      const clientMatch = this.extractClientName(raw);
      return {
        intent: 'CREATE_FOLLOWUP_TASK',
        confidence: 0.85,
        entities: {
          clientName: clientMatch,
          taskTitle: raw
        },
        rawQuery: raw
      };
    }

    // 3. Write Action: Update project status
    // e.g. "Update the Atlas migration project to blocked" or "Set project PRJ-ATLAS to active"
    const updateProjectMatch = this.matchUpdateProjectStatus(raw, normalized);
    if (updateProjectMatch) {
      return updateProjectMatch;
    }

    // 4. Write Action: Add a note to a client's record
    // e.g. "Add a note to Acme Corp: Payment promised next Tuesday" or "Add note to client Acme Corp: ..."
    const addNoteMatch = this.matchAddClientNote(raw, normalized);
    if (addNoteMatch) {
      return addNoteMatch;
    }

    // 5. Specific invoice details
    // e.g. "Show me the details of invoice INV-1002" or "details of invoice 1002" or "INV-1002"
    const invoiceNumMatch = raw.match(/\b(INV-\d+|\b\d{4}\b)/i);
    if (
      (normalized.includes('invoice') && (normalized.includes('detail') || normalized.includes('show') || normalized.includes('get') || normalized.includes('info') || invoiceNumMatch)) ||
      (/^inv-\d+$/i.test(normalized))
    ) {
      const invId = invoiceNumMatch ? (invoiceNumMatch[0].toUpperCase().startsWith('INV-') ? invoiceNumMatch[0].toUpperCase() : `INV-${invoiceNumMatch[0]}`) : undefined;
      if (invId) {
        return {
          intent: 'INVOICE_DETAILS',
          confidence: 0.95,
          entities: { invoiceId: invId },
          rawQuery: raw
        };
      }
    }

    // 6. Overdue invoices query
    // e.g. "Which clients have overdue invoices?", "Show overdue invoices", "List overdue invoices"
    if (normalized.includes('overdue')) {
      return {
        intent: 'OVERDUE_INVOICES',
        confidence: 0.95,
        entities: {},
        rawQuery: raw
      };
    }

    // 7. Project status query
    // e.g. "Show the current status of the Atlas migration project" or "Status of project PRJ-ATLAS"
    if (
      (normalized.includes('project') || normalized.includes('prj-')) &&
      (normalized.includes('status') || normalized.includes('show') || normalized.includes('details') || normalized.includes('progress'))
    ) {
      const projectName = this.extractProjectName(raw);
      if (projectName) {
        return {
          intent: 'PROJECT_STATUS',
          confidence: 0.92,
          entities: { projectName },
          rawQuery: raw
        };
      }
    }

    // 8. Open tasks for client or general tasks
    // e.g. "List all open tasks for Acme Corp", "Show open tasks for a client"
    if (normalized.includes('task') || normalized.includes('tasks')) {
      const clientName = this.extractClientName(raw);
      if (clientName) {
        return {
          intent: 'CLIENT_OPEN_TASKS',
          confidence: 0.9,
          entities: { clientName },
          rawQuery: raw
        };
      }
      return {
        intent: 'LIST_OPEN_TASKS',
        confidence: 0.85,
        entities: {},
        rawQuery: raw
      };
    }

    // 9. Document search
    // e.g. "Search documents for contract", "Find specs", "List documents"
    if (normalized.includes('document') || normalized.includes('documents') || normalized.includes('contract') || normalized.includes('spec') || normalized.includes('sow')) {
      let query = raw.replace(/search|find|documents|document|for|show|list/gi, '').trim();
      return {
        intent: 'SEARCH_DOCUMENTS',
        confidence: 0.85,
        entities: { searchQuery: query || undefined },
        rawQuery: raw
      };
    }

    // 10. List projects
    if (normalized.includes('projects') || (normalized.includes('list') && normalized.includes('project'))) {
      return {
        intent: 'LIST_PROJECTS',
        confidence: 0.85,
        entities: {},
        rawQuery: raw
      };
    }

    // 11. Client search or details
    if (normalized.includes('client') || normalized.includes('clients') || normalized.includes('customer')) {
      const clientName = this.extractClientName(raw);
      if (clientName && (normalized.includes('detail') || normalized.includes('show') || normalized.includes('info') || normalized.includes('profile'))) {
        return {
          intent: 'CLIENT_DETAILS',
          confidence: 0.9,
          entities: { clientName },
          rawQuery: raw
        };
      }
      return {
        intent: 'SEARCH_CLIENTS',
        confidence: 0.8,
        entities: { searchQuery: clientName || undefined },
        rawQuery: raw
      };
    }

    // Fallback: Check if user typed a client or project name directly
    const directProject = this.extractProjectName(raw);
    if (directProject) {
      return {
        intent: 'PROJECT_STATUS',
        confidence: 0.75,
        entities: { projectName: directProject },
        rawQuery: raw
      };
    }

    const directClient = this.extractClientName(raw);
    if (directClient) {
      return {
        intent: 'CLIENT_DETAILS',
        confidence: 0.75,
        entities: { clientName: directClient },
        rawQuery: raw
      };
    }

    return {
      intent: 'UNKNOWN',
      confidence: 0.0,
      entities: {},
      rawQuery: raw
    };
  }

  private extractClientName(raw: string): string | undefined {
    const knownClients = [
      'Acme Corporation', 'Acme Corp', 'Acme',
      'Globex Corporation', 'Globex Corp', 'Globex',
      'Initech Global', 'Initech',
      'Umbrella Pharmaceuticals', 'Umbrella Pharma', 'Umbrella',
      'Stark Industries', 'Stark',
      'Cyberdyne Systems', 'Cyberdyne',
      'Wayne Enterprises', 'Wayne',
      'Pied Piper', 'Piper'
    ];

    const lower = raw.toLowerCase();
    for (const name of knownClients) {
      if (lower.includes(name.toLowerCase())) {
        return name;
      }
    }

    // Regex check for "for <Name>" or "client <Name>"
    const match = raw.match(/(?:for|client|to)\s+([A-Za-z0-9\s\-]+?)(?:\s+record|\s+project|\s*:|\?|$)/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length > 2 && !['a', 'all', 'the', 'open', 'overdue'].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }

    return undefined;
  }

  private extractProjectName(raw: string): string | undefined {
    const knownProjects = [
      { name: 'Atlas ERP Migration', code: 'PRJ-ATLAS', aliases: ['atlas migration', 'atlas erp', 'atlas'] },
      { name: 'CyberShield Deployment', code: 'PRJ-CYBER', aliases: ['cybershield', 'cybershield deployment'] },
      { name: 'TPS System Overhaul', code: 'PRJ-TPS', aliases: ['tps system', 'tps overhaul', 'tps'] },
      { name: 'Lab Automation Pipeline', code: 'PRJ-LAB', aliases: ['lab automation', 'lab pipeline'] },
      { name: 'Arc Grid Integration', code: 'PRJ-ARC', aliases: ['arc grid', 'arc grid integration'] },
      { name: 'Neural Net Pipeline', code: 'PRJ-NEURAL', aliases: ['neural net', 'neural pipeline'] },
      { name: 'Gotham Warehouse Modernization', code: 'PRJ-GOTHAM', aliases: ['gotham warehouse', 'gotham modernization', 'gotham'] },
      { name: 'Middle-Out Compression Pilot', code: 'PRJ-PIPER', aliases: ['middle-out', 'middle out', 'middle out compression'] }
    ];

    const lower = raw.toLowerCase();
    for (const p of knownProjects) {
      if (lower.includes(p.name.toLowerCase()) || lower.includes(p.code.toLowerCase())) {
        return p.code;
      }
      for (const alias of p.aliases) {
        if (lower.includes(alias)) {
          return p.code;
        }
      }
    }

    const codeMatch = raw.match(/\b(PRJ-[A-Za-z0-9]+)\b/i);
    if (codeMatch) return codeMatch[1].toUpperCase();

    return undefined;
  }

  private matchUpdateProjectStatus(raw: string, normalized: string): RecognizedIntent | null {
    const statuses = ['blocked', 'active', 'planning', 'on_hold', 'completed', 'on hold'];
    let targetStatus: string | undefined = undefined;

    for (const s of statuses) {
      if (normalized.includes(`to ${s}`) || normalized.includes(`as ${s}`) || normalized.includes(`status ${s}`) || normalized.includes(`status to ${s}`)) {
        targetStatus = s === 'on hold' ? 'on_hold' : s;
        break;
      }
    }

    if (!targetStatus) {
      // Check if ends with status or includes keyword
      for (const s of statuses) {
        if (normalized.endsWith(s) && (normalized.includes('update') || normalized.includes('set') || normalized.includes('change') || normalized.includes('mark'))) {
          targetStatus = s === 'on hold' ? 'on_hold' : s;
          break;
        }
      }
    }

    if (targetStatus && (normalized.includes('project') || normalized.includes('update') || normalized.includes('set') || normalized.includes('prj-'))) {
      const projectName = this.extractProjectName(raw);
      return {
        intent: 'UPDATE_PROJECT_STATUS',
        confidence: 0.95,
        entities: {
          projectName: projectName || 'PRJ-ATLAS',
          projectStatus: targetStatus
        },
        rawQuery: raw
      };
    }

    return null;
  }

  private matchAddClientNote(raw: string, normalized: string): RecognizedIntent | null {
    if (
      normalized.includes('add a note') ||
      normalized.includes('add note') ||
      normalized.includes('append note') ||
      normalized.includes('client note')
    ) {
      const clientName = this.extractClientName(raw);
      
      // Extract note text after colon or keyword
      let noteText = '';
      if (raw.includes(':')) {
        noteText = raw.split(':')[1].trim();
      } else {
        const noteMatch = raw.match(/(?:note\s+(?:to|for|on)?\s+[A-Za-z0-9\s\-]+?)(?:\s*-\s*|\s+saying\s+|\s+with\s+|\s+stating\s+)(.*)$/i);
        if (noteMatch && noteMatch[1]) {
          noteText = noteMatch[1].trim();
        } else {
          // Default placeholder
          noteText = `Note added via agent: ${raw}`;
        }
      }

      return {
        intent: 'ADD_CLIENT_NOTE',
        confidence: 0.92,
        entities: {
          clientName: clientName || 'Acme Corporation',
          noteText: noteText || 'Operational update logged.'
        },
        rawQuery: raw
      };
    }

    return null;
  }
}
