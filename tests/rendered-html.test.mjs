import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("creates a production build for Picmark Studio", async () => {
  await Promise.all([
    access(new URL("../.next/BUILD_ID", import.meta.url)),
    access(new URL("../public/manifest.webmanifest", import.meta.url)),
    access(new URL("../public/sw.js", import.meta.url)),
    access(new URL("../public/icon-192.png", import.meta.url)),
    access(new URL("../public/icon-512.png", import.meta.url)),
    access(new URL("../public/watermarks/stamp-red.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-red.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-blue.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-gold.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-black-sticker.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-blue-bubble.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-purple-diamond.png", import.meta.url)),
    access(new URL("../public/watermarks/sold-orange-banner.png", import.meta.url)),
  ]);

  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /批量给图片/);
  assert.match(page, /canvas/i);
  assert.match(page, /id="watermark-image"/);
  assert.match(page, /上传水印图片/);
  assert.match(page, /选择本地水印/);
  assert.match(page, /watermarks\/stamp-red\.png/);
  assert.match(page, /watermarks\/sold-red\.png/);
  assert.match(page, /watermarks\/sold-blue\.png/);
  assert.match(page, /watermarks\/sold-gold\.png/);
  assert.match(page, /watermarks\/sold-black-sticker\.png/);
  assert.match(page, /watermarks\/sold-blue-bubble\.png/);
  assert.match(page, /watermarks\/sold-purple-diamond\.png/);
  assert.match(page, /watermarks\/sold-orange-banner\.png/);
  assert.match(page, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(page, /beforeinstallprompt/);
  assert.match(page, /安装到桌面/);
  assert.match(page, /点击素材会替换当前水印/);
  assert.match(page, /key=\{watermark\.url\}/);
  assert.match(page, /aria-pressed=\{watermark\?\.file\.name === preset\.fileName\}/);
  assert.match(page, /name="images"/);
  assert.match(page, /multiple/);
  assert.match(page, /可多选/);
  assert.match(page, /onDragStop/);
  assert.match(page, /onResizeStop/);
  assert.match(page, /settings: getInitialSettings\(/);
  assert.match(page, /settingsCustomized: false/);
  assert.match(page, /!item\.settingsCustomized/);
  assert.match(page, /activeIdRef/);
  assert.match(page, /item\.settings\.size/);
  assert.match(page, /item\.settings\.opacity/);
  assert.match(page, /item\.settings\.x/);
  assert.match(page, /item\.settings\.y/);
  assert.match(page, /item\.settings\.angle/);
  assert.match(page, /每张图片独立保存大小、位置和旋转/);
  assert.match(page, /mobileMaxSize = 16/);
  assert.match(page, /getInitialSettings\(item\.width, item\.height, loaded\.width, loaded\.height\)/);
  assert.match(page, /watermark-rotate-handle/);
  assert.match(page, /preview-watermark-content/);
  assert.match(page, /transform: `rotate\(\$\{settings\.angle\}deg\)`/);
  assert.match(page, /window\.addEventListener\("pointermove"/);
  assert.match(page, /window\.addEventListener\("pointerup"/);
  assert.match(page, /onPointerMove=\{updateWatermarkRotation\}/);
  assert.match(page, /onPointerUp=\{endWatermarkRotation\}/);
  assert.match(page, /拖上方手柄旋转/);
  assert.doesNotMatch(page, /水印文字/);
  assert.match(layout, /Picmark Studio/);
  assert.match(packageJson, /"react-rnd":/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|drizzle|cloudflare/);
});
