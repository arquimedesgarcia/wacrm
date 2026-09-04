const fs = require('fs');
const c = fs.readFileSync('src/components/automations/automation-builder.tsx', 'utf8');
const keys = [...c.matchAll(/t\(["']([^"']+)["']\)/g)].map(m => m[1]).filter(k => k.includes('.')).sort((a, b) => a.localeCompare(b));
const u = [...new Set(keys)];
console.log('count', u.length);
u.forEach(k => console.log(k));
