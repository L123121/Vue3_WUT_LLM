const fs = require('fs');
const path = require('path');

(async () => {
  const { Jimp } = await import('jimp');
  const src = path.join(__dirname, '..', 'src', 'assets', 'wuhan-university-logo.png');
  const outDir = path.join(__dirname, '..', 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sizes = [32, 64, 96, 128, 180, 192, 512];

  try {
    console.log('Reading source image...');
    const img = await Jimp.read(src);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    console.log('Source size:', w, 'x', h);

    // 裁剪成正方形（取中心部分）
    const size = Math.min(w, h);
    const x = Math.floor((w - size) / 2);
    const y = Math.floor((h - size) / 2);
    img.crop({ x, y, w: size, h: size });
    console.log('Cropped to square:', size, 'x', size);

    for (const s of sizes) {
      const cloned = img.clone();
      cloned.resize({ w: s, h: s });
      const out = path.join(outDir, `favicon-${s}x${s}.png`);
      const buf = await cloned.getBuffer('image/png');
      fs.writeFileSync(out, buf);
      console.log('wrote', out);
    }

    console.log('All icons generated in', outDir);
  } catch (err) {
    console.error('Failed:', err);
    process.exitCode = 1;
  }
})();
