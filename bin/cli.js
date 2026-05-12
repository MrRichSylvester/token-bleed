#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '0.1.0';
const PORT = 3847;
const HOME = os.homedir();
const TOKEN_BLEED_DIR = path.join(HOME, '.token-bleed');
const WARNED_FLAG = path.join(TOKEN_BLEED_DIR, '.warned-retention');
const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');
const PLIST_PATH = path.join(HOME, 'Library', 'LaunchAgents', 'dev.tokenbleed.plist');
const LOGS_DIR = path.join(TOKEN_BLEED_DIR, 'logs');

const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 18) {
  console.error(`Token Bleed requires Node.js 18 or higher. You have v${process.versions.node}.`);
  process.exit(1);
}

if (!fs.existsSync(TOKEN_BLEED_DIR)) {
  fs.mkdirSync(TOKEN_BLEED_DIR, { recursive: true });
}

const [,, subcommand] = process.argv;

if (subcommand === 'install') {
  if (process.platform !== 'darwin') {
    console.error('token-bleed install only supports macOS.');
    process.exit(1);
  }

  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const binaryPath = process.argv[1];
  const nodePath = process.execPath;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.tokenbleed</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${binaryPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOGS_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOGS_DIR}/stderr.log</string>
</dict>
</plist>
`;

  fs.writeFileSync(PLIST_PATH, plist);

  try {
    execSync(`launchctl load "${PLIST_PATH}"`, { stdio: 'inherit' });
  } catch {
    console.error('Failed to load launchd service. Try running with sudo or check the plist.');
    process.exit(1);
  }

  console.log('✓ Token Bleed will now start automatically on login');
  console.log(`  Running at http://localhost:${PORT}`);
  console.log('  To uninstall: token-bleed uninstall');

} else if (subcommand === 'uninstall') {
  if (process.platform !== 'darwin') {
    console.error('token-bleed uninstall only supports macOS.');
    process.exit(1);
  }

  try {
    execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'inherit' });
  } catch {
    // ignore if not loaded
  }

  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH);
  }

  console.log('✓ Token Bleed removed from login items');

} else if (subcommand === 'fix-retention') {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  } catch {
    // file doesn't exist or invalid JSON — start fresh
  }

  settings = { ...settings, cleanupPeriodDays: 99999 };

  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));

  if (fs.existsSync(WARNED_FLAG)) {
    fs.unlinkSync(WARNED_FLAG);
  }

  console.log('✓ Log retention set to 99999 days');

} else {
  console.log(`Token Bleed v${VERSION} — starting...`);

  if (!fs.existsSync(WARNED_FLAG)) {
    let needsWarning = true;
    try {
      const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      if (settings.cleanupPeriodDays === 99999) needsWarning = false;
    } catch {
      // settings missing or unreadable — warn
    }

    if (needsWarning) {
      console.log('\n⚠  Claude Code deletes logs after 30 days by default.');
      console.log('   Run: token-bleed fix-retention to extend this to 99999 days.');
      console.log('   Your historical data is at risk until you do this.\n');
      fs.writeFileSync(WARNED_FLAG, '');
    }
  }

  process.env.PORT = String(PORT);

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  await import(path.join(__dirname, '..', 'dist', 'server.js'));

  console.log(`✓ Token Bleed running at http://localhost:${PORT}`);
  console.log('  Press Ctrl+C to stop');

  const { default: open } = await import('open');
  await open(`http://localhost:${PORT}`);
}
