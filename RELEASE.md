# 三维合成点集浏览器 · 无障碍发布说明

可鼠标拾取、键盘导航、遮挡识别的三维数据查看器。数据为程序化合成样例，**不是真实天体测量**。

## 界面如何启动（无需构建工具）

发布包位于 `release/viewer/`，自带静态服务器与启动脚本，只依赖 Node.js（≥ 18）：

```sh
cd release/viewer
./start.sh          # 默认 http://127.0.0.1:4174/
./start.sh 8080     # 指定端口
```

也可以直接用 Node 启动：

```sh
node release/viewer/serve-release.mjs        # 端口可用环境变量 PORT 覆盖
```

启动后在浏览器打开终端打印的地址即可看到三维操作视窗：左侧为 WebGL 画布，右侧为数据集、对象列表与详情面板。

## 发布包内容

```
release/viewer/
├── index.html                 # 入口，全部资源使用相对路径，可放任意子目录
├── assets/                    # 打包后的 JS/CSS
├── data/
│   ├── dataset.json           # 运行时数据样例（33 个合成点、4 条轨迹）
│   └── keyboard-nav.json      # 键盘导航配置（键位、空间锥角、并列容差）
├── fonts/                     # 自托管 WOFF2 字体，不依赖开发机字体目录
├── serve-release.mjs          # 零依赖静态文件服务器
├── start.sh                   # 启动脚本
└── release-manifest.json      # 构建清单
```

## 资源缺失行为（不以默认值遮错）

- `data/dataset.json` 或 `data/keyboard-nav.json` 缺失、HTTP 错误或校验失败：查看器**停止引导**，
  显示致命错误遮罩，`window.__spaceApp` 不会建立，因此不可能报告“成功选中”。
- 字体缺失：在“运行资源状态”面板标注为异常并回退系统字体，但不阻断选择等核心功能。
- 资源就绪状态在侧栏“运行资源状态”面板实时可见（加载中 / 就绪 / 异常）。

## 键盘操作

- 列表顺序：`↑/←` 上一项，`↓/→` 下一项，`Home/End` 跳到端点，`Enter/空格` 受控定位，`Esc` 清除焦点。
- 空间邻接：方向键在屏幕投影中选择该方向 45° 锥角内最近对象；`H` 纳入/排除隐藏对象。
- 全局：`F` 受控定位，`R` 重置视角。
- 鼠标：在三维视窗拖拽旋转数据，单击点选目标；重叠点优先选中最近层，可在详情面板的重叠栈中逐层选择。

焦点由稳定 ID 绑定，排序/反向/旋转均不会改变选中身份；空间标记（焦点环）与选中证据（详情、高亮、
live region）始终对应同一 ID。

## 从源码重新构建

```sh
npm install
npm run resources:build     # 生成 public/data 与 public/fonts
npm run build               # 类型检查 + Vite 构建到 dist/
npm run build:release       # 额外组装 release/viewer 发布包
```

## 测试

```sh
npm test                    # 开发服务器（Vite）上的 10 个端到端测试
npm run test:release        # 发布包静态服务器上的 21 个测试：
                            # 资源缺失/校验、键盘焦点顺序与选中身份、旋转点选与空间标记证据
```

发布测试通过 `playwright.release.config.ts` 运行，`webServer` 指向
`node scripts/serve-release.mjs`，验证的是真实发布产物而非开发路径。
