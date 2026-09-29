# 发布演示版到 GitHub Pages

> ✅ **已上线**：https://feiyanguo.github.io/promotion-dataplatform-demo/ （本仓库 push 到 main 即自动重新发布）

> 目标：让任何点链接的人都能零安装试用 demo，链接形如 `https://<你的用户名>.github.io/<仓库名>/`
> 演示版特点：**纯前端、无服务器**，所有数据只存在访问者浏览器内存里，刷新即还原，不上传任何数据。

## 第 0 步：准备仓库（5 分钟）

1. 在 GitHub 新建一个**公开仓库**（如 `promotion-dataplatform-demo`），先不要勾 README
2. 以 `app/` 目录作为仓库根，初始化并推送：

```bash
cd app
git init -b main
# 创建 .gitignore（见下），然后：
git add -A
git commit -m "init demo"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

`.gitignore` 内容：

```
node_modules/
dist/
dist-demo/
*.log
```

> ⚠️ `server/data/*.json` 必须提交（演示版靠它打包种子数据），但这些只是脱敏假数据；
> **切勿**把任何真实 HR 数据、原始 xlsx 附件推进仓库。

## 第 1 步（推荐）：GitHub Actions 自动发布

在仓库根创建 `.github/workflows/deploy-demo.yml`，内容：

```yaml
name: Deploy Demo to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --no-audit --no-fund
      - run: npm run build:demo
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-demo
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

然后：仓库 **Settings → Pages → Source 选 "GitHub Actions"**。此后每次 push 到 main 自动重新发布。

## 第 1 步（备选）：手动发布

```bash
npm run build:demo
cd dist-demo
git init -b gh-pages
git add -A
git commit -m "demo build"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -f origin gh-pages
```

再到 **Settings → Pages → Source 选 "Deploy from a branch" → 选 gh-pages / (root)**。

## 第 2 步：验收

1. 等 Actions 跑绿（约 1 分钟），打开 Pages 给出的链接
2. 用 `bp_wang / bp123` 登录 → 应只看到技术中心 2 个部门的数据
3. 用 `admin / admin123` 登录 → 组织授权里改两个权限 → 退出重登对应 BP 验证权限生效
4. 刷新页面 → 一切还原（这是特性，不是 bug）

## 常见坑

| 现象 | 原因 |
|---|---|
| 页面空白、控制台 404 | 演示版已配 `base: './'`，确认推的是 `dist-demo` 目录**内容**而不是外层目录 |
| Actions 报 npm 权限 | 仓库 Settings → Actions → General → Workflow permissions 选 Read and write |
| 国内朋友打不开 | github.io 在国内访问不稳定，属平台限制，非项目问题；正式演示建议提前在本机打开备用 |

## 安全底线（再强调一次）

演示账号密码公开在登录页是**故意的**（demo 需要），但仓库和 Pages 站点里**只能有脱敏假数据**。
真实数据永远走内网部署（见《部署checklist.md》）。
