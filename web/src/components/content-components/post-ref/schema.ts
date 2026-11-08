import { z } from 'zod'

/**
 * 正文中的「文章引用」卡片：只保存被引用文章的 id，
 * 标题、摘要、封面等展示时从接口实时读取，被引用文章修改后卡片随之更新
 */
export const postRefSchema = z.object({
  // 文章 id，由「选择文章」按标题搜索后填入
  postId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  // 是否显示封面：窄卡片或不想要配图时关闭
  showCover: z.boolean().default(true),
}).superRefine((props, ctx) => {
  // 没选文章时卡片无法渲染，插入后立即在属性弹窗里补全
  if (props.postId <= 0)
    ctx.addIssue({ code: 'custom', path: ['postId'], params: { reason: 'required' }, message: 'required' })
})

export type PostRefProps = z.output<typeof postRefSchema>
export type PostRefInput = z.input<typeof postRefSchema>
