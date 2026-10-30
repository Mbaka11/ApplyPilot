// A LaTeX stand-in for tests: reads main.tex in the working folder and writes main.pdf/main.log.
// OVERFLOW_TEST in the source -> two pages; COMPILE_FAIL -> an error. Nothing is installed or fetched.
import fs from 'node:fs';

const source = fs.readFileSync('main.tex', 'utf8');
if (process.env.APPLYPILOT_FAKE_LATEX_LOG) fs.appendFileSync(process.env.APPLYPILOT_FAKE_LATEX_LOG, `${process.argv.slice(2).join(' ')}\n`);
if (source.includes('COMPILE_FAIL')) {
  fs.writeFileSync('main.log', '! Undefined control sequence.\nl.1 COMPILE_FAIL\n');
  process.exit(1);
}
const pages = source.includes('OVERFLOW_TEST') ? 2 : 1;
let pdf = '%PDF-1.4\n';
for (let i = 0; i < pages; i++) pdf += `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`;
fs.writeFileSync('main.pdf', `${pdf}%%EOF\n`);
fs.writeFileSync('main.log', `Output written on main.pdf (${pages} page${pages === 1 ? '' : 's'}, 1234 bytes).\n`);
