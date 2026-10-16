# Mgo 素材与创作记录

本项目由用户提供的 `dafeiyu-mature-character-sheet.png` 作为角色参考，来源为 [鲸鱼娘社区资源库](https://github.com/TreapGoGo/deepseek-whale-girl)。参考图未复制进公开仓库。社区资源库的代码 MIT 许可不自动覆盖其图片；项目保留参考链接及来源说明。

## 用户选定方案

用户要求 18 岁少女感，并从三个使用内置 imagegen 生成的方案中选定 **C：麦当劳主题女仆制服**。角色保持蓝色渐变长发、鲸鳍耳、鲸尾、呆毛与蓝宝石饰物，制服为红黑白配色，包含金色点缀、白色荷叶边和蓝鲸围裙图案。

- 三个候选及完整中文提示词：`art/candidates/`、[prompts.json](candidates/prompts.json)。
- 选定角色的表情、递道具姿势和柜台背景提示词：[production-prompts.json](production-prompts.json)。
- 生成方式：内置 imagegen，以用户提供的参考图生成候选，再以选中的 C 图为角色一致性参考进行表情及姿势编辑。未使用外部 API CLI。
- 门口外景：内置 imagegen，以现有柜台背景作为画风与建筑材质参考，生成无人暖阳门店；招牌和玻璃门位于中央，兼顾手机竖屏裁切。完整提示词见 [entrance-prompt.json](entrance-prompt.json)。

## 应用素材

| 文件 | 用途 |
|---|---|
| `public/art/counter.webp` | 宽屏柜台背景 |
| `public/art/entrance.webp` | 门口开始界面背景，中央构图支持竖屏裁切 |
| `public/art/character/v2/happy.webp` | 用户选定的 C 图，开心表情，已修复抬起手的五指 |
| `public/art/character/v2/neutral.webp` | 平静欢迎表情，使用同一修复手部 |
| `public/art/character/v2/thinking.webp` | 思考表情，使用同一修复手部 |
| `public/art/character/v2/smug.webp` | 轻傲娇表情，使用同一修复手部 |
| `public/art/character/v2/surprised.webp` | 惊讶表情，使用同一修复手部 |
| `public/art/character/v2/sorry.webp` | 抱歉表情，使用同一修复手部 |
| `public/art/character/v2/handoff.webp` | 递出点单夹的动作，双手审阅后保留原图 |
| `public/icon.svg` | 项目自己的鲸鱼图形图标，代码绘制 |

原始 RGBA PNG 保存在 `art/masters/`，应用使用保留透明通道的 WebP 副本以减少下载体积，可运行 `node scripts/optimize-art.mjs` 重建。点单夹由 HTML/CSS 绘制，餐品与费用用真实应用状态排版，不使用烘焙进图片的虚假订单文字。界面字体使用设备自带字体，不依赖 Google Fonts。

## 手部局部重绘

使用内置 imagegen 放大重绘抬起的右手，去掉重复指尖，保留一个拇指和四个长指。编辑目标、选中结果和完整提示词保存在 [hand-fixes/](hand-fixes/)，其中 [prompt.json](hand-fixes/prompt.json) 记录裁切和应用方式。六种表情共享姿势，因此复用同一块生成的手部以保持切换一致；下垂手和递单双手检查后保留。

`node scripts/rebuild-character-hands.mjs` 将选中手部对齐原手腕，并只在有限区域内混合。原图未覆盖，新 PNG 保存在 `art/masters/character/v2/`，WebP 使用同名版本目录；运行引用和门口预加载均切换到新路径。原有透明柔光边缘保持。像素比较报告 [pixel-audit.json](hand-fixes/pixel-audit.json) 证明区域外 RGBA 像素改变数为 0，脸、表情、头发和其余服装未变化。对照与七套双手审阅图见 [修复前后](../docs/screenshots/hand-fix-comparison.jpg)、[全部双手](../docs/screenshots/hand-audit.jpg)。

## 原创说话拟声

通过 Web Audio 播放原创合成元音，未使用游戏或角色录音。设计方法参考《蔚蓝》音效设计师 Kevin Regamey 的 [公开说明](https://threadreaderapp.com/scrolly/1416483583053602816)：元音共振峰变化、情绪音高与避免连续重复。音色按用户试听意见调整，最终选定 `light-girl-v5`，保留尖细、轻盈的电子感。DSP、节奏及试听重建说明见 [声音说明](../docs/audio/README.md)。

门口待机浮光使用 CSS 绘制与动画：桌面 12 个、手机 6 个暖金色柔光粒子，启用“减少动态效果”时静止，背景与立绘复用已归档素材。

本仓库作者对其可授予许可的新增 AI 素材部分适用项目 MIT 许可；不代表拥有或授予第三方角色形象、商标、原始参考作品的权利。麦当劳与 DeepSeek 相关标识仅用于非官方社区创作和参赛展示。本项目不宣称官方授权或背书。
