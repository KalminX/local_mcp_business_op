import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { BusinessDb } from '../db/database.js';
import type { SafeUser, UserRole } from '../types/index.js';

export interface AuthenticatedRequest extends Request {
  user?: SafeUser;
  csrfToken?: string;
}

export class AuthService {
  constructor(private db: BusinessDb) {}

  authenticate(username: string, passwordPlain: string): { success: boolean; user?: SafeUser; sessionToken?: string; csrfToken?: string; error?: string } {
    const user = this.db.getUserByUsername(username);
    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const passwordMatch = bcrypt.compareSync(passwordPlain, user.password_hash);
    if (!passwordMatch) {
      return { success: false, error: 'Invalid username or password' };
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');

    this.db.createSession(sessionToken, user.id, csrfToken, 24);

    const safeUser: SafeUser = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      created_at: user.created_at
    };

    return {
      success: true,
      user: safeUser,
      sessionToken,
      csrfToken
    };
  }

  validateSession(token: string): { user: SafeUser; csrfToken: string } | null {
    if (!token) return null;
    const session = this.db.getSession(token);
    if (!session) return null;

    return {
      user: session.user,
      csrfToken: session.csrf_token
    };
  }

  logout(token: string): void {
    if (token) {
      this.db.deleteSession(token);
    }
  }
}

export function createAuthMiddleware(authService: AuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const sessionToken = req.cookies?.['ops_session'] || req.headers['x-session-token'] as string;
    
    if (sessionToken) {
      const session = authService.validateSession(sessionToken);
      if (session) {
        req.user = session.user;
        req.csrfToken = session.csrfToken;
      }
    }

    next();
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: User role '${req.user.role}' is not authorized to access this resource. Required: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

export function verifyCsrf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Safe methods skip CSRF
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const clientCsrf = req.headers['x-csrf-token'] as string;
  if (!clientCsrf || !req.csrfToken || clientCsrf !== req.csrfToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  next();
}
