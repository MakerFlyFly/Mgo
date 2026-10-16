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
| `public/art/character/happy.webp` | 用户选定的 C 图，开心表情 |
| `public/art/character/neutral.webp` | 平静欢迎表情 |
| `public/art/character/thinking.webp` | 思考表情 |
| `public/art/character/smug.webp` | 轻傲娇表情 |
| `public/art/character/surprised.webp` | 惊讶表情 |
| `public/art/character/sorry.webp` | 抱歉表情 |
| `public/art/character/handoff.webp` | 递出点单夹的动作 |
| `public/icon.svg` | 项目自己的鲸鱼图形图标，代码绘制 |

原始 RGBA PNG 保存在 `art/masters/`，应用使用保留透明通道的 WebP 副本以减少下载体积，可运行 `node scripts/optimize-art.mjs` 重建。点单夹由 HTML/CSS 绘制，餐品与费用用真实应用状态排版，不使用烘焙进图片的虚假订单文字。提示音由浏览器 Web Audio 合成，无外部音频素材。界面字体使用设备自带字体，不依赖 Google Fonts。

本仓库作者对其可授予许可的新增 AI 素材部分适用项目 MIT 许可；不代表拥有或授予第三方角色形象、商标、原始参考作品的权利。麦当劳与 DeepSeek 相关标识仅用于非官方社区创作和参赛展示。本项目不宣称官方授权或背书。
