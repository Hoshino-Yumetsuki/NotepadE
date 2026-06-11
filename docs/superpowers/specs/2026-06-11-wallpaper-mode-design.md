# 壁纸背景模式切换(模糊 / 透明度)— 设计

日期:2026-06-11
状态:已与用户确认

## 背景

当前有壁纸时,`tintOpacity` 滑块双重语义地驱动壁纸层的 CSS 模糊强度(`src/renderer/theme/wallpaper.ts`),壁纸本身始终完全不透明。用户希望壁纸层同时支持「模糊」与「透明度」两种呈现方式,并通过一个模式开关切换;两个数值各自可调。

实现方案选定为**最小改动**:保留 `tintOpacity` 的双重语义(无壁纸 = tint 透明度;有壁纸且模式为模糊 = 模糊强度),仅新增模式开关与透明度值。

## 设置项(src/shared/ipc-contract.ts)

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `wallpaperMode` | `'blur' \| 'opacity'` | `'blur'` | 新增。壁纸层呈现模式;默认与现状一致,老用户升级无感知 |
| `wallpaperOpacity` | `number` | `1` | 新增。壁纸层 CSS opacity,主进程 clamp 到 0..1(src/main/settings.ts,与 tintOpacity 同模式) |
| `tintOpacity` | `number` | 0.5(不变) | 语义不变:无壁纸 = 背景 tint alpha;有壁纸且 mode=blur = 模糊强度 0..1 → blur(0..48px) |

主进程 `setSettings` 对 `wallpaperMode` 做枚举校验(非法值回落 `'blur'`),对 `wallpaperOpacity` 做 0..1 clamp,随 `EvtSettingsChanged` 广播——复用现有数据流,无新 IPC。

## 渲染逻辑(src/renderer/theme/wallpaper.ts)

`wallpaperLayerStyle` 签名扩展为接收模式与两个值(具体参数形态由实现计划定):

- **mode = 'blur'**:行为与现状逐字节一致——`tintOpacity` 映射 `blur(0..48px) + saturate` 渐变,blur 为 0 时跳过 filter,负 inset 过扫描。层 opacity 恒为 1。
- **mode = 'opacity'**:不加 filter,不过扫描(inset 0);层 `opacity = wallpaperOpacity`。根背景仍为不透明 theme base(`appRootBackground` 不变)——壁纸变透明时透出的是主题底色,而不是桌面。

`App.tsx` 把 `settings.wallpaperMode` / `settings.wallpaperOpacity` 传入。HC 高对比度下壁纸层依旧整体禁用(`isWallpaperActive` 不变)。

## 设置 UI(src/renderer/settings/PersonalizationPane.tsx)

仅在 `wallpaperActive` 时,于 tintOpacity 行附近新增:

1. **背景模式**行:Fluent `RadioGroup`(horizontal)——「模糊」/「透明度」,绑定 `wallpaperMode`,`data-testid="setting-wallpaperMode-radio"`。
2. **滑块只显示当前模式的那一个**:
   - mode=blur → 现有 tintOpacity 滑块(testid、描述文案、Wallpaper_OpacityHint 行为均不变);
   - mode=opacity → 替换为 `wallpaperOpacity` 滑块,`data-testid="setting-wallpaperOpacity-slider"`,min/max/step 复用 `TINT_MIN/MAX/STEP`,描述显示百分比。

无壁纸时:不渲染模式行,tintOpacity 滑块行为与现在完全一致。

新增 i18n key(沿用 resw 风格命名,中英两份):模式行标题、两个模式标签、透明度滑块标题/提示。

## 测试

- **vitest**(`src/renderer/theme/wallpaper.test.ts` 或现有就近文件):`wallpaperLayerStyle` 两种模式——blur 模式输出与旧实现等价(filter/inset/无 opacity);opacity 模式输出 opacity、无 filter、inset 0;wallpaperOpacity clamp。
- **vitest**(PersonalizationPane):无壁纸不显示模式行;有壁纸时切换模式后滑块 testid 互换;拖动 wallpaperOpacity 滑块调用 `update({ wallpaperOpacity })`。
- **e2e** `settings-persistence`:设置 `wallpaperMode: 'opacity'`、`wallpaperOpacity: 0.4` → 重启 → Settings.json 与 UI 仍保留。

## 不做的事(YAGNI)

- 不改窗口级 acrylic/vibrancy。
- 不拆分 tintOpacity 为独立的 wallpaperBlur(用户已选最小改动方案)。
- 两值不联动、不互相重置;切换模式只改呈现,数值各自保留。
