import { z } from 'zod'

export const CALLOUT_TYPES = ['info', 'warning', 'tip'] as const

export const calloutSchema = z.object({
  type: z.enum(CALLOUT_TYPES).default('info'),
  title: z.string().trim().max(120).default(''),
  content: z.string().trim().min(1).max(4000).meta({ widget: 'textarea' }).default(''),
})

export type CalloutProps = z.output<typeof calloutSchema>
