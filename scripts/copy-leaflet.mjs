import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/leaflet/dist');
const dst = path.resolve('www/vendor/leaflet');

fs.mkdirSync(path.join(dst, 'images'), { recursive: true });

for (const file of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(src, file), path.join(dst, file));
}

for (const file of ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']) {
  fs.copyFileSync(path.join(src, 'images', file), path.join(dst, 'images', file));
}

console.log('Leaflet 1.9.4 copié dans www/vendor/leaflet');
