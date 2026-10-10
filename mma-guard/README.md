# MMA 卡片隐藏修复（ManiaMapAnalyser visibility guard）

ManiaMapAnalyser 的卡片偶尔会卡在旧的显示状态 —— **该隐藏时不隐藏，该显示时不显示**，
在它的页面上刷新一下才恢复。

原因是**合成层帧陈旧**：卡片的 class 其实是对的（带着 `card-hidden-by-play`），
样式表也算得出 `opacity: 0`，但屏幕上还是旧画面。所以它自己的代码永远等不到"分歧"，
没法自我修复。

这个脚本每 0.25 秒比对一次「应该怎样」和「实际怎样」，并在可见性切换时**强制重绘一次**，
把陈旧的帧刷掉。

---

## 怎么用（双击就行）

| 文件 | 作用 |
| --- | --- |
| **`INSTALL.bat`** | 安装 |
| **`CHECK.bat`** | 查看当前状态 |
| **`UNINSTALL.bat`** | 卸载，把 analyser 还原成原样 |

**装：双击 `INSTALL.bat`，然后重启 osu!（或 tosu）。**

脚本会自己找 tosu 里的 `ManiaMapAnalyser.by.Leo_Black` 文件夹。如果找不到，
它会提示你把那个文件夹**拖到 bat 文件上**再松手。

需要电脑上有 **Node.js**（[nodejs.org](https://nodejs.org)）。装了就能用，路径会自动识别。

---

## 它改了哪些文件

只动两处，**analyser 的 JS 模块一个字节都没改**：

| 操作 | 文件 |
| --- | --- |
| 放进去一个脚本 | `<analyser 文件夹>\mma-visibility-guard.js` |
| `index.html` 末尾加一行 | `<script src="mma-visibility-guard.js" defer></script>` |
| 原文件备份 | `<analyser 文件夹>\index.html.bak-preguard` |

`UNINSTALL.bat` 会用这个备份还原 `index.html` 并删掉脚本。

---

## 开关

Dashboard 里 keyviewer_awa 的 `修复相邻卡片卡住`：

* **勾上** = 脚本生效
* **不勾** = 让它停手（脚本每 15 秒回读一次）

没装 keyviewer_awa 时，读不到这个键，默认保持启用。

---

## 查看它到底在干什么

浏览器打开 `http://127.0.0.1:24050/ManiaMapAnalyser.by.Leo_Black/`，
按 `F12` → Console，执行：

```js
__mmaGuard.snapshot()
```

返回：

| 字段 | 含义 |
| --- | --- |
| `mode` | 读到的 Card Visibility（`OutsidePlay` 才对） |
| `modeSource` | 这个值是从哪个文件夹读到的 |
| `playing` | 从 `/websocket/v2` 读到的游戏状态 |
| `socketState` | 应该是 `open`，否则脚本是"瞎"的 |
| `want` / `actual` | 应该怎样 / 实际怎样。不一致时就是它正在救场 |
| `fixes` | 累计纠正过几次 |
| `enabled` | 开关状态 |

### 想把状态画在画面上

```js
window.MMA_GUARD = { quiet: false }; location.reload();
```

会在页面左上角显示两行实时状态。

> **注意**：那个徽章会持续重绘卡片区域，**它自己就能掩盖这个 bug**。
> 排障完记得别常开（去掉的话：`delete window.MMA_GUARD; location.reload();`）。

---

## 自定义

脚本读 `window.MMA_GUARD`，可以在 analyser 页面里改：

```js
window.MMA_GUARD = {
  quiet: true,                 // false = 显示诊断徽章
  intervalMs: 250,
  folder: 'ManiaMapAnalyser.by.Leo_Black',
  overlayFolder: '__ingame__',
  switchFolder: 'keyviewer_awa',
  switchKey: 'fixAnalyserOnStateChange'
};
location.reload();
```

---

## 命令行用法（不想用 bat 的话）

```
node tools\install-mma-guard.js <analyser 文件夹>            # 安装
node tools\install-mma-guard.js <analyser 文件夹> --check    # 查看
node tools\install-mma-guard.js <analyser 文件夹> --remove   # 卸载
```

---

## 文件说明

```
INSTALL.bat                  安装
CHECK.bat                    查看状态
UNINSTALL.bat                卸载
mma-guard\
  mma-visibility-guard.js    修复脚本本体（安装时被拷进 analyser 文件夹）
tools\
  install-mma-guard.js       安装器（bat 调用它）
```
