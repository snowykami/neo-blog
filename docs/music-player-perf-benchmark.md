# 音乐播放器性能与视觉折扣基准测试报告（2026-11-16）

> 本报告记录基于当前基线（`1bd92367`）进行的**控制变量真实浏览器多维度基准测试**数据，用于定量评估各项优化措施的性能收益与视觉 / HDR / 灵动岛体验取舍。
> 优化改造与后续跟进记录见 [perf-log.md](./perf-log.md)，音乐播放器设计规格见 [music-player-spec.md](./music-player-spec.md)。

---

## 1. 测试环境与方法论

| 项目 | 规格 / 配置 |
| :--- | :--- |
| **硬件平台** | Apple Silicon（Apple M5，10 核心），macOS arm64 |
| **浏览器引擎** | Google Chrome 157.0.8103.78（无头 Metal + WebGPU `--enable-unsafe-webgpu` `--force-color-profile=hdr10` `@2x` DPR） |
| **HDR / WebGPU 验证** | `matchMedia('(dynamic-range: high)') = true`；WebGPU `rgba16float` + `toneMapping: { mode: 'extended' }` 就绪 |
| **测试夹具** | 100 行全特性歌词（多歌手对唱/合唱、背景和声、聚光灯、`swell`/`shatter`/`shimmer`/`dissolve`/`focus`/`shake`/`heartbeat`/`wave` 逐字特效、逐字注音与双语译文）、256×256 合成封面、210 秒（9,261,044 B）128 BPM WAV 音频 |
| **统计口径** | 每个场景独立冷启动 **3 个 Chrome 进程**（各 1s 预热 + 3.5s 采样窗口），取中位数；像素对照采用确定性 PRNG（`0xDEC0DE`）+ 虚拟 `performance.now()` 16.6667ms 固定步进冻结动画，同条件双次截图重复性误差 `MAE = 0.0000`（`0.0000%` 像素差异，2880×1514） |

### 测试场景定义

- **`S1`（暂停待机）**：`/music` 全屏页暂停于第 15.0s（`isPlaying = false`）。
- **`S2`（60Hz 全特效高潮）**：`/music` 全屏页 HDR10 开启，播放 29.8s–33.3s 副歌高潮（聚光灯 + `rain` 粒子 + `shatter`/`shimmer`/`dissolve` 全开）。
- **`S2-SDR`**：同 `S2`，关闭 HDR 高光（测 SDR 渐变光带流光与 `text-shadow` 路径）。
- **`S2-Verse`**：`/music` 全屏页主歌平稳段（4.5s–8.0s，无粒子与强染色，测闲置混合层成本）。
- **`S2-120Hz` / `S2-120Hz-Petals`**：120Hz 节拍驱动器分别搭配 `rain`（高频直线）与 `petals`（椭圆路径）。
- **`S3` / `S3-Switch`（文章阅读伴听）**：博客正文页 + 顶栏灵动岛单行胶囊（`MusicCompact` + 5 根律动条 + 胶囊粒子）+ 右下角旋转悬浮球（`S3-Switch` 每 750ms 切换封面触发主题色过渡）。
- **`S4-Cold` / `S4-Warm`**：210 秒音频节拍分析耗时（`first` 为首次冷分析，`second` 为同一用户目录二次启动命中缓存）。

---

## 2. 基线表现（`B0`）：发热根因量化拆解

| 场景 | 总 CPU%（单核等效） | Renderer% | GPU 进程% | 实测 RAF Hz | Script ms/s | RecalcStyle (次/ms·s⁻¹) | Layout (次/ms·s⁻¹) | JS Heap (MB) | DOM 节点 | HDR 激活 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`S1` 暂停待机** | **6.72%** | 4.31% | 2.41% | 60.3 Hz | 8.60 | 0.6 / 0.32 | 0.29 / 0.05 | 4.46 | 7124 | 是 |
| **`S2` 60Hz 高潮 (HDR)** | **81.22%** | 36.15% | 45.07% | 120.0 Hz | 51.09 | 67.4 / 64.88 | 36.28 / 8.97 | 6.65 | 7126 | 是 |
| **`S2-SDR` 60Hz 高潮** | **79.71%** | 43.66% | 36.05% | 120.0 Hz | 39.81 | 67.7 / 84.79 | 63.98 / 19.00 | 4.67 | 7132 | 否 |
| **`S2-Verse` 60Hz 主歌** | **40.15%** | 16.52% | 23.63% | 120.0 Hz | 18.70 | 59.4 / 40.38 | 8.00 / 2.48 | 5.06 | 7124 | 是 |
| **`S2-120Hz` 高刷高潮** | **93.94%** | 42.06% | 51.60% | 239.9 Hz | 87.74 | 67.4 / 69.62 | 36.56 / 10.50 | 7.54 | 7126 | 是 |
| **`S2-120Hz-Petals`** | **90.43%** | 41.19% | 49.23% | 239.9 Hz | 81.97 | 67.4 / 67.14 | 35.99 / 9.29 | 6.07 | 7126 | 是 |
| **`S3` 文章+灵动岛+悬浮球** | **58.43%** | 28.38% | 30.08% | **179.9 Hz** | 53.53 | 62.6 / 55.93 | 30.56 / 7.53 | 4.91 | 6566 | 是 |
| **`S3-Switch` 切歌过渡** | **58.80%** | 28.04% | 30.72% | **182.2 Hz** | 46.55 | 62.6 / 52.17 | 32.85 / 7.69 | 4.91 | 6575 | 是 |
| **`S4-Cold` 节拍分析** | — | — | — | — | 0.30 (主线程) | — | — | 2.12 | — | — |

> **关键发现**：
> 1. `S4-Cold` 210 秒音频完整拉取解码 + Worker 分析耗时 **432.5 ms**（Renderer CPU 占用 **435.7 ms**，每次刷新或切回未缓存曲目都会重跑）。
> 2. 即使暂停在 `/music`（`S1`），[music-stage-effects.tsx](../web/src/components/music-page/music-stage-effects.tsx) 仍在持续以 **60.3 Hz** 空转，占用 **6.72% CPU**。
> 3. 阅读文章伴听（`S3`）时页面同时跑着 **3 条 60Hz RAF 循环**（`179.9 Hz`）：全尺寸逻辑缩小的 `MusicStageEffects`（胶囊内）+ 单行 `LyricPlayer` + `BeatBars`，光看文章伴听就占去 **58.43%** 单核等效负载（高于全屏主歌 `S2-Verse`）。
> 4. 对比开关关闭组（见后文 `C3a`）：关闭 `effects` 与 `hdr` 后 `S2` 总负载由 `81.22%` 降至 `31.38%`（`-61.4%`），表明高负载主因确为 HDR 离屏合成、30Hz 逐字特效样式计算、WebGPU/2D 粒子与多层混色叠加；发热在物理渲染量上属合理现象，但存在显式的无损优化空间。

---

## 3. 单变量对照实验结果（`E1`–`E9b`）

### 3.1 各单项改动说明与量化收益（相对同场景 `B0`）

| 实验项 | 核心改动模块与策略 | 受测场景 | `B0` 总 CPU% | 改动后总 CPU% | 总 CPU 变化 | Renderer / GPU | 关键过程指标变化 |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`E1`** | [music-stage-effects.tsx](../web/src/components/music-page/music-stage-effects.tsx) 暂停/不可见休眠 + [stage-effects.ts](../web/src/lib/lyrics/stage-effects.ts) `WeakMap` 区间索引 | **`S1` 暂停** | 6.72% | **1.53%** | **-77.2%** | 0.11% / 1.42% | RAF `60.3 -> 0.9 Hz`；Script `8.6 -> 0.04 ms/s` |
| **`E1`** | 同上（播放期间信号索引贡献） | `S2` / `S3` | 81.22% / 58.43% | 85.20% / 58.08% | +4.9% / -0.6% | — | `S3` RecalcStyle 耗时 `-9.9%`（`S2` 波动在 ±5% 采样噪声内） |
| **`E2`** | 闲置混色层 `visibility: hidden` + [lyric-player.css](../web/src/lib/lyrics/lyric-player.css) 仅可见歌手胶囊 `backdrop-filter` + 动态 `.lyric-item` `will-change` | **`S2-Verse`** | 40.15% | **35.01%** | **-12.8%** | 14.10% / 20.91% | RecalcStyle `-9.5%`；Heap `5.06 -> 4.11 MB`（`-18.8%`） |
| **`E2`** | 同上 | `S2` / `S3` | 81.22% / 58.43% | 78.92% / 62.22% | -2.8% / +6.5% | — | `S2` 样式 `-11.5%`、Heap `-21.5%`；`S3` 单行条频繁进出视口切换 `willChange` 反增 6.5% |
| **`E3`** | [lyric-player.css](../web/src/lib/lyrics/lyric-player.css) 移除 `.lyric-line` 与 JS 写入冲突的 CSS `filter 0.35s` 过渡 | **`S2-120Hz`** | 93.94% | **82.41%** | **-12.3%** | 37.77% / 44.44% | GPU `-13.9%`；RecalcStyle `-19.8%`；Task `-17.8%` |
| **`E3`** | 同上 | **`S2` 60Hz** | 81.22% | **77.59%** | **-4.5%** | 34.19% / 43.25% | RecalcStyle `64.88 -> 54.18 ms/s`（`-16.5%`） |
| **`E4`** | [lyric-player.ts](../web/src/lib/lyrics/lyric-player.ts) 静态遮罩平移 + SDR 流光静态渐变 + [lyric-debris.ts](../web/src/lib/lyrics/lyric-debris.ts) 预测量 + [stage-particles.ts](../web/src/lib/lyrics/stage-particles.ts) `Path2D` 复用 | **`S2-120Hz`** | 93.94% | **85.18%** | **-9.3%** | 38.43% / 46.75% | RecalcStyle `-13.8%`；Layout `10.50 -> 7.98 ms/s`（`-24.0%`） |
| **`E4`** | 同上 | `S2` / `S2-SDR` / `Petals` / `S3` | 81.22 / 79.71 / 90.43 / 58.43% | 79.13 / 76.63 / 86.82 / 62.20% | -2.6% / -3.9% / -4.0% / +6.5% | — | `S2` 样式 `-11.9%`；`S2-SDR` Script `-10.4%` |
| **`E5`** | 合并 [music-island-compact.tsx](../web/src/components/layout/topbar-island/music-island-compact.tsx) `BeatBars` RAF + [music-player.tsx](../web/src/components/common/music-player.tsx) 主题色改 CSS `transition` | **`S3` 常态** | 58.43% | **51.56%** | **-11.8%** | 25.06% / 26.50% | RAF **`179.9 -> 120.0 Hz`**；Script `-23.5%`；样式 `-21.1%` |
| **`E5`** | 同上（封面切换高频触发过渡窗口） | **`S3-Switch`** | 58.80% | **47.30%** | **-19.6%** | 22.16% / 25.14% | RecalcStyle `52.17 -> 38.93 ms/s`（`-25.4%`）；Layout 耗时 `-28.1%` |
| **`E6`** | [rhythm/source.ts](../web/src/lib/lyrics/rhythm/source.ts) IndexedDB 持久化 `RhythmAnalysis`（LRU 淘汰） | **`S4-Warm` 二次打开** | 432.5 ms (B0) / 558.7 ms (首次) | **16.9 ms** | **-97.0%** (相对首次) | Renderer CPU `3.9 ms` | 免除 9.26 MB 音频二次下载、解码与 Worker 计算（`-99.2%` CPU） |
| **`E7`** | 仅关闭顶栏灵动岛 HDR 高光（全屏播放器保留 HDR） | **`S3`** | 58.43% | **40.77%** | **-30.2%** | 21.42% / **19.34%** | GPU `-35.7%`；Script `-44.1%`；RecalcStyle `-40.1%` |
| **`E8`** | 高刷屏将 `MusicStageEffects` 粒子/混色氛围限频 60fps（歌词本体仍 120fps） | **`S2-120Hz`** / **`Petals`** | 93.94% / 90.43% | **81.87% / 80.33%** | **-12.8% / -11.2%** | 37.18% / 44.68% | 60Hz `S2` `-2.4%`（不会误降 60Hz 帧率） |
| **`E9a`** | [music-background.tsx](../web/src/components/music-page/music-background.tsx) 离屏 Canvas 预烘焙模糊替代实时 CSS `blur-3xl saturate-150` | `S2` / `S3` | 81.22% / 58.43% | 80.19% / 53.83% | -1.3% / -7.9% | 44.25% / 27.34% | **假设被证伪**：`S2` GPU 仅差 0.82%p，现代合成器已缓存静态层模糊 |
| **`E9b`** | 灵动岛胶囊 `CONTAINED_PARTICLES` 上限 `80 -> 20` | **`S3`** | 58.43% | **47.79%** | **-18.2%** | 23.06% / 24.52% | Script `53.53 -> 32.05 ms/s`（`-40.1%`）；样式 `-31.3%` |

### 3.2 视觉保真度与 HDR / 灵动岛折扣实测矩阵

| 实验项 | 同帧 `MAE ΔRGB` (0–255) | 差异像素占比 | HDR 高光保留 | 视觉、HDR 与灵动岛体验折扣 |
| :--- | :---: | :---: | :---: | :--- |
| **`E1`** | `frameA: 0.0000` · `frameC: 0.0000` | `0.0000%` | 完整保留 (`true`) | **0 折扣**：暂停与后台时休眠，渲染结果比特级一致 |
| **`E2`** | `frameA: 0.0047` · `frameB: 0.0044` | `0.0269%` / `0.0287%` | 完整保留 (`true`) | **肉眼零感知**：可见歌手胶囊仍保留磨砂，`0.005` 级差仅源于合成层舍入 |
| **`E3`** | `frameA: 0.0000` | `0.0000%` | 完整保留 (`true`) | **0 折扣**：切行时景深模糊不再被 CSS 350ms 过渡拖影，跟手度更好 |
| **`E4`** | `frameA: 0.0000` · `frameB: 0.0000` | `0.0000%` | 完整保留 (`true`) | **0 折扣**：静态遮罩与预测量逻辑在画面上完全等价 |
| **`E5`** | `frameC: 0.0000` | `0.0000%` | 完整保留 (`true`) | **0 折扣**：灵动岛律动条与主时钟同帧刷新，切歌发光平滑过渡无损 |
| **`E6`** | — | — | 完整保留 (`true`) | **0 折扣**：直接复用同一份节拍模型数据，首帧即可贴合节拍 |
| **`E7`** | `frameC: 0.6605` | `1.2406%` | **灵动岛降为 SDR** | **中高折扣（仅灵动岛）**：8-bit 截图差看似小，但 XDR/OLED 实机上顶栏胶囊 4×~10× 高光消失，高亮词退回普通彩字 |
| **`E8`** | —（动态帧率差） | — | 完整保留 (`true`) | **轻微动态折扣（仅 >60Hz 屏）**：歌词滑动与逐字擦除保持 120fps，仅背景雨滴/花瓣以 60fps 飘落 |
| **`E9a`** | `frameA: 2.4199` · `frameC: 0.1404` | `65.15%` / `1.25%` | 完整保留 (`true`) | **得不偿失**：离屏采样卷积核与 CSS `blur(64px)` 存在全屏微差，且 `S2` 无显著 GPU 收益 |
| **`E9b`** | `frameC: 0.0000` (t=31.2s) | `0.0000%` | 完整保留 (`true`) | **极轻折扣**：36px 高胶囊内最多 20 颗粒子已足够密集，仅长时间暴雨/撒花场景略减密度 |

> **关于 `Layout` 次数的机制发现**：`E4` 消除 `debris.spawn/shatter` 读写交错后，将 `S2-120Hz` 的 Layout 从 `36.56/s` 降至 `33.13/s`（耗时 `-24.0%`）；其余约 `~30/s` Layout 发生在 30Hz 的逐字特效 `detail` 周期内（对比 `C3a` 关闭 `effects` 后降至 `6/s`），主要源自强调字组盒模型与下划线 `--lyric-line` 等样式在激活帧中的布局失效重算。

---

## 4. 四套组合方案多维度对比（`C1` / `C2` / `C3a` / `C3b`）

| 场景 / 指标 | `B0` 基线 | **`C1` 零视觉损耗全特效** (`E1+E2+E3+E4+E5+E6`) | `C2` 含 E8+E9a 全特效 | `C3a` 仅关现有开关 (`effects=0,hdr=0`) | **`C3b` 真省电/无特效版** (`C1`+无动态+去背景模糊) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **`S1` 暂停待机** | 6.72% (`60.3Hz`) | **1.01%** (`-85.0%`, `0.9Hz`) | — | — | **0.65%** (`-90.3%`, `0.3Hz`) |
| **`S2` 60Hz 高潮** | 81.22% | 83.83% (`+3.2%`, 见下注) | 84.53% (`+4.1%`) | 31.38% (`-61.4%`) | **27.95%** (`-65.6%`) |
| **`S2-SDR` 60Hz** | 79.71% | **77.28%** (`-3.0%`) | — | — | — |
| **`S2-Verse` 60Hz 主歌** | 40.15% | **30.37%** (`-24.4%`) | — | — | — |
| **`S2-120Hz` 高刷高潮** | 93.94% | **76.87%** (`-18.2%`) | 78.97% (`-15.9%`) | — | **27.16%** (`-71.1%`) |
| **`S3` 文章+灵动岛+球** | 58.43% (`179.9Hz`) | **41.30%** (**`-29.3%`**, `120.0Hz`) | 49.01% (`-16.1%`, `120Hz`) | 31.40% (`-46.3%`, `120Hz`) | **24.43%** (**`-58.2%`**, `119.9Hz`) |
| **`S3-Switch` 切歌过渡** | 58.80% (`182.2Hz`) | **46.51%** (**`-20.9%`**, `122.3Hz`) | — | — | — |
| **`S4-Warm` 二次分析** | 432.5 ms | **16.6 ms** (**`-96.2%`**) | — | — | — |
| **`frameA` / `B` / `C` HDR** | `true / true / true` | **`true / true / true`** | `true / — / true` | `false / — / false` | `false / — / false` |
| **`frameA` 像素差 (`MAE`)** | `0` | **`0.0048` (`0.0269%`)** | `2.4218` (`65.14%`) | `21.5235` (`99.30%`) | `19.2480` (`99.30%`) |
| **`frameB` 像素差 (`MAE`)** | `0` | **`0.0080` (`0.0574%`)** | — | — | — |
| **`frameC` 像素差 (`MAE`)** | `0` | **`0.0000` (`0.0000%`)** | `0.1404` (`1.25%`) | `0.9443` (`1.76%`) | `0.9248` (`1.78%`) |

> **关键对比解读**：
> 1. **为何 `C1` 在 `S2-120Hz`（`-18.2%`）、`S2-Verse`（`-24.4%`）、`S3`（`-29.3%`）与 `S1`（`-85.0%`）显著下降，而 `S2` 60Hz 中位数（83.83% vs 81.22%）略高？**
>    一方面连续 3 轮 Metal WebGPU 采样存在 ±5% 热波动（`B0` `S2` 三次为 `72.05%~82.15%`，`C1` 为 `80.89%~87.28%`）；另一方面，`E2` 在频繁进出视口时动态切换 `willChange` 在高密度切行/单行条 `strip` 场景会产生额外图层切换开销（`E2` 在 `S3` 反升 `6.5%` 可印证），落地时建议将动态 `will-change` 仅限非 `strip` 模式或改用混合层静态策略。
> 2. **`C2` 慢于 `C1`**：加入 `E9a` 后 `S2`（84.53% vs 83.83%）、`S3`（49.01% vs 41.30%）和 `S2-120Hz`（78.97% vs 76.87%）均不如纯 `C1`，证实全特效模式下**应放弃 `E9a`**。
> 3. **关于 `C3b` 的实现提示**：测试中通过 CDP 在挂载后注入 `prefers-reduced-motion: reduce`，而 `LyricPlayer` 在构造时一次性读取该媒体查询，若正式落地真省电/无特效开关，需同步向 `LyricPlayer` 和 `MusicBackground` 传递标志位以一并关掉非活跃行景深 `blur()` 与背景 `blur-3xl`。

---

## 5. ROI 综合推荐梯度

| 推荐等级 | 实验编号 | 主要优化收益 | 视觉/HDR/灵动岛折扣 | 落地建议 |
| :---: | :--- | :--- | :---: | :--- |
| **P0 必做** | **`E6`** IndexedDB 节拍缓存 | 二次分析耗时 `-96.2%`（432.5ms → 16.6ms） | 无 | 缓存分析结果（LRU 淘汰），零下载零解码秒开节拍动画 |
| **P0 必做** | **`E1`** 暂停与后台休眠 | 暂停总 CPU `-77.2% ~ -85.0%`，RAF 归 `0.9Hz` | 无 | `isPlaying=false` 且粒子归零后彻底停止 RAF |
| **P0 必做** | **`E5`** 合并灵动岛 BeatBars RAF + CSS 过渡 | 文章伴听 `-11.8%`，切歌过渡 `-19.6%`，3 路 RAF 变 2 路 | 无 | `showLyricEffects` 开启时复用舞台循环，关闭时回退 |
| **P0 必做** | **`E3`** 移除 `.lyric-line` 冲突 `filter` 过渡 | 120Hz 高潮 `-12.3%`（样式 `-19.8%`），60Hz `-4.5%` | 无（切行更跟手） | 删除 `.lyric-line` transition 中的 `filter 0.35s ease-out` |
| **P1 推荐** | **`E4`** 静态遮罩定位 + 碎屑预测量 + `Path2D` | 120Hz 高潮 `-9.3%`（Layout 耗时 `-24.0%`），SDR `-3.9%` | 无 | 静态渐变配 `maskPosition`，`paint()` 写样式前集中读取几何 |
| **P1 改良** | **`E2`** 混色层可见性裁剪 + 按需歌手胶囊模糊 | 主歌段 `-12.8%`，内存 `-18.8%` | 无 | 混色层 `visibility: hidden` + 仅可见胶囊模糊；`strip` 禁用动态 `willChange` |
| **P2 轻取舍** | **`E9b`** 灵动岛胶囊粒子上限 `80 -> 20` | 文章伴听再降 `-18.2%`（Script `-40.1%`） | 仅极端密集颗粒略少 | 小胶囊高仅 36px，20 颗视觉几乎无损 |
| **P2 轻取舍** | **`E8`** 高刷屏背景粒子锁 60fps | 120Hz 设备再降 `-11.2% ~ -12.8%` | 歌词仍 120fps，仅背景粒子 60fps | 高刷手机发热降频控制利器 |
| **可选** | **`E7`** 关闭灵动岛 HDR | 看文章直降 `-30.2%`（GPU `-35.7%`） | 灵动岛失去 HDR 高光 | 视灵动岛 HDR 偏好决定，或提供分级开关 |
| **放弃** | **`E9a`** 离屏烘焙模糊背景 | 仅差 1.3%，组合反而变慢 | 背景微差 (`MAE=2.42`) | 放弃 |
| **模式化** | **`C3b`** 完善无特效/省电模式 | 全屏 `-65.6% ~ -71.1%`，看文章 `-58.2%` | 关闭特效/HDR/景深与大模糊 | 与全特效模式并存供低电量/老设备切换 |

---

## 6. 最终落地方案实测验证（Final）

### 6.1 最终确认并落地的 8 项改动

- **`E6` 节奏分析缓存持久化**：`web/src/lib/lyrics/rhythm/source.ts` 增加 IndexedDB 持久化（库 `neo-music-rhythm-v1` / 表 `analyses`，保留最近 `200` 首，按 `updatedAt` LRU 淘汰，无 `indexedDB` 环境安全降级），并在 `source.test.ts` 补充单元测试。
- **`E1` 暂停/后台自动休眠 + 区间索引**：`stage-effects.ts` 增加 `WeakMap<ResolvedLyrics, StageIndex>` 索引与 `sceneAtIndexed`；`music-stage-effects.tsx` 基于 `useMusicClockStore` 播放状态、`visibilitychange` 与动画稳定状态在空闲时暂停背景粒子 RAF。
- **`E3` 去掉过渡 `filter`**：`lyric-player.css` 移除 `.lyric-line` transition 中的 `filter 0.35s ease-out`。
- **`E5` 合并灵动岛动画循环**：`music-island-compact.tsx` 将 `BeatBars` RAF 合并进 `MusicStageEffects` 的 `onFrame`（特效关闭时保留独立 RAF 回退）；`music-player.tsx` 移除 `useAnimatedThemeColor` JS RAF 循环（及配套 `parseThemeColor` / `ALBUM_TRANSITION_DURATION_MS` 引用），改由 CSS `transition-[transform,box-shadow]` 处理主题色过渡。
- **`E2`（改进版）图层合成收敛**：`music-stage-effects.tsx` 对空闲混合层设置 `visibility: 'hidden'`；`lyric-player.css` 仅在 `.lyric-singer--visible` 保留 `backdrop-filter: blur(8px)`，并将静态 `will-change: transform` 收窄到 `.lyric-player--strip .lyric-item`；`lyric-player.ts` 为非横幅 `LyricPlayer` 动态切换 `willChange`。
- **`E4` 布局读写批处理与绘制降负**：`lyric-player.ts` 实现 `collectDebrisReads`、`getStaticWordMask` + `maskPosition`、`SDR_SHIMMER_IMAGE` + `bgColor` + `--lyric-shine-x`；`lyric-debris.ts` 导出并复用 `DebrisMeasured` 预测量结构；`stage-particles.ts` 缓存 `petals` / `hearts` / `leaves` 的单位 `Path2D`。
- **`E9b` 灵动岛紧凑模式限流**：`music-stage-effects.tsx` 支持 `maxParticles`，`music-island-compact.tsx` 在顶部灵动岛紧凑胶囊传入 `maxParticles={20}`（`MiniPlayer` 保持 `80`，`/music` 全屏页不限）。
- **`E8` 背景与粒子高刷降频**：`music-stage-effects.tsx` 在高刷屏（>60Hz）上按 `11.5ms` 阈值将粒子与背景动画层限制在 ~60fps，`LyricPlayer` 歌词与时间轴保持原生 120fps。
- **未启用 / 延后**：`E7`（继续保留灵动岛 HDR）、`E9a`（放弃）、`C3b` / 低功耗自动检测切换（留待后续独立迭代）。

### 6.2 Final vs B0 实测数据与视觉回归

> 说明：以下 `Final` 数据来自完整落地后通过真实 Chrome + WebGPU HDR10 benchmark 跑测的结果；采样紧跟在 `pnpm build` 之后，当轮宿主机处于高负载（`uptime` 显示 `load averages: 7.41 8.44 8.04`），因此全屏高特效场景（`S2` / `S2-120Hz`）的绝对 CPU% 受后台系统负载波动影响较明显。

| 场景 | B0 总 CPU | Final 总 CPU（Renderer / GPU） | 变化 | 帧率 / 样式计算 / HDR 状态 |
| --- | ---: | ---: | ---: | --- |
| **`S1`** 暂停空闲 | `6.72%` | **`1.06%`**（`R=0.06%` / `G=1.05%`） | **`-84.2%`** | `60.3 Hz -> 0.9 Hz`，style `0.32ms -> 0ms`，`hdr=true` |
| **`S2`** 全屏副歌 | `81.22%` | `92.34%`（`R=40.42%` / `G=51.06%`） | `+13.7%`（高负载批次） | `120 Hz -> 120 Hz`，style `64.88ms -> 69.66ms`，`hdr=true` |
| **`S2-Verse`** 全屏主歌 | `40.15%` | **`32.56%`**（`R=13.96%` / `G=18.41%`） | **`-18.9%`** | `120 Hz -> 120 Hz`，style `40.38ms -> 36.63ms`，`hdr=true` |
| **`S2-120Hz`** 120Hz 全量循环 | `93.94%` | `102.13%`（`R=46.45%` / `G=55.68%`） | `+8.7%`（高负载批次） | `239.9 Hz -> 240 Hz`，style `69.62ms -> 78.94ms`，`hdr=true` |
| **`S3`** 看文章 + 灵动岛 | `58.43%` | **`43.66%`**（`R=21.43%` / `G=22.23%`） | **`-25.3%`** | `179.9 Hz -> 120 Hz`，style `55.93ms -> 35.52ms`，`hdr=true` |
| **`S3-Switch`** 灵动岛切歌 | `58.80%` | **`54.48%`**（`R=25.74%` / `G=27.91%`） | **`-7.3%`** | `182.2 Hz -> 122.3 Hz`，style `52.17ms -> 41.84ms`，`hdr=true` |

- **`S4-Warm` 节奏分析缓存命中**：首次分析耗时 `542.8 ms`（Renderer CPU `521.7 ms`，Heap `1.94 MB`，Main Script `0.7 ms`），二次播放通过 IndexedDB 热命中降至 **`16.6 ms`**（Renderer CPU **`4.6 ms`**，Heap `2.19 MB`，Main Script `0.3 ms`），耗时较首次分析下降 **`-96.9%`**（较 `B0 S4-Cold 432.5 ms` 下降 **`-96.2%`**）。
- **视觉回归（HDR10 PNG 像素对比）**：
  - 全屏关键帧 `frameA`：`hdr=true`，`webgpuCanvases=2`，`MAE RGB = 0.0048`（变化像素比例 `0.0269%`）。
  - 灵动岛关键帧 `frameC`：`hdr=true`，`webgpuCanvases=2`，`MAE RGB = 0`（变化像素比例 `0%`）。

### 6.3 工程构建与单测验证

- `pnpm vitest run`：`Test Files 129 passed (129)`、`Tests 931 passed (931)`。
- `pnpm lint`：`0 errors, 1 warning`（唯一 warning 为既有 `web/src/components/tiptap-node/image-node/image-node-view.tsx` 中的 `<img>` 提示）。
- `pnpm build`：退出码 `0`（`Compiled successfully in 22.0s`、TypeScript `12.3s`、生成 `115/115` 静态页面）。

