import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { getDatabase, BusinessDb } from './db/database.js';
import { seedDatabase } from './db/seed.js';
import { AuthService, createAuthMiddleware } from './auth/session.js';
import { createApiRouter } from './api/routes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(databasePath?: string): {
  app: express.Express;
  db: DatabaseType;
  businessDb: BusinessDb;
  authService: AuthService;
} {
  const app = express();
  const db = getDatabase(databasePath);
  
  // Seed sample database if empty
  seedDatabase(db, false);

  const businessDb = new BusinessDb(db);
  const authService = new AuthService(businessDb);

  app.use(express.json());
  app.use(cookieParser());
  app.use(createAuthMiddleware(authService));

  // Mount API routes
  app.use('/api', createApiRouter(businessDb));

  // Serve static UI assets
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Single page application fallback
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return { app, db, businessDb, authService };
}

// Start server if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  const { app } = createApp();

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Local MCP Business Operations Agent is running!`);
    console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
    console.log(`⚙️  Standalone MCP Server: npm run mcp:server`);
    console.log(`🏷️  Mode: LOCAL MOCK AGENT — NO REAL AI CONNECTED`);
    console.log(`======================================================\n`);
  });
}
