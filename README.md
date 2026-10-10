# tosu-keyviewer-awa

## 中文说明

### 这是什么

一个 [tosu](https://github.com/tosuapp/tosu) 覆盖层（counter）：四个小方块显示
你的 mania 键位，上面是纯色键雨。键雨遵循
[KeyViewer](https://github.com/modlist-org/KeyViewer) 的行为 —— 按住时**从方块边缘
向上长高**，长到上限停住，松开后飘走并淡出。

单个自包含 `index.html`，无需构建、无依赖。

### 安装

1. 把 `keyviewer_awa` 文件夹放进 tosu 的 `static` 目录：
   ```
   <tosu>/static/keyviewer_awa/
   ```
2. 在 tosu dashboard 里添加为 counter（按文件夹名显示）。
3. 想放进游戏内覆盖层或 OBS 浏览器源，地址是：
   ```
   http://127.0.0.1:24050/keyviewer_awa/
   ```

需要 tosu v4.20 以上。

### 键位

输入取自 tosu 的游戏数据，**不需要键盘焦点** —— 这正是它能在 OBS 里工作的原因。
tosu 提供 4 个数据槽 `k1` `k2` `m1` `m2`；osu! mania 里就是你的 4 个键，
osu! standard 里是两个键加鼠标左右键。

方块上的文字可配置（默认 `ZXCV`），一行一个字母。

### 键雨的形状

`bar`（默认）= KeyViewer 的原始行为，按住时长高、松开后飘走。

渐出的位置由**雨条走过的距离**决定，与它多长无关 —— 所以长按出来的长条不会
一开始就淡。

### ManiaMapAnalyser 卡片卡住的修复

分析器的卡片偶尔会卡在旧的显示状态（该隐藏时不隐藏，或该显示时不显示），
刷新它的页面才恢复。

原因是**合成层帧陈旧**，不是逻辑错误：卡片确实带着 `card-hidden-by-play`，
样式表也解析出 `opacity: 0`，但屏幕上还是旧画面。因为状态是对的，分析器自己的
代码永远等不到"分歧"，没法自我修复。

`mma-card-fix.zip` 会往**分析器自己的页面**装一个小脚本：每 0.25 秒比对
「游戏状态 + 分析器自己的 Card Visibility」和「卡片实际状态」，不一致时 ——
以及可见性切换时（陈旧帧就出现在这里）—— 重新应用 class 并强制重绘一次。
重绘是一条 1ms 空动画，不改外观，分析器的其他部分一个字节都没动。

```
INSTALL.bat      安装（自己找 tosu 在哪）
CHECK.bat        查看状态
UNINSTALL.bat    卸载，恢复原样
```

脚本会照搬分析器自己的规则，包括「主菜单强制隐藏」。早期版本漏了这条规则，
结果和它打架、卡片闪烁 —— 现在有回归测试钉住。

### 排障

在 overlay 地址后加 `?debug=1`，左上角会显示读数。第一行是帧率表：

```
fps=59.8 frame=16.6/16.7/41.3ms(min/avg/max n=120)
```

三个数一起看能区分"按键雨看起来顿"的三种原因：

| 读数 | 含义 |
| --- | --- |
| `min ≈ avg ≈ max ≈ 16.7` | 真正均匀的 60fps。和 200fps 的游戏并排显得顿是对比效应，不是故障 |
| 跨度很大（8 / 16.7 / 45） | 帧都到了但节奏不匀 —— 这个可以修 |
| `avg ≈ 33`（fps ≈ 30） | 被宿主限在 30 帧 |

也可以用 URL 覆盖任意设置：

```
?config={"squareSize":72,"squareCount":4}
```

### 开发

所有验证都是直接跑真实页面源码的无头测试，不需要浏览器：

```
node tools/keys.test.js              # 键位解析，109 项
node tools/settings.contract.test.js # settings.json 与页面的契约，372 项
node tools/rain.test.js              # 键雨运动模型，28 项
node tools/apply-settings.test.js    # Dashboard 改动能到 DOM，20 项
node tools/dashboard-merge.test.js   # 局部广播不会重置其他设置，16 项
node tools/locked-settings.test.js   # 锁定项保持锁定，29 项
node tools/frame-pacing.test.js      # 帧率表本身，16 项
node tools/verify-bats-embed.js      # bat 里带的是最新脚本
node tools/verify-analyser-page.js   # tosu 送出的内容与磁盘一致
```

`tools/serve.js` 是离线开发用的假 tosu：提供 overlay、模拟
`/websocket/v2`、`/websocket/v2/precise`、设置接口和命令通道，
不开 osu! 也能调试。

### 许可

MIT，见 [LICENSE](LICENSE)。
