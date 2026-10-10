import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS, ToolExecutor } from './tools.js';
import { BusinessDb, getDatabase } from '../db/database.js';
import { AuditService } from '../audit/logger.js';
import type { SafeUser } from '../types/index.js';

export function createMcpServer(db?: BusinessDb, defaultUser?: SafeUser) {
  const database = db || new BusinessDb(getDatabase());
  const auditService = new AuditService(database);
  const toolExecutor = new ToolExecutor(database);

  const server = new Server(
    {
      name: 'local-mcp-business-ops',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.values(MCP_TOOLS).map(t => {
        // Convert Zod schema to JSON schema properties
        const shape = t.schema.shape;
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, field] of Object.entries(shape)) {
          const zField = field as any;
          const isOptional = zField.isOptional?.() || zField._def?.typeName === 'ZodOptional';
          const description = zField.description || '';
          
          let type = 'string';
          let enumValues: string[] | undefined = undefined;

          // Unpack optional/default
          let inner = zField;
          while (inner._def?.innerType) {
            inner = inner._def.innerType;
          }

          if (inner._def?.typeName === 'ZodEnum') {
            enumValues = inner._def.values;
            type = 'string';
          } else if (inner._def?.typeName === 'ZodNumber') {
            type = 'number';
          } else if (inner._def?.typeName === 'ZodBoolean') {
            type = 'boolean';
          }

          properties[key] = {
            type,
            description,
            ...(enumValues ? { enum: enumValues } : {})
          };

          if (!isOptional && zField._def?.typeName !== 'ZodDefault') {
            required.push(key);
          }
        }

        return {
          name: t.name,
          description: t.description,
          inputSchema: {
            type: 'object',
            properties,
            required
          }
        };
      })
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolDef = MCP_TOOLS[name];

    if (!toolDef) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Tool '${name}' is not registered with this MCP server.`
      );
    }

    const user: SafeUser = defaultUser || {
      id: 'usr-mcp-stdio',
      username: 'mcp_inspector_user',
      full_name: 'MCP Direct Client',
      role: 'admin',
      created_at: new Date().toISOString()
    };

    const startTime = Date.now();
    const result = await toolExecutor.executeTool(name, args, user);
    const duration = Date.now() - startTime;

    // Log the audit event
    auditService.logToolExecution({
      user,
      toolName: name,
      args: args || {},
      outcome: result.success ? (toolDef.isWriteOperation ? 'approved_executed' : 'success') : 'failure',
      targetEntityType: (args as any)?.clientId ? 'client' : (args as any)?.projectId ? 'project' : (args as any)?.invoiceId ? 'invoice' : undefined,
      targetEntityId: (args as any)?.clientId || (args as any)?.projectId || (args as any)?.invoiceId || undefined,
      errorMessage: result.error,
      executionResult: result.data
    });

    if (!result.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: result.error }, null, 2)
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.data, null, 2)
        }
      ]
    };
  });

  return { server, database, toolExecutor, auditService };
}
