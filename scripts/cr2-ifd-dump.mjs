// Dumps every IFD in a Canon CR2, listing every tag so we can see where
// the large preview JPEG at offset 63852 is actually referenced.

import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '/Users/alexanderholtkamp/Desktop/Colony Photos/IMG_2604.CR2';
const bytes = new Uint8Array(readFileSync(file));
const view = new DataView(bytes.buffer);
const r16 = (o) => view.getUint16(o, true);
const r32 = (o) => view.getUint32(o, true);

const TIFF_TYPES = { 1:'BYTE',2:'ASCII',3:'SHORT',4:'LONG',5:'RATIONAL',7:'UNDEF',9:'SLONG',10:'SRATIONAL' };

function dumpIfd(offset, label) {
  console.log(`\n=== ${label} @ ${offset} ===`);
  const count = r16(offset);
  console.log(`  ${count} entries`);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    const tag = r16(entry);
    const type = r16(entry + 2);
    const cnt = r32(entry + 4);
    const valOff = r32(entry + 8);
    console.log(`  tag 0x${tag.toString(16).padStart(4,'0')}  type=${TIFF_TYPES[type]||type}(${type})  cnt=${cnt.toString().padStart(6)}  val/off=${valOff}`);
  }
  const next = r32(offset + 2 + count * 12);
  console.log(`  nextIFD=${next}`);
  return next;
}

let off = r32(4);
let idx = 0;
while (off > 0 && idx < 6) {
  off = dumpIfd(off, `IFD${idx}`);
  idx++;
}
