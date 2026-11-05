'use client'

import type { ExportAIAgentsParams } from '@/api/ai-agent'
import type { AIAgentFileItem, AIAgentTier } from '@/models/ai-agent'
import { camelToSnakeObj, snakeToCamelObj } from 'field-conv'
import { useState } from 'react'
import { toast } from 'sonner'
import { exportAIAgents } from '@/api/ai-agent'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { useAIAgentT } from './shared'

// 导入导出文件：单个对象为一个 AI 用户，对象数组为多个。字段与后端接口一样使用 snake_case，前端模型为 camelCase，读写文件时在这里转换

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** 解析导入文件；不是 AI 用户文件（每一项都至少要有 username 或 profile）时返回 null */
export function parseAgentFile(content: string): AIAgentFileItem[] | null {
  let data: unknown
  try {
    data = JSON.parse(content)
  }
  catch {
    return null
  }
  const list = Array.isArray(data) ? data : [data]
  if (list.length === 0 || !list.every(item => isObject(item) && ('username' in item || 'profile' in item)))
    return null
  // 外部生成的文件可能缺字段，账号资料统一补成字符串
  return (snakeToCamelObj(list) as Record<string, unknown>[]).map(item => ({
    username: text(item.username),
    nickname: text(item.nickname),
    avatarUrl: text(item.avatarUrl),
    backgroundUrl: text(item.backgroundUrl),
    preferredColor: text(item.preferredColor),
    tier: text(item.tier) as AIAgentTier,
    profile: isObject(item.profile) ? item.profile : undefined,
  }))
}

/** 保存为 JSON 文件：单个 AI 用户写成对象，多个写成数组 */
export function downloadAgentFile(data: AIAgentFileItem | AIAgentFileItem[], filename: string) {
  const content = `${JSON.stringify(camelToSnakeObj(data), null, 2)}\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** 导出 AI 用户：指定 id 时只导出这一个（文件为单个对象，以用户名命名）；指定 ids 时导出勾选的，否则导出全部（文件为数组） */
export function useExportAIAgents() {
  const t = useAIAgentT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [exporting, setExporting] = useState(false)

  const exportAgents = async (params: ExportAIAgentsParams = {}) => {
    setExporting(true)
    try {
      const agents = (await exportAIAgents(params)).data.agents ?? []
      if (agents.length === 0) {
        toast.info(t('export.empty'))
        return
      }
      if (params.id) {
        downloadAgentFile(agents[0], `${agents[0].username}.ai-agent.json`)
      }
      else {
        const now = new Date()
        const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('-')
        downloadAgentFile(agents, `ai-agents-${date}.json`)
      }
      toast.success(t('export.success', { count: agents.length }))
    }
    catch (err) {
      toast.error(errorMessageT(err, operationT('operation_failed')))
    }
    finally {
      setExporting(false)
    }
  }

  return { exporting, exportAgents }
}
