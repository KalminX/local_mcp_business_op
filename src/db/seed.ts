import bcrypt from 'bcryptjs';
import { getDatabase } from './database.js';
import type { Database as DatabaseType } from 'better-sqlite3';

export function seedDatabase(db: DatabaseType, reset = false): void {
  if (reset) {
    db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM approval_requests;
      DELETE FROM sessions;
      DELETE FROM documents;
      DELETE FROM tasks;
      DELETE FROM projects;
      DELETE FROM invoices;
      DELETE FROM clients;
      DELETE FROM users;
    `);
  }

  // Check if already seeded
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0 && !reset) {
    console.log('Database already contains records. Skipping seed.');
    return;
  }

  console.log('Seeding database with realistic mock business operations data...');

  // 1. Seed Users
  const passwordSalt = bcrypt.genSaltSync(10);
  const adminHash = bcrypt.hashSync('admin123', passwordSalt);
  const staffHash = bcrypt.hashSync('staff123', passwordSalt);
  const readonlyHash = bcrypt.hashSync('readonly123', passwordSalt);

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertUser.run('usr-admin-01', 'admin', adminHash, 'Sarah Chen (VP Operations)', 'admin', '-60 days');
  insertUser.run('usr-staff-01', 'staff', staffHash, 'Marcus Rodriguez (Operations Lead)', 'staff', '-45 days');
  insertUser.run('usr-readonly-01', 'readonly', readonlyHash, 'Alex Taylor (Compliance Auditor)', 'readonly', '-30 days');

  // 2. Seed Clients
  const insertClient = db.prepare(`
    INSERT INTO clients (id, name, industry, tier, status, primary_contact_name, primary_email, phone, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertClient.run(
    'cli-acme-01',
    'Acme Corporation',
    'Industrial Manufacturing',
    'enterprise',
    'active',
    'Wile E. Coyote',
    'wile@acme-corp.demo',
    '+1-555-0199',
    '[2026-09-15T10:00:00Z] Account review completed. Atlas migration project underway.',
    '-90 days'
  );

  insertClient.run(
    'cli-globex-02',
    'Globex Corporation',
    'Defense & Technology',
    'enterprise',
    'active',
    'Hank Scorpio',
    'h.scorpio@globex.demo',
    '+1-555-0144',
    '[2026-08-10T14:30:00Z] Key defense contractor. CyberShield security deployment in progress.',
    '-120 days'
  );

  insertClient.run(
    'cli-initech-03',
    'Initech Global',
    'Financial Services',
    'tier_1',
    'active',
    'Bill Lumbergh',
    'lumbergh@initech.demo',
    '+1-555-0182',
    '[2026-09-01T09:00:00Z] TPS reporting project currently blocked on security audit approvals.',
    '-100 days'
  );

  insertClient.run(
    'cli-umbrella-04',
    'Umbrella Pharmaceuticals',
    'BioTechnology',
    'enterprise',
    'active',
    'Albert Wesker',
    'wesker@umbrella-pharma.demo',
    '+1-555-0163',
    '[2026-09-20T16:00:00Z] High volume laboratory automation pipeline contract signed.',
    '-80 days'
  );

  insertClient.run(
    'cli-stark-05',
    'Stark Industries',
    'Clean Energy & Robotics',
    'tier_1',
    'active',
    'Pepper Potts',
    'pepper@stark-ind.demo',
    '+1-555-0101',
    '[2026-07-15T11:00:00Z] Arc Grid initiative paused pending regulatory compliance check.',
    '-150 days'
  );

  insertClient.run(
    'cli-cyberdyne-06',
    'Cyberdyne Systems',
    'AI & Automation',
    'tier_2',
    'active',
    'Miles Dyson',
    'dyson@cyberdyne.demo',
    '+1-555-0177',
    '[2026-09-10T13:15:00Z] Neural pipeline architecture planning phase.',
    '-60 days'
  );

  insertClient.run(
    'cli-wayne-07',
    'Wayne Enterprises',
    'Logistics & Real Estate',
    'enterprise',
    'active',
    'Lucius Fox',
    'l.fox@wayne-enterprises.demo',
    '+1-555-0155',
    '[2026-08-25T15:45:00Z] Gotham warehouse modernization contract underway.',
    '-75 days'
  );

  insertClient.run(
    'cli-piper-08',
    'Pied Piper',
    'Cloud Storage',
    'tier_3',
    'active',
    'Richard Hendricks',
    'richard@piedpiper.demo',
    '+1-555-0122',
    '[2026-09-05T12:00:00Z] Middle-out compression deployment. Payment delay discussed.',
    '-50 days'
  );

  // 3. Seed Invoices
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (id, invoice_number, client_id, amount, currency, status, due_date, issue_date, paid_at, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, date('now', ?), date('now', ?), ?, ?, datetime('now', ?))
  `);

  insertInvoice.run(
    'inv-1001',
    'INV-1001',
    'cli-acme-01',
    42500.00,
    'USD',
    'paid',
    '-60 days',
    '-90 days',
    new Date(Date.now() - 58 * 86400000).toISOString(),
    'Acme Atlas Migration - Discovery & Architecture Phase',
    '-90 days'
  );

  insertInvoice.run(
    'inv-1002',
    'INV-1002',
    'cli-acme-01',
    78000.00,
    'USD',
    'overdue',
    '-35 days',
    '-65 days',
    null,
    'Acme Atlas Migration - Phase 1 Implementation Milestone (OVERDUE)',
    '-65 days'
  );

  insertInvoice.run(
    'inv-1003',
    'INV-1003',
    'cli-initech-03',
    25000.00,
    'USD',
    'paid',
    '-45 days',
    '-75 days',
    new Date(Date.now() - 40 * 86400000).toISOString(),
    'Initech TPS Audit & Strategy Consulting',
    '-75 days'
  );

  insertInvoice.run(
    'inv-1004',
    'INV-1004',
    'cli-initech-03',
    12500.00,
    'USD',
    'paid',
    '-15 days',
    '-45 days',
    new Date(Date.now() - 10 * 86400000).toISOString(),
    'Initech Workflow Automation Retainer Q3',
    '-45 days'
  );

  insertInvoice.run(
    'inv-1005',
    'INV-1005',
    'cli-globex-02',
    145000.00,
    'USD',
    'overdue',
    '-50 days',
    '-80 days',
    null,
    'Globex CyberShield Enterprise Multi-Region License & Deployment (CRITICAL OVERDUE)',
    '-80 days'
  );

  insertInvoice.run(
    'inv-1006',
    'INV-1006',
    'cli-umbrella-04',
    92000.00,
    'USD',
    'unpaid',
    '+15 days',
    '-15 days',
    null,
    'Umbrella Lab Automation Station Integration - Milestone 2',
    '-15 days'
  );

  insertInvoice.run(
    'inv-1007',
    'INV-1007',
    'cli-stark-05',
    65000.00,
    'USD',
    'unpaid',
    '+5 days',
    '-25 days',
    null,
    'Stark Arc Grid Platform Architecture Review',
    '-25 days'
  );

  insertInvoice.run(
    'inv-1008',
    'INV-1008',
    'cli-cyberdyne-06',
    34000.00,
    'USD',
    'draft',
    '+30 days',
    '-2 days',
    null,
    'Cyberdyne Neural Model Training Infrastructure Provisioning',
    '-2 days'
  );

  insertInvoice.run(
    'inv-1009',
    'INV-1009',
    'cli-piper-08',
    18750.00,
    'USD',
    'overdue',
    '-22 days',
    '-52 days',
    null,
    'Pied Piper Middle-Out Compression Cluster Hosting (OVERDUE)',
    '-52 days'
  );

  insertInvoice.run(
    'inv-1010',
    'INV-1010',
    'cli-wayne-07',
    110000.00,
    'USD',
    'unpaid',
    '+20 days',
    '-10 days',
    null,
    'Wayne Enterprises Gotham Modernization - Hardware & Sensor Deployment',
    '-10 days'
  );

  // 4. Seed Projects
  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, code, client_id, status, budget, description, start_date, target_completion_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, date('now', ?), date('now', ?), datetime('now', ?))
  `);

  insertProject.run(
    'prj-atlas-01',
    'Atlas ERP Migration',
    'PRJ-ATLAS',
    'cli-acme-01',
    'active',
    250000.00,
    'Core enterprise resource planning database migration and real-time API modernization.',
    '-90 days',
    '+60 days',
    '-90 days'
  );

  insertProject.run(
    'prj-cyber-02',
    'CyberShield Deployment',
    'PRJ-CYBER',
    'cli-globex-02',
    'active',
    450000.00,
    'Zero-trust network security rollout across 12 branch offices and global datacenters.',
    '-120 days',
    '+90 days',
    '-120 days'
  );

  insertProject.run(
    'prj-tps-03',
    'TPS System Overhaul',
    'PRJ-TPS',
    'cli-initech-03',
    'blocked',
    85000.00,
    'Automated TPS cover sheet and report generation pipeline. Blocked pending client security sign-off.',
    '-100 days',
    '+30 days',
    '-100 days'
  );

  insertProject.run(
    'prj-lab-04',
    'Lab Automation Pipeline',
    'PRJ-LAB',
    'cli-umbrella-04',
    'active',
    320000.00,
    'High-throughput robotic testing station integration with central telemetry database.',
    '-80 days',
    '+120 days',
    '-80 days'
  );

  insertProject.run(
    'prj-arc-05',
    'Arc Grid Integration',
    'PRJ-ARC',
    'cli-stark-05',
    'on_hold',
    600000.00,
    'Micro-grid energy distribution management platform and real-time metering telemetry.',
    '-150 days',
    '+180 days',
    '-150 days'
  );

  insertProject.run(
    'prj-neural-06',
    'Neural Net Pipeline',
    'PRJ-NEURAL',
    'cli-cyberdyne-06',
    'planning',
    195000.00,
    'Distributed tensor processing cluster configuration and automated training pipeline.',
    '-30 days',
    '+150 days',
    '-30 days'
  );

  insertProject.run(
    'prj-gotham-07',
    'Gotham Warehouse Modernization',
    'PRJ-GOTHAM',
    'cli-wayne-07',
    'active',
    380000.00,
    'Automated guided vehicle fleet management and RFID inventory tracking system.',
    '-75 days',
    '+45 days',
    '-75 days'
  );

  insertProject.run(
    'prj-piper-08',
    'Middle-Out Compression Pilot',
    'PRJ-PIPER',
    'cli-piper-08',
    'active',
    120000.00,
    'Lossless compression algorithm deployment for petabyte-scale distributed media archives.',
    '-50 days',
    '+40 days',
    '-50 days'
  );

  // 5. Seed Tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, project_id, client_id, assigned_to_user_id, status, priority, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, date('now', ?), datetime('now', ?))
  `);

  insertTask.run(
    'tsk-101',
    'Audit database schema compatibility for Atlas ERP',
    'prj-atlas-01',
    'cli-acme-01',
    'usr-staff-01',
    'completed',
    'high',
    '-40 days',
    '-60 days'
  );

  insertTask.run(
    'tsk-102',
    'Resolve database indexing bottleneck in Atlas ERP Migration',
    'prj-atlas-01',
    'cli-acme-01',
    'usr-staff-01',
    'open',
    'high',
    '+3 days',
    '-10 days'
  );

  insertTask.run(
    'tsk-103',
    'Send collections notice for overdue invoice INV-1002 to Acme Corp',
    'prj-atlas-01',
    'cli-acme-01',
    'usr-admin-01',
    'open',
    'urgent',
    '+1 days',
    '-5 days'
  );

  insertTask.run(
    'tsk-104',
    'Deploy VPN gateways for Globex CyberShield site B',
    'prj-cyber-02',
    'cli-globex-02',
    'usr-staff-01',
    'in_progress',
    'urgent',
    '+5 days',
    '-8 days'
  );

  insertTask.run(
    'tsk-105',
    'Follow up with Hank Scorpio on overdue invoice INV-1005 ($145,000)',
    'prj-cyber-02',
    'cli-globex-02',
    'usr-admin-01',
    'open',
    'urgent',
    '+2 days',
    '-3 days'
  );

  insertTask.run(
    'tsk-106',
    'Resolve security firewall exception blocking TPS project',
    'prj-tps-03',
    'cli-initech-03',
    'usr-staff-01',
    'open',
    'medium',
    '+7 days',
    '-12 days'
  );

  insertTask.run(
    'tsk-107',
    'Calibrate high-throughput liquid handling robotics for Umbrella',
    'prj-lab-04',
    'cli-umbrella-04',
    'usr-staff-01',
    'in_progress',
    'high',
    '+10 days',
    '-15 days'
  );

  insertTask.run(
    'tsk-108',
    'Follow up on Pied Piper hosting invoice INV-1009 ($18,750)',
    'prj-piper-08',
    'cli-piper-08',
    'usr-staff-01',
    'open',
    'high',
    '+4 days',
    '-4 days'
  );

  // 6. Seed Documents
  const insertDoc = db.prepare(`
    INSERT INTO documents (id, title, doc_type, client_id, project_id, file_path, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertDoc.run(
    'doc-201',
    'Acme Master Services Agreement 2026',
    'contract',
    'cli-acme-01',
    'prj-atlas-01',
    '/docs/contracts/acme_msa_2026.pdf',
    'Fully executed Master Services Agreement with Acme Corp for multi-year enterprise transformation.',
    '-90 days'
  );

  insertDoc.run(
    'doc-202',
    'Atlas ERP Migration Technical Architecture Specification',
    'spec',
    'cli-acme-01',
    'prj-atlas-01',
    '/docs/specs/atlas_migration_v2.1.pdf',
    'Detailed architecture specification for Oracle to PostgreSQL database migration and Redis cache layer.',
    '-75 days'
  );

  insertDoc.run(
    'doc-203',
    'Globex CyberShield Deployment Statement of Work',
    'proposal',
    'cli-globex-02',
    'prj-cyber-02',
    '/docs/sow/globex_cybershield_sow.pdf',
    'Statement of work outlining perimeter security, zero-trust network access, and endpoint protection.',
    '-120 days'
  );

  insertDoc.run(
    'doc-204',
    'Initech TPS Security Compliance Audit',
    'report',
    'cli-initech-03',
    'prj-tps-03',
    '/docs/audits/initech_tps_security_audit.pdf',
    'Third-party security audit identifying required firewall rule changes before TPS automation can go live.',
    '-30 days'
  );

  insertDoc.run(
    'doc-205',
    'Umbrella Pharmaceuticals Bio-Safety Robotics Protocol',
    'spec',
    'cli-umbrella-04',
    'prj-lab-04',
    '/docs/specs/umbrella_biosafety_protocol.pdf',
    'Protocol guidelines for Level 3 containment robotic testing station control and emergency shutdown.',
    '-70 days'
  );

  // 7. Seed initial Audit Log
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (id, user_id, username, user_role, tool_name, target_entity_type, target_entity_id, arguments_json, outcome, approval_id, error_message, execution_result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);

  insertAudit.run(
    'aud-001',
    'usr-admin-01',
    'admin',
    'admin',
    'system_seed',
    'system',
    'database',
    JSON.stringify({ reset }),
    'success',
    null,
    null,
    JSON.stringify({ message: 'Initial sample dataset seeded successfully.' }),
    '-1 minutes'
  );

  console.log('Database seeded successfully with users, clients, invoices, projects, tasks, and documents.');
}

// Execute directly if run via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const isReset = process.argv.includes('--reset');
  const db = getDatabase();
  seedDatabase(db, isReset);
  console.log('Done.');
}
