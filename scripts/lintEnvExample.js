const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(process.cwd(), '.env.example');
const contents = fs.readFileSync(envPath, 'utf8');

const errors = [];

const bannedPatterns = [
  { pattern: /JWT_SECRET=.*(change[-_]?me|default|secret)/i, message: 'JWT_SECRET must not include placeholder values.' },
  {
    pattern: /"password"\s*:\s*"(admin123|operator123|viewer123|changeme|change-me|password)"/i,
    message: 'AUTH_USERS must not contain weak or default credential values.',
  },
  { pattern: /DB_PASSWORD=postgres/i, message: 'DB_PASSWORD should not default to the postgres superuser password.' },
];

for (const { pattern, message } of bannedPatterns) {
  if (pattern.test(contents)) {
    errors.push(message);
  }
}

if (!contents.includes('rotate at least every 90 days')) {
  errors.push('Include password rotation guidance in .env.example (90-day reminder missing).');
}

if (errors.length > 0) {
  console.error('✖ .env.example failed secret linting:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('✔ .env.example passed secret lint checks.');
