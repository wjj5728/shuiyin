# Picmark Studio

浏览器内运行的批量图片水印工具。图片只在当前设备处理，不上传服务器。

## 本地开发

要求 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

## 构建与部署

```bash
npm run build
npm run start
```

项目使用标准 Next.js App Router，可直接导入 Vercel。Vercel 的构建命令使用
`npm run build`，不需要配置数据库、对象存储或环境变量。

## 常用命令

- `npm run dev`：启动开发环境
- `npm run build`：生成生产构建
- `npm run start`：运行生产构建
- `npm test`：构建项目并执行冒烟测试
- `npm run typecheck`：执行 TypeScript 检查

## 工作方式

用户选择的图片会留在浏览器内，通过 Canvas 添加文字水印后直接下载。服务器只负责提供网页资源，不会收到图片文件。
