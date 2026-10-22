# 前端弹窗与反馈使用规范

本文约定 `web/` 中各类弹层与反馈组件的选型、文案和交互细节。新增或修改交互时先对照本文，再从 `web/src/components/ui/`（shadcn）与 `web/src/components/common/` 中选组件。

## 1. 选型速查

| 场景 | 组件 | 位置 | 典型例子 |
| --- | --- | --- | --- |
| 操作完成后的轻量结果（成功/失败/提示） | **Toast** | `sonner` 的 `toast.*` | 保存成功、删除失败：原因 |
| 页面或区块内需要常驻的状态说明 | **Alert** | `@/components/ui/alert` | 编辑会话被接管、资源加载失败 + 重试 |
| 需要用户专注完成的任务或表单 | **Dialog**（移动端可配 **Drawer**） | `@/components/ui/dialog`、`drawer` | 新建标签、编辑用户、重置密码、资产库 |
| 高风险、不可逆、影响面大的操作确认 | **AlertDialog** | `@/components/common/confirm-dialog` | 删除用户、禁用用户、批量删除、删除全局配置 / 认证源、删除带回复的评论 |
| 就地、单个对象、影响可控的二次确认 | **Popconfirm** | `@/components/common/popconfirm` | 删除文章 / 页面 / 单个文件 / 标签 / 分类 / 存储源、解绑第三方账号 |
| 承载较多内容的侧边面板 / 移动端导航 | **Sheet** | `@/components/ui/sheet` | 编辑器设置、用户详情、移动端菜单 |
| 移动端从底部弹出的任务面板 | **Drawer** | `@/components/ui/drawer` | 资产库在小屏下的形态 |

判断「AlertDialog 还是 Popconfirm」时按以下顺序，命中任意一条就用 AlertDialog：

1. 批量操作，或一次影响多个对象；
2. 有连带影响（会同时删除 / 转移其他数据、让其他用户失去访问或登录能力、影响全站运行）；
3. 需要在确认前展示较多信息（统计、清单、说明段落）；
4. 操作入口不在被操作对象旁边（例如全局工具栏），就地气泡无法说明对象是谁。

其余单个对象的删除、移除、解绑等用 Popconfirm。可撤销或纯前端的操作（清空输入框、移除待上传项）不需要确认。

## 2. Toast

- 只用来反馈**操作结果**，不要用来承载需要用户阅读或处理的信息；需要常驻的用 Alert。
- 成功：`toast.success(operationT('delete_success'))`，文案用「动作 + 结果」，不加感叹号。
- 失败：`toast.error(\`${operationT('delete_failed')}: ${errorMessageT(error)}\`)`，前缀说明哪个动作失败，冒号后给出原因。
- 进行中 / 中性提示：`toast.info`；用户输入问题（如未修改、超出数量）：`toast.warning`。
- **同一次操作只弹一次**：`ConfirmDialog` / `Popconfirm` 的 `onConfirm` 抛出异常时，组件统一按上面的格式弹出失败 Toast（前缀用 `errorText`），调用方只负责成功 Toast，不要在 `onConfirm` 里再 catch 后弹失败。
- 位置统一在顶部居中（见 `app/layout.tsx` 中的 `<Toaster />`），不要在页面里再挂额外的 Toaster。

## 3. Alert

- 用于页面或区块内常驻、需要用户注意的状态：只读 / 被接管、加载失败、功能未配置等。
- 失败类用 `variant="destructive"`，提示类用默认样式；有可执行的补救动作（重试、去配置）时把按钮放在 `AlertDescription` 里。
- 不要用 Toast 代替加载失败的常驻提示，也不要用 Alert 反馈一次性的操作结果。

## 4. Dialog / Drawer / Sheet

- Dialog 用于表单或需要专注完成的任务，标题写明任务（「编辑用户」），底部按钮顺序为 **取消（outline）在左、主操作在右**。
- 表单统一用 `react-hook-form`；提交中禁用主按钮并显示加载态，提交失败保持弹窗打开。
- 可以通过遮罩、Esc 或右上角关闭；表单有未提交的修改时按需拦截。
- 内容较多或需要与页面并排参考时用 Sheet（右侧）；移动端需要大面积展示的选择器可以用 Drawer（底部），参考 `AssetPicker` 的 Dialog / Drawer 自适应写法。

## 5. AlertDialog（`ConfirmDialog`）

- 标题用问句点明动作和对象：「删除用户「alice」？」；描述写清**后果**（会删除 / 转移什么、是否可恢复），不要只写「确定吗？」。
- 确认按钮用具体动词（「删除」「禁用」），危险操作用 `destructive` 样式；取消在左、确认在右，移动端上下堆叠时确认在上。
- **不能点击遮罩关闭**（Radix AlertDialog 默认行为），只能通过「取消」或 Esc 关闭；执行中禁止关闭。
- `onConfirm` 返回 Promise：进行中按钮禁用并显示加载态，成功后关闭，失败保持打开并由组件弹出失败 Toast。
- 由下拉菜单触发时使用受控模式（`open` / `onOpenChange`，不传 `children`），避免菜单关闭时把弹窗一起卸载。

## 6. Popconfirm

- 气泡贴着触发按钮出现，只包含一句标题、可选的一句描述和两个小按钮，不放表单或长文本。
- 标题同样写成问句，最好带上对象名：「删除「Hello World」？」；描述一句话说明后果。
- 按钮顺序：取消（outline）在左、确认在右；删除类传 `destructive`，确认按钮用具体动词。
- 打开后焦点落在「取消」上，防止误按回车；Esc、点击外部可关闭；执行中两者都被拦截。
- `onConfirm` 的异步行为与 `ConfirmDialog` 一致：加载中禁用按钮，成功后关闭，失败保持打开并弹出失败 Toast。
- 触发器在下拉菜单里时，用 `anchorOnly` + 受控 `open`，把菜单触发按钮作为锚点；同时在 `DropdownMenuContent` 的 `onCloseAutoFocus` 中阻止焦点回到触发器，避免焦点把气泡顶掉。若菜单本身是 `Popover`（同类上下文），要把整个菜单 `Popover` 包进锚点元素里，而不是只包它的 `PopoverTrigger`，否则触发器会取到确认气泡的上下文（参考 `components/comment/comment-item.tsx`）。
- 移动端宽度不超过 `100vw - 1rem`，并保留 8px 的碰撞边距，不需要改用 Drawer。

## 7. 文案语气

- 标题用问句，描述用陈述句，按钮用动词；同一类操作在不同页面用同一套文案键（`Operation.*`）。
- 不使用「请谨慎操作！」之类的感叹语气来代替具体后果；能说明后果就说明后果。
- 所有用户可见文本接入 `next-intl`，并同步 `web/src/locales/` 下全部语言文件。

## 8. 说明气泡（InfoTooltip）

- 表单项、设置项的**补充说明**（用途、示例值、取值规则、隐私说明等）不再常驻在字段下方，统一放进标签右侧的 info 图标气泡：`<LabelWithInfo info={t('xxx_desc')}><FormLabel>…</FormLabel></LabelWithInfo>`；需要自定义布局时直接用 `<InfoTooltip content={…} />`，组件位于 `@/components/common/info-tooltip`。
- 悬停或键盘聚焦显示，触屏设备点按显示、点击别处关闭；图标按钮带无障碍名称（`Common.more_info`）。
- 仍需常驻显示的内容：卡片 / 分组顶部的整体介绍、校验错误（`FormMessage`）、会直接影响填写结果且必须先看到的警告，以及确认弹窗里的后果描述。
- 气泡只放一两句纯文本，不放链接、按钮或表单；需要更多内容时改用 Popover 或文档链接。
