import { z } from 'zod'

export const codeTabSchema = z.object({
  label: z.string().trim().min(1).max(40).default(''),
  // highlight.js 语言名，留空或未注册的语言按纯文本显示
  language: z.string().trim().max(30).regex(/^[\w+#.-]*$/).default(''),
  code: z.string().max(20000).meta({ widget: 'code' }).default(''),
})

export const codeTabsSchema = z.object({
  tabs: z.array(codeTabSchema).min(1).max(8).default([
    { label: 'TypeScript', language: 'typescript', code: '' },
    { label: 'JavaScript', language: 'javascript', code: '' },
  ]),
})

export type CodeTabsProps = z.output<typeof codeTabsSchema>
