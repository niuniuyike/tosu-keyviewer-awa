# keyviewer_awa

一个给 [tosu](https://github.com/tosuapp/tosu) 用的**键位显示器** Overlay。

竖着的长方形、无边框、背景完全透明：底部是几个小正方体，正方体里是玩家的按键字母；
按下按键，对应的正方体亮起来，同时从正方体上方不断流出**纯色方块键雨**；
松开按键后键雨停止生长，已经流出去的方块继续往上飘，流到上方渐出区域后淡掉消失。

键雨的形状参考 [modlist-org/KeyViewer](https://github.com/modlist-org/KeyViewer)（v4 的
rain 就是纯色矩形，不含文字）：

* `bar`（默认）：严格照搬 KeyViewer 的 rain —— 按住时方块**从正方体的边上向上长高**，
  下边缘一直贴在正方体上（不会滚动、不会平移），长到 `键雨最大长度` 就停住；
  松开后整条不再变长，直接整体向上飘走并渐出。
* `blocks`：一条条独立的小方块持续往上飘，方块之间有间距，可以调圆角变成小胶囊。

所有外观都能在 tosu Dashboard 的插件 Settings 里改（颜色、透明度、键雨流速……），
键位本身也能在 Dashboard 里改，而且**不只是 26 个字母和数字**——`Ctrl`、`Shift`、
小键盘、`F1`~`F24`、方向键、标点、`PrintScreen` 等等都能设置。

---

## 1. 安装

tosu 的 Overlay（计数器）就是一个放在 `static` 文件夹里的子文件夹，里面必须有
`index.html`（可选 `settings.json` 提供 Dashboard 设置面板）。

**方法 A：手动复制（推荐）**

1. 打开 Dashboard（默认 <http://127.0.0.1:24050/>）。
2. 右上角齿轮 → **Advanced** → `Counters Directory` 就是 `static` 文件夹，
   点旁边的按钮可以直接打开它（默认位置是 tosu 程序目录下的 `static`）。
3. 把整个 `keyviewer_awa` 文件夹复制进去。最终结构：

   ```
   static/
     keyviewer_awa/
       index.html        ← Overlay 本体（键位 + 键雨）
       settings.json     ← Dashboard 里的设置面板定义
       metadata.txt      ← 卡片上显示的名字 / 作者 / 建议分辨率
       README.md         ← 本文件，删掉也不影响
   ```

4. 回到 Dashboard 首页刷新一下，列表里会出现 **keyviewer_awa** 卡片。
   卡片里的 iframe 就是实时预览。

**方法 B：用 zip 安装**

`keyviewer_awa.zip` 里的结构就是 `keyviewer_awa/…`，解压到 `static` 文件夹即可，
也可以在 Dashboard 的下载区用 zip 方式导入。

> 文件夹名（`keyviewer_awa`）就是 URL，比如 `http://127.0.0.1:24050/keyviewer_awa/`。
> 改文件夹名也可以，插件本身不依赖名字。

## 2. 在 OBS / 直播软件里显示

1. OBS → 来源 → **+** → **浏览器**。
2. URL：`http://127.0.0.1:24050/keyviewer_awa/`
   （把端口换成你自己设置的 `SERVER_PORT`）
3. 宽高填你想要的竖长方形尺寸，第一次可以用 **160 × 480**。
4. 勾上「关闭源时关闭浏览器」、把「自定义 CSS」留空，**不要**加背景色——
   Overlay 背景是透明的，直接在游戏画面上叠加就行。

不需要为这个源设置任何键盘焦点相关的选项：默认的 `auto` 会自己切到 tosu 数据。

**想收到键盘输入**：默认设置会自动处理，见下一节。

## 2.5 为什么"按了没反应"，以及怎么修（重要）

Overlay 有**两个互相独立的输入来源**，因为任何一个单独都不能在所有场合工作：

| 来源 | 怎么工作 | 优点 | 缺点 |
| --- | --- | --- | --- |
| `keyboard` 键盘事件 | Overlay 页面自己监听 `keydown`/`keyup` | **任意**按键都能显示（小键盘、Ctrl、F1……） | 只有页面真正拿到键盘焦点时才收得到 |
| `game` tosu 数据 | 连接 `/websocket/v2`，读 `keys.k1/k2/m1/m2` | **完全不需要焦点**，随时可用 | 只有游戏自己在数的 4 个键 |

**OBS 的浏览器源默认是点透的、通常拿不到键盘焦点**，所以只监听键盘事件的 Overlay 会出现
"装上了、显示出来了、按了完全没反应"。这就是之前的问题。

现在的默认行为（`输入来源 = auto`）：

1. 启动后先按键盘事件工作；
2. **4 秒内一个按键都没收到**，就自动切到 tosu 数据；
3. 一旦检测到键盘事件，就一直留在键盘模式。

所以装了就能动：OBS 里不需要任何焦点设置，直接用 tosu 的 `k1/k2/m1/m2`。
要确认当前用的是哪一个，打开 `键雨/其他 → 显示输入来源提示`，或者临时在 URL 后面加
`?debug=1`，左上角会显示 `input=keyboard` 或 `input=game`。

**把方块映射到游戏数据**：`输入来源` 下面的 `游戏数据键位`，每行一个槽位：

```
k1
k2
m1
m2
```

osu! 里 `k1`/`k2` 是你的两个按键，`m1`/`m2` 是鼠标左右键。也可以写成 `k1=KeyZ`，
这样这个方块**两种来源同时生效**：OBS 里靠 `k1` 数据亮，浏览器里靠物理键 Z 亮。

### 想要"任意按键"就必须用键盘来源

tosu 只提供游戏自己在数的 4 个键，所以 `Ctrl`、`F1`、小键盘这些**不可能**从 tosu 数据里拿到。
非要显示它们的话，把 `输入来源` 改成 `keyboard` 或保持 `auto`，然后让 Overlay 真的拿到焦点：

* 浏览器直接打开 `http://127.0.0.1:24050/keyviewer_awa/` 时，点一下页面即可；
* OBS 里在预览中点一下这个源，或者给它设一个快捷键把输入转发给浏览器源，
  或者用源的右键菜单 → **交互（Interact）**。

## 3. Dashboard 设置

首页卡片上的 **Settings** 按钮打开设置面板，全部改完点 **Update settings** 立即生效
（保存后 Overlay 会通过 tosu 的广播收到通知并立刻重新读取，不需要重开浏览器源）。

| 分组 | 设置 | 说明 |
| --- | --- | --- |
| 输入 | `输入来源` | `auto`（推荐）/ `game` 只用 tosu 数据 / `keyboard` 只用键盘事件 |
| 输入 | `键盘探测时间 ms` | `auto` 下等多久没键盘事件就切到 tosu 数据，默认 4000 |
| 输入 | `游戏数据键位` | 每个方块吃哪个数据槽，默认 `k1 k2 m1 m2` |
| 输入 | `显示输入来源提示` | 左上角显示当前来源，排障用 |
| 显示 | `显示文本` | 四个方块上显示什么文字，默认 `Z X C V` |
| 显示 | `游戏开始时显示` | 勾上就只在游玩谱面时显示，选歌/菜单里完全不显示 |
| 显示 | `修复相邻卡片卡住` | 给 ManiaMapAnalyser 的兜底：它的卡片卡住时自动重载它。见 4.6 节 |
| 显示 | `按键数据端点` | `precise`（默认，键位一直用的高频端点）/ `general`（少一条连接，按键稍慢） |
| 方块 | `方块大小` `方块缩放` `方块间距` | 尺寸相关，Overlay 变窄时会自动等比缩小 |
| 方块 | `边框粗细` `圆角` `字母大小` | 外观细节，`边框粗细 = 0` 就是纯字母 |
| 颜色 | `边框颜色/透明度` | 正方体边框 |
| 颜色 | `字母颜色/透明度` | 正方体里的字母 |
| 颜色 | `按下颜色/透明度` | 按下时亮起的颜色与强度 |
| 颜色 | `松开颜色/透明度` | 松开时的填充色，`0` 就是空心 |
| 键雨 | `键雨形状` | `bar` = 从正方体边上向上长高；`blocks` = 独立小方块 |
| 键雨 | `键雨颜色/透明度` | 方块键雨的颜色与亮度 |
| 键雨 | `键雨流速` | 每秒长高 / 每秒向上飘的像素数，默认 400 |
| 键雨 | `键雨最大长度` | `bar` 按住时最多长到多长，默认 400 |
| 键雨 | `键雨宽度 %` | 相对正方体边长的宽度，小于 100 变细条 |
| 键雨 | `键雨圆角 %` | 方块圆角，`0` = 直角 |
| 键雨 | `键雨渐出距离 %` | 渐出过程占键雨区域高度的比例 |
| 键雨 | `键雨残留透明度 %` | 完全渐出后是否留一点痕迹，默认 `0` |
| 其他 | `显示调试信息` | 左上角显示当前尺寸 / 键雨数量 / 按下的键 |
| 其他 | `重置设置` | 输入框里填任意新内容再保存 = 恢复默认值 |

## 4. 显示文本与键位

**方块数量固定是 4 个**，没有设置可以改。

### 显示文本

`显示文本` 决定四个方块上写什么，第一行 = 最左边，一行一个，默认：

```
Z
X
C
V
```

* 写成一行 `ZXCV` 也会自动按字符拆成四个。
* 某一行留空，那个方块就显示它对应的数据槽名字（`K1` `K2` `M1` `M2`）。
* 文字太长会自动缩小字号，不会溢出方块。
* **它只改显示的文字。** 想让它显示成你实际按的键（比如 `X` `C` `.` `/`）就直接填那些字符。

### 游戏数据键位

`游戏数据键位` 决定每个方块吃 tosu 的哪个数据槽，默认：

```
k1
k2
m1
m2
```

osu! 里 `k1`/`k2` 是你的两个按键，`m1`/`m2` 是鼠标左右键；mania 里这四个就是你的四个键。
**保持默认即可，装了就亮。**

留空 = 完全不接收游戏数据。这种情况下 Overlay 会自动按 tosu 实际发来的键名顺序去对应方块。

### 附带的键盘绑定

每个方块会顺带尝试把**显示文本**当成键名来绑（`Z` → `KeyZ`、`.` → `Period`、
`SPACE` → `Space`）。这样在没有 tosu、或者在浏览器里直接打开时，
按键盘上对应的键也能点亮——这是 `keyboard` 来源用的。

想手动指定物理键，可以在 `游戏数据键位` 里写 `k1=KeyZ`，
这样这个方块**两种来源同时生效**。可用的键名就是 `event.code`：

```
KeyA … KeyZ          Digit0 … Digit9        F1 … F24
Numpad0 … Numpad9    NumpadAdd NumpadSubtract NumpadMultiply NumpadDivide
NumpadDecimal NumpadComma NumpadEnter NumpadEqual
ControlLeft ControlRight ShiftLeft ShiftRight AltLeft AltRight MetaLeft MetaRight
Space Enter Tab Escape CapsLock Backspace Delete Insert Home End
PageUp PageDown ArrowUp ArrowDown ArrowLeft ArrowRight
PrintScreen ScrollLock Pause NumLock ContextMenu
Semicolon Quote Comma Period Slash Backslash BracketLeft BracketRight Minus Equal Backquote
IntlRo IntlYen IntlBackslash
```

也认别名（`ctrl` `rctrl` `space` `enter` `esc` `pgup` `num1` …）和键帽字符（`z` `;` `:` `,` `/`）。

> 小键盘在**关闭 NumLock** 时报告 `NumpadX`，打开 NumLock 时报告 `DigitX` 或方向键——
> 这是 Windows/浏览器的行为。

### 改设置后为什么会立刻生效

Overlay 启动时读一次设置，然后**加入 tosu 的设置广播频道**（`/websocket/commands`）：
你在 Dashboard 点 **Update settings** 时 tosu 会广播一条 `updateSettings`。
注意它**只带改动的那几项**，所以 Overlay 会把改动合并进已有的设置里再整体套用——
早期版本把这份"部分设置"当成完整设置套用，结果你没动过的项会被打回文件默认值
（看起来就是"改一个设置，别的设置全乱了"）。

所以它**不会**按固定间隔去轮询设置接口——旧版本每 1.2 秒轮询一次，会在 tosu 日志里
刷满 `Settings accessed for keyviewer_awa`，也会一直占用服务器，
连带让别的插件（比如 ManiaMapAnalyser）延迟升高、状态更新变慢。

### 只在游戏时显示

`游戏开始时显示` 勾上后，Overlay 会读 `game.state.name`：

* `play` → 显示；
* 选歌（`selectPlay`）、菜单（`menu`）、结算（`resultScreen`）等 → **整个 Overlay `display:none`**，
  不会在选歌界面挡到别的插件。

按键数据仍然走原来那条高频的 `/websocket/v2/precise`（键位手感不变）。
游戏状态在 `/websocket/v2` 上，所以勾选这个开关时 Overlay 会**额外**开一条状态连接；
不勾的时候不会开，连接数和以前一样。

> 和 ManiaMapAnalyser 这类"游玩时隐藏卡片"的插件一起用时，
> 两个插件都需要及时收到游戏状态；降低设置轮询频率正是为了不再拖慢 tosu 的广播。

## 4.5 在 tosu 的 in-game overlay 里运行时（重要）

如果你把插件加进 tosu 的 **in-game overlay**（游戏内叠加层，快捷键 `Ctrl+Shift+Space`），
有一套容易踩的坑，和插件本身无关，是 tosu 的机制：

**overlay 里的所有插件共用一份设置文件。**

tosu 是按**文件夹名**解析设置的：

```js
const ingameOverlay = folderName === '__ingame__';
const settingsValuesPath = getSettingsPath(folderName);
```

overlay 里的插件都自称 `__ingame__`，所以它们读的是
`<tosu>/settings/__ingame__.values.json`，**不是** `<插件的文件夹名>.values.json`。
而 Dashboard 写的是后者。

这意味着：

* 你在 Dashboard 里改的插件设置，**overlay 里那份可能收不到**；
* 你在 overlay 设置界面里调插件位置时，那一次保存会**重写整个 `__ingame__.values.json`**，
  里面所有插件共享的设置都可能被覆盖；
* 所以两个插件同时装在 overlay 里时，调其中一个的布局有可能"顺带"影响另一个的设置。

**排查建议**：如果某个设置改了没反应，先确认它到底在哪份文件里 ——
`__ingame__.values.json` 还是 `<插件名>.values.json`。

## 4.6 兜底：修复相邻卡片卡住

ManiaMapAnalyser 有个它自己的毛病：**卡片偶尔会卡在旧的显示状态**（该隐藏时不隐藏、
该显示时不显示），在它的页面上刷新一下就能恢复。

> 为什么它自己修不好：卡片的状态**是对的** —— 它确实带着 `card-hidden-by-play`，
> 样式表也解析出 `opacity: 0` —— 但屏幕上还是旧画面。这是**合成层帧陈旧**，不是逻辑错误，
> 所以它自己的代码永远等不到"分歧"发生。

解决办法是把一个独立的自我修复脚本装到 **analyser 自己的页面**上。
在发布包里直接双击（脚本会自己找到 tosu 装在哪）：

```
INSTALL.bat      # 安装
CHECK.bat        # 查看状态
UNINSTALL.bat    # 卸载，恢复原样
```

或者用仓库里的命令行版本：

```
node tools/install-mma-guard.js            # 安装
node tools/install-mma-guard.js --check    # 查看状态
node tools/install-mma-guard.js --remove   # 卸载，恢复原样
```

它做的事，每 0.25 秒一次：

1. 从 `/websocket/v2` 读游戏状态
2. 从 tosu 设置接口读 `Card Visibility`（同时处理插件文件夹和 overlay 的 `__ingame__`）
3. 和卡片的实际状态比对
4. **对不上** → 重新应用 class 并强制重绘
5. **能对上但刚好发生了可见性切换** → 也强制重绘一次（这一步才是治"陈旧帧"的关键）

第 5 步的重绘是一条 `opacity:1 → opacity:1` 的 1ms 空动画，**不改任何外观**，而且只在
可见性切换时触发 —— 正常一局游戏几乎不付代价。默认**不画任何东西**（`quiet` 模式）。

**安装改了哪些文件**（analyser 的 JS 模块一个字节没动）：

| 操作 | 文件 |
| --- | --- |
| 放进一个脚本 | `<analyser 文件夹>/mma-visibility-guard.js` |
| `index.html` 末尾加一行 | `<script src="mma-visibility-guard.js" defer></script>` |
| 原文件备份 | `<analyser 文件夹>/index.html.bak-preguard` |

Dashboard 里的 `修复相邻卡片卡住` 是它的开关：**勾上 = 脚本生效，不勾 = 让它停手**。
脚本每 15 秒回读一次这个设置。keyviewer 没装时（读不到这个键）默认保持启用。

运行时查看状态，在 analyser 页面控制台执行：

```js
__mmaGuard.snapshot()
```

会返回 `mode` / `playing` / `want` / `actual` / `fixes` / `socketState` / `enabled`。
`fixes` 是它动手纠正过的次数；`want` 和 `actual` 不一致时就是它正在救场。

想让它把状态画在画面上（排障用），在 analyser 页面控制台执行：

```js
window.MMA_GUARD = { quiet: false }; location.reload();
```

> 注意：诊断徽章会持续重绘卡片区域，**它自己就能掩盖这个 bug** —— 排障完记得别常开。

> 注意：我原本做的是"从 keyviewer 那边重载 analyser"，但实测两个插件**不是同级 iframe**
> （`companionFrameFound: false`），跨源够不到，所以改成了在 analyser 页面内部自我修复。
> 这个方案不依赖 iframe 拓扑，装在哪都有效。

## 5. 大小自适应

* Overlay 宽度不够时，正方体和间距会等比缩小，保证全部按键都看得见。
* 高度变化时，键雨区域、键雨流速的视觉位置、渐出位置都按新的高度重新换算；
  已经在飘的键雨不会跳变，只是渐出位置跟着变。
* 正在调整 OBS 里浏览器源的大小 / 拉伸（`Ctrl` 拖动边框）时键雨依然会继续流动。

## 6. 调试

Overlay 的 URL 上可以加参数（只在调试时用）：

| 参数 | 作用 |
| --- | --- |
| `?diag=1` | 左上角显示诊断条：当前来源 / 键盘是否收到过事件 / WebSocket 状态 / 收到多少条消息 / tosu 实际发来的键名 |
| `?debug=1` | 更详细的调试面板，控制台输出日志 |
| `?config={"squareSize":90,"displayText":"A\nB\nC\nD"}` | 用 URL 强制覆盖设置，方便快速试效果 |
| `?press=KeyZ,Space` | 加载时直接点亮这些键（测试用） |

**不管什么情况都不亮时，请先这样排查**（这是最快定位问题的方法）：

1. 在 OBS 的浏览器源 URL 后面临时加上 `?diag=1`，或打开
   `设置面板 → 显示输入来源提示`；
2. 进游戏按住一个键，把左上角那行字截图。

它会显示类似：

```
kv game | /websocket/v2/precise open msgs 40 | tosu.keys k1,k2,m1,m2 | lit k1 | state play | rain 3 | state socket off
```

怎么读：

| 看到 | 含义 | 该怎么办 |
| --- | --- | --- |
| `CLOSED` / `msgs 0` | Overlay 连不上 tosu | 确认 tosu 在运行、端口和 URL 一致 |
| `tosu.keys (none)` 或 `msgs 0` | tosu 没在发按键数据 | Dashboard → *Data Fetching → Key Overlay Data* 打开 |
| `tosu.keys k1,k2,m1,m2` 但 `lit` 一直是 `-` | tosu 报的键名和 `游戏数据键位` 对不上 | 把 `游戏数据键位` 清空让插件自动跟随，或按提示里的键名填 |
| `lit k1` 有值但画面不亮 | 数据是通的，问题在显示 | 看 `rain` 是不是 0、方块是否被 `display:none` 隐藏 |
| `state` 一直是 `unknown` | 拿不到游戏状态 | 只有勾了「游戏开始时显示」才会开状态连接，看后面是不是 `state socket CLOSED` |
| `(not playing: hidden)` | 「游戏开始时显示」生效中但游戏状态不是 `play` | 不想被隐藏就关掉这个开关 |
| `kbd yes` 但 `kv keyboard` 且按键不亮 | 键盘事件到了却没匹配上 | 让 `显示文本` 用能当键名读的字符（`Z`、`.`、`SPACE`…），或在 `游戏数据键位` 里写 `k1=KeyZ` |

## 7. 常见问题

**按键盘没反应？**
见第 2.5 节。默认配置已经会自动走 tosu 数据，正常情况下不需要做任何事。

**显示 `input=game` 但方块还是不亮？**
默认 `游戏数据键位` 已经是 `k1 k2 m1 m2`，装了就该亮。还是不亮的话用 `?diag=1`
看 `tosu.keys`：如果那里是 `(none)`，说明 tosu 根本没发按键数据（去 Dashboard 打开
*Data Fetching → Key Overlay Data*）；如果键名有了但按住键 `down` 还是 `-`，
说明 tosu 没从游戏内存里读到你的按键。

**osu! mania 4k 用这个能显示吗？**
能。mania 里 tosu 的 `k1/k2/m1/m2` 就是你的 4 个键（tosu 读的是游戏的按键计数器，
mania 4K 正好 4 个）。默认配置已经映射好了。**如果按住键时 `?diag=1` 里的 `down`
一直是 `-`**，那就是 tosu 侧没读到（这属于 tosu 的读取问题，不是 Overlay 的），
这种情况请把那张诊断截图发出来，我按结果决定是给 tosu 打补丁还是在 Overlay 里
接一个全局键盘钩子。

**想显示 Ctrl / 小键盘 / F1 这些？**
这些 tosu 数据里没有，只能用 `keyboard` 来源并让 Overlay 拿到键盘焦点，
配置方法见第 2.5 节末尾。这是 tosu 本身的数据限制，不是 Overlay 的 bug。

**键雨不动 / 不生成？**
`键雨透明度` 是不是 0？`键雨流速` 是不是 0？

**设置改了没生效？**
Dashboard 里必须点 **Update settings**；点「Cancel」不会保存。
保存后 Overlay 会收到 tosu 的广播通知并立刻重读，通常一瞬间就生效。
如果一直不生效，加 `?debug=1` 看 `settings=` 那一段是不是报错，
并确认 `settings` 来源里有 `tosu broadcast`。

**想恢复默认？**
`其他 / 重置设置` 里随便填个新内容（比如 `1`）再 Update settings。

## 8. 文件说明

| 文件 | 是否必需 | 说明 |
| --- | --- | --- |
| `index.html` | 必需 | Overlay 本体，键位显示 + 键雨，全部逻辑内置，无外部依赖 |
| `settings.json` | 可选 | Dashboard 设置面板；删掉就用内置默认值 |
| `metadata.txt` | 可选 | 卡片显示的名字 / 作者 / 建议分辨率 |
| `README.md` | 可选 | 本文件 |
