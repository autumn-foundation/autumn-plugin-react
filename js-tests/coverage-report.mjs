// Merges the loader coverage files and checks the line minimum.
//
// A code line is covered when V8 ran at least one of its code bytes.
// Blank lines and comment lines do not count.

import { readdirSync, readFileSync } from 'node:fs';

const DIR = process.env.LOADER_COVERAGE ?? 'target/js-coverage';
const MINIMUM = Number(process.env.LOADER_COVERAGE_MIN ?? 85);
const source = readFileSync(new URL('../assets/react-islands.js', import.meta.url), 'utf8');

const covered = new Uint8Array(source.length);
const files = readdirSync(DIR).filter((f) => f.endsWith('.bin'));
if (files.length === 0) throw new Error(`no coverage files in ${DIR}`);
for (const file of files) {
  const bytes = readFileSync(`${DIR}/${file}`);
  for (let i = 0; i < covered.length; i++) covered[i] |= bytes[i];
}

let offset = 0;
let code = 0;
const missed = [];
source.split('\n').forEach((line, index) => {
  const text = line.trim();
  if (text !== '' && !text.startsWith('//') && !text.startsWith('/**') && !text.startsWith('*')) {
    code += 1;
    let hit = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i].trim() !== '' && covered[offset + i]) hit = true;
    }
    if (!hit) missed.push(index + 1);
  }
  offset += line.length + 1;
});

const percent = (100 * (code - missed.length)) / code;
console.log(`react-islands.js: ${percent.toFixed(2)}% of ${code} code lines covered`);
if (missed.length > 0) console.log(`not covered: lines ${missed.join(', ')}`);
if (percent < MINIMUM) {
  console.error(`line coverage is under ${MINIMUM}%`);
  process.exit(1);
}
