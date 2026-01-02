import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconDir = join(__dirname, '../public/icon');

const svg = readFileSync(join(iconDir, 'logo.svg'), 'utf-8');
const sizes = [16, 32, 48, 96, 128];

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: size,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  writeFileSync(join(iconDir, `${size}.png`), pngBuffer);
  console.log(`Generated ${size}.png`);
}

console.log('Done! All icons generated.');
