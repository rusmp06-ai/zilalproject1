import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
export const browserExecutable =
  process.env.CHROMIUM_PATH ||
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
