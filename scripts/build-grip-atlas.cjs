// Mechanical registration of the approved 5 × 3 contact sheet. Requires sharp.
// Usage: NODE_PATH=... node scripts/build-grip-atlas.cjs source.png
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
async function build() {
  const source = process.argv[2] || path.resolve('design/grip-sheet.png');
  const anchors = [170, 491, 812, 1131, 1454];
  const baselines = [313, 629, 946];
  const cells = [];
  for (let n = 0; n < 15; n++) {
    const col = n % 5, row = Math.floor(n / 5);
    const left = Math.round(col * 1619 / 5), top = Math.round(row * 971 / 3);
    const width = Math.round((col + 1) * 1619 / 5) - left;
    const height = Math.round((row + 1) * 971 / 3) - top;
    const crop = await sharp(source).extract({left, top, width, height}).resize({width: Math.round(width * .70), height: Math.round(height * .70)}).toBuffer();
    cells.push({input:crop, left:col * 256 + Math.round(128 - (anchors[col] - left) * .70), top:row * 256 + Math.round(240 - (baselines[row] - top) * .70)});
  }
  const output = path.resolve('assets/grip-atlas.webp');
  fs.mkdirSync(path.dirname(output), {recursive:true});
  await sharp({create:{width:1280,height:768,channels:4,background:'#00000000'}}).composite(cells).webp({lossless:true}).toFile(output);
  console.log(output);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
