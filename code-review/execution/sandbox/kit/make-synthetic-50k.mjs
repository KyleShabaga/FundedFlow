// TASK-011(c): synthetic generic-format trade CSV. Every value is generated; no real trade data.
// Usage: node make-synthetic-50k.mjs <out.csv> [rows=50000]
import { writeFileSync } from 'node:fs';
const out = process.argv[2] ?? 'synthetic-50k.csv';
const rows = Number(process.argv[3] ?? 50000);
const syms = ['SYNA', 'SYNB', 'SYNC', 'SYND'];
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const lines = ['trade_id,symbol,side,quantity,entry_time,entry_price,exit_time,exit_price,fees'];
let day = new Date(Date.UTC(2022, 10, 1)); // Tue 1 Nov 2022; 1,000 trading days end before Oct 2026
let perDay = 0;
for (let i = 0; i < rows; i++) {
  if (perDay === 50) { perDay = 0; do { day = new Date(day.getTime() + 86400000); } while ([0, 6].includes(day.getUTCDay())); }
  const entry = new Date(day.getTime() + (14 * 3600 + perDay * 360) * 1000); // 14:00 onwards, 6 min apart
  const exit = new Date(entry.getTime() + 180000);
  const px = 100 + (i % 97) * 0.25;
  const move = ((i * 7) % 9 - 4) * 0.25;
  lines.push([`SYN-${String(i + 1).padStart(6, '0')}`, syms[i % 4], i % 3 === 0 ? 'short' : 'long', 1 + (i % 3),
    fmt(entry), px.toFixed(2), fmt(exit), (px + move).toFixed(2), '1.50'].join(','));
  perDay++;
}
writeFileSync(out, lines.join('\r\n') + '\r\n');
