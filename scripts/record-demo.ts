import { chromium, type Page } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function setupCursorVisualizer(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const cursor = document.createElement('div');
      cursor.id = 'playwright-mouse-pointer';
      cursor.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 24px;
        height: 24px;
        pointer-events: none;
        z-index: 999999;
        transform: translate(-2px, -2px);
        transition: transform 0.04s ease-out;
      `;
      cursor.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 2L18 11.5L11.5 13L8 20.5L4 2Z" fill="#38bdf8" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
        <div id="playwright-click-ripple" style="
          position: absolute;
          top: 0;
          left: 0;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid #38bdf8;
          background: rgba(56, 189, 248, 0.4);
          transform: translate(-2px, -2px) scale(0);
          opacity: 0;
          pointer-events: none;
          transition: transform 0.3s ease-out, opacity 0.3s ease-out;
        "></div>
      `;
      document.body.appendChild(cursor);

      window.addEventListener('mousemove', (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });

      window.addEventListener('mousedown', () => {
        const ripple = document.getElementById('playwright-click-ripple');
        if (ripple) {
          ripple.style.transition = 'none';
          ripple.style.transform = 'translate(-2px, -2px) scale(0.4)';
          ripple.style.opacity = '1';
          requestAnimationFrame(() => {
            ripple.style.transition = 'transform 0.35s ease-out, opacity 0.35s ease-out';
            ripple.style.transform = 'translate(-2px, -2px) scale(1.6)';
            ripple.style.opacity = '0';
          });
        }
      });
    });
  });
}

async function smoothMouseMove(page: Page, targetX: number, targetY: number, steps = 16) {
  const currentPos = await page.evaluate(() => {
    const el = document.getElementById('playwright-mouse-pointer');
    if (!el) return { x: 100, y: 100 };
    const left = parseFloat(el.style.left || '100');
    const top = parseFloat(el.style.top || '100');
    return { x: left, y: top };
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const x = currentPos.x + (targetX - currentPos.x) * ease;
    const y = currentPos.y + (targetY - currentPos.y) * ease;
    await page.mouse.move(x, y);
    await sleep(15);
  }
}

async function naturalClick(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  const box = await el.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await smoothMouseMove(page, targetX, targetY);
    await sleep(80);
    await el.click({ delay: 40 });
    await sleep(150);
  }
}

async function naturalType(page: Page, selector: string, text: string) {
  await naturalClick(page, selector);
  await page.locator(selector).fill('');
  for (const char of text) {
    await page.keyboard.type(char, { delay: 16 + Math.floor(Math.random() * 16) });
  }
  await sleep(150);
}

async function runRecording() {
  const rawDir = path.join(process.cwd(), 'raw_video');
  if (fs.existsSync(rawDir)) {
    fs.rmSync(rawDir, { recursive: true, force: true });
  }
  fs.mkdirSync(rawDir, { recursive: true });

  console.log('🚀 Launching Chromium for automated recording (1280x720)...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: rawDir,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();
  await setupCursorVisualizer(page);

  console.log('🎬 Starting workflow demonstration...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await sleep(1000);

  // Initial smooth cursor move over the banner
  await smoothMouseMove(page, 450, 20);
  await sleep(700);

  // 1. SCENE 1: Prompt chip: "Which clients have overdue invoices?"
  console.log('👉 Scene 1: Overdue Invoices Query...');
  await naturalClick(page, 'button[data-prompt="Which clients have overdue invoices?"]');
  // Wait for tool activity card to appear in right drawer
  await page.locator('#sidebar-tool-activity .tool-card').first().waitFor({ state: 'visible', timeout: 10000 });
  await sleep(1500);

  // Inspect the tool activity drawer on the right
  console.log('👉 Inspecting raw MCP tool result modal...');
  await naturalClick(page, '#sidebar-tool-activity .tool-card');
  await page.locator('#modal-close-btn').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(1200);
  await naturalClick(page, '#modal-close-btn');
  await sleep(600);

  // 2. SCENE 2: Multi-Tool Cross-System Join Query
  console.log('👉 Scene 2: Cross-system Query (Overdue Invoices + Active Projects)...');
  await naturalType(page, '#chat-input', 'Which clients have overdue invoices and active projects?');
  await naturalClick(page, '#btn-send-chat');
  await page.waitForFunction(() => {
    const text = document.getElementById('chat-messages')?.innerText || '';
    return text.includes('Cross-System Analysis');
  }, { timeout: 10000 });
  await sleep(1500);

  // Scroll messages to view the cross-system analysis table
  await page.evaluate(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await sleep(1200);

  // 3. SCENE 3: Single Invoice Details Lookup
  console.log('👉 Scene 3: Invoice INV-1002 Details...');
  await naturalType(page, '#chat-input', 'Show me the details of invoice INV-1002');
  await naturalClick(page, '#btn-send-chat');
  await page.waitForFunction(() => {
    const text = document.getElementById('chat-messages')?.innerText || '';
    return text.includes('INV-1002');
  }, { timeout: 10000 });
  await sleep(1500);

  // 4. SCENE 4: Write Operation & Inline Approval Card
  console.log('👉 Scene 4: Write Operation: Update Project Status (Inline Approval)...');
  await naturalType(page, '#chat-input', 'Update the Atlas migration project to blocked');
  await naturalClick(page, '#btn-send-chat');
  await page.locator('.approval-card-inline .btn-approve').first().waitFor({ state: 'visible', timeout: 10000 });
  await sleep(1500);

  // Click "Approve & Execute" inline in the chat
  await naturalClick(page, '.approval-card-inline .btn-approve');
  await sleep(1800);

  // 5. SCENE 5: Write Operation & Queued Approvals
  console.log('👉 Scene 5: Write Operation: Create Follow-up Task for most overdue invoice...');
  await naturalType(page, '#chat-input', 'Create a follow-up task for the client with the most overdue invoice');
  await naturalClick(page, '#btn-send-chat');
  await page.waitForFunction(() => {
    const text = document.getElementById('chat-messages')?.innerText || '';
    return text.includes('Globex Corporation');
  }, { timeout: 10000 });
  await sleep(1500);

  // Navigate to "Pending Approvals" tab in header
  console.log('👉 Scene 6: Navigating to Pending Approvals Queue...');
  await naturalClick(page, 'button[data-tab="tab-approvals"]');
  await page.locator('.approval-box').first().waitFor({ state: 'visible', timeout: 10000 });
  await sleep(1500);

  // Inspect params in approval box
  await naturalClick(page, '.btn-box-json');
  await page.locator('#modal-close-btn').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(1200);
  await naturalClick(page, '#modal-close-btn');
  await sleep(600);

  // Approve the queued request
  await naturalClick(page, '.btn-box-approve');
  await sleep(1800);

  // 6. SCENE 7: Security Policy & Role Enforcement (Read-Only User)
  console.log('👉 Scene 7: Role Enforcement (Read-Only account testing)...');
  await naturalClick(page, '#user-switch-select');
  await page.selectOption('#user-switch-select', 'readonly');
  await sleep(1200);

  // Back to Operations Agent tab
  await naturalClick(page, 'button[data-tab="tab-chat"]');
  await sleep(1000);

  // Attempt write operation as read-only user
  await naturalType(page, '#chat-input', 'Update the Atlas migration project to active');
  await naturalClick(page, '#btn-send-chat');
  await page.waitForFunction(() => {
    const text = document.getElementById('chat-messages')?.innerText || '';
    return text.includes('Access Denied');
  }, { timeout: 10000 });
  await sleep(1800);

  // 7. SCENE 8: Business Hub (Data Explorer)
  console.log('👉 Scene 8: Business Hub Data Explorer...');
  // Switch back to staff
  await page.selectOption('#user-switch-select', 'staff');
  await sleep(1000);

  await naturalClick(page, 'button[data-tab="tab-data"]');
  await sleep(1500);

  // Browse Invoices and filter by Overdue
  await naturalClick(page, '#filter-invoice-status');
  await page.selectOption('#filter-invoice-status', 'overdue');
  await sleep(1400);

  // Browse Projects (see updated Atlas status)
  await naturalClick(page, 'button[data-subtab="subtab-projects"]');
  await sleep(1400);

  // Browse Clients
  await naturalClick(page, 'button[data-subtab="subtab-clients"]');
  await sleep(1200);

  // Browse Tasks
  await naturalClick(page, 'button[data-subtab="subtab-tasks"]');
  await sleep(1200);

  // Browse Documents
  await naturalClick(page, 'button[data-subtab="subtab-documents"]');
  await sleep(1200);

  // 8. SCENE 9: System Audit Trail
  console.log('👉 Scene 9: System Audit Trail...');
  await naturalClick(page, 'button[data-tab="tab-audit"]');
  await sleep(1500);

  // Filter audit logs by outcome: approved_executed
  await naturalClick(page, '#audit-filter-outcome');
  await page.selectOption('#audit-filter-outcome', 'approved_executed');
  await naturalClick(page, '#btn-apply-audit-filter');
  await sleep(1400);

  // Inspect first audit log item
  await naturalClick(page, '#table-audit-logs tbody tr:first-child .btn-inspect-log');
  await page.locator('#modal-close-btn').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(1500);
  await naturalClick(page, '#modal-close-btn');
  await sleep(800);

  // 9. SCENE 10: Reset Demo DB & Final wrap-up
  console.log('👉 Scene 10: Reset DB...');
  // Switch to admin to reset
  await page.selectOption('#user-switch-select', 'admin');
  await sleep(1000);

  // Handle JS confirm dialog automatically
  page.on('dialog', dialog => dialog.accept());
  await naturalClick(page, '#btn-reset-db');
  await sleep(1800);

  // Back to Operations Agent tab for smooth outro
  await naturalClick(page, 'button[data-tab="tab-chat"]');
  await sleep(1800);

  console.log('🛑 Finishing recording session...');
  await page.close();
  await context.close();
  await browser.close();

  // Find the generated webm video
  const files = fs.readdirSync(rawDir);
  const videoFile = files.find(f => f.endsWith('.webm') || f.endsWith('.mp4'));
  if (!videoFile) {
    throw new Error('No raw video file found in ' + rawDir);
  }

  const rawVideoPath = path.join(rawDir, videoFile);
  const outputMp4 = path.join(process.cwd(), 'demo_recording.mp4');
  const publicMp4 = path.join(process.cwd(), 'public', 'demo_recording.mp4');

  console.log(`🎬 Transcoding video with FFmpeg to standard 1280x720 30FPS H.264 MP4: ${outputMp4}`);

  // FFmpeg command: scale to 1280x720, 30fps, libx264, yuv420p, crf 22, faststart
  const ffmpegCmd = `ffmpeg -y -i "${rawVideoPath}" -vf "fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${outputMp4}"`;
  
  execSync(ffmpegCmd, { stdio: 'inherit' });
  fs.copyFileSync(outputMp4, publicMp4);

  // Inspect output video properties
  const probeOutput = execSync(`ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=width,height,r_frame_rate,codec_name -of json "${outputMp4}"`).toString();
  console.log('✅ Final Video Inspection Probe:');
  console.log(probeOutput);

  console.log(`🎉 Demo recording successfully exported to:\n- ${outputMp4}\n- ${publicMp4}`);
}

runRecording().catch(err => {
  console.error('Recording error:', err);
  process.exit(1);
});
