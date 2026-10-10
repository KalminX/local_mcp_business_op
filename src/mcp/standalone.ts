#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { BusinessDb, getDatabase } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';

async function main() {
  const db = getDatabase();
  seedDatabase(db, false); // Seed if empty

  const businessDb = new BusinessDb(db);
  const { server } = createMcpServer(businessDb);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Local MCP Business Operations Server running on stdio transport.');
}

main().catch((err) => {
  console.error('Fatal error starting MCP Server:', err);
  process.exit(1);
});
