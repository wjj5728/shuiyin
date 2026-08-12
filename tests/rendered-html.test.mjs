import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("creates a production build for Picmark Studio", async () => {
  await access(new URL("../.next/BUILD_ID", import.meta.url));

  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /批量给图片/);
  assert.match(page, /canvas/i);
  assert.match(page, /id="watermark-image"/);
  assert.match(page, /上传水印图片/);
  assert.match(page, /name="images"/);
  assert.match(page, /multiple/);
  assert.match(page, /可多选/);
  assert.match(page, /onDragStop/);
  assert.match(page, /onResizeStop/);
  assert.match(page, /拖拽右下角手柄缩放/);
  assert.doesNotMatch(page, /水印文字/);
  assert.match(layout, /Picmark Studio/);
  assert.match(packageJson, /"react-rnd":/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|drizzle|cloudflare/);
});
