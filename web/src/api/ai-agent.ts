import type {
  AgentMemory,
  AgentMemoryKind,
  AgentRelation,
  AgentRun,
  AgentRunActionFilter,
  AgentRunStatus,
  AgentRunTrigger,
  AIAgent,
  AIAgentFileItem,
  AIAgentGroup,
  AIAgentGroupTemplate,
  AIAgentPreview,
  AIAgentProfile,
  AIAgentStats,
  AIAgentStatus,
  AIAgentTier,
  ImportAIAgentResult,
} from '@/models/ai-agent'
import type { PaginationParams } from '@/models/common'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// AI 用户管理接口，全部仅管理员可用（后端 admin 中间件校验）

export interface ListAIAgentsParams extends PaginationParams {
  query?: string
  tier?: AIAgentTier | ''
  status?: AIAgentStatus | ''
  groupId?: number
}

export async function listAIAgents(params: ListAIAgentsParams): Promise<BaseResponse<{ agents: AIAgent[], total: number }>> {
  const res = await axiosClient.get('/admin/ai-agents', { params })
  return res.data
}

export async function getAIAgentStats(): Promise<BaseResponse<AIAgentStats>> {
  const res = await axiosClient.get('/admin/ai-agents/stats')
  return res.data
}

export interface CreateAIAgentReq {
  username: string
  nickname: string
  avatarUrl: string
  tier: AIAgentTier
  profile?: AIAgentProfile // 为空时使用该类型的默认档案
}

export async function createAIAgent(data: CreateAIAgentReq): Promise<BaseResponse<AIAgent>> {
  const res = await axiosClient.post('/admin/ai-agents', data)
  return res.data
}

// 导出：指定 id 时只导出这一个，否则按列表的筛选条件导出全部
export async function exportAIAgents(params: Omit<ListAIAgentsParams, 'page' | 'size'> & { id?: number }): Promise<BaseResponse<{ agents: AIAgentFileItem[] }>> {
  const res = await axiosClient.get('/admin/ai-agents/export', { params })
  return res.data
}

// 导入：按用户名逐个新建或更新已有的 AI 用户，单个失败不影响其他；dryRun 时只给出每一项将执行的操作。人数较多时较慢，放宽超时
export async function importAIAgents(agents: AIAgentFileItem[], dryRun = false): Promise<BaseResponse<{ results: ImportAIAgentResult[] }>> {
  const res = await axiosClient.post('/admin/ai-agents/import', { agents, dryRun }, { timeout: 120000 })
  return res.data
}

// 把已有普通用户设为 AI 用户：会吊销其全部会话与个人 Token
export async function convertUserToAIAgent(userId: number, data: { tier: AIAgentTier, profile?: AIAgentProfile }): Promise<BaseResponse<AIAgent>> {
  const res = await axiosClient.post(`/admin/users/${userId}/ai`, data)
  return res.data
}

export async function getAIAgent(id: number): Promise<BaseResponse<AIAgent>> {
  const res = await axiosClient.get(`/admin/ai-agents/${id}`)
  return res.data
}

export async function updateAIAgent(id: number, data: { tier: AIAgentTier, profile: AIAgentProfile }): Promise<BaseResponse<AIAgent>> {
  const res = await axiosClient.put(`/admin/ai-agents/${id}`, data)
  return res.data
}

export async function pauseAIAgent(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/admin/ai-agents/${id}/pause`)
  return res.data
}

export async function resumeAIAgent(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/admin/ai-agents/${id}/resume`)
  return res.data
}

// 取消 AI 身份：删除性格、记忆与关系，账号保留为普通用户
export async function deleteAIAgent(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/ai-agents/${id}`)
  return res.data
}

// 试运行：返回排队中的运行记录，需轮询 getAgentRun 直到结束
export async function dryRunAIAgent(id: number, data: { targetType: 'post' | 'comment', targetId: number }): Promise<BaseResponse<AgentRun>> {
  const res = await axiosClient.post(`/admin/ai-agents/${id}/dry-run`, data)
  return res.data
}

export interface ListAgentMemoriesParams extends PaginationParams {
  kind?: AgentMemoryKind | ''
  subjectUserId?: number
  query?: string
}

export async function listAgentMemories(agentId: number, params: ListAgentMemoriesParams): Promise<BaseResponse<{ memories: AgentMemory[], total: number }>> {
  const res = await axiosClient.get(`/admin/ai-agents/${agentId}/memories`, { params })
  return res.data
}

export async function listAgentRelations(agentId: number, params: PaginationParams): Promise<BaseResponse<{ relations: AgentRelation[], total: number }>> {
  const res = await axiosClient.get(`/admin/ai-agents/${agentId}/relations`, { params })
  return res.data
}

export async function updateAgentMemory(id: number, data: { content?: string, importance?: number, pinned?: boolean }): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/ai-agent-memories/${id}`, data)
  return res.data
}

export async function deleteAgentMemory(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/ai-agent-memories/${id}`)
  return res.data
}

export async function deleteAgentRelation(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/ai-agent-relations/${id}`)
  return res.data
}

export interface ListAgentRunsParams extends PaginationParams {
  agentId?: number
  status?: AgentRunStatus | ''
  action?: AgentRunActionFilter | ''
  trigger?: AgentRunTrigger | ''
}

export async function listAgentRuns(params: ListAgentRunsParams): Promise<BaseResponse<{ runs: AgentRun[], total: number }>> {
  const res = await axiosClient.get('/admin/ai-agent-runs', { params })
  return res.data
}

export async function getAgentRun(id: number): Promise<BaseResponse<AgentRun>> {
  const res = await axiosClient.get(`/admin/ai-agent-runs/${id}`)
  return res.data
}

// 撤回该次运行产生的评论、回滚资料修改
export async function revertAgentRun(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/admin/ai-agent-runs/${id}/revert`)
  return res.data
}

export async function listAIAgentGroups(): Promise<BaseResponse<{ groups: AIAgentGroup[] }>> {
  const res = await axiosClient.get('/admin/ai-agent-groups')
  return res.data
}

export async function getAIAgentGroup(id: number): Promise<BaseResponse<AIAgentGroup>> {
  const res = await axiosClient.get(`/admin/ai-agent-groups/${id}`)
  return res.data
}

export interface GenerateAIAgentGroupReq {
  name: string
  count: number
  template: AIAgentGroupTemplate
  preview: boolean // 只生成预览（最多 10 个），不创建账号
}

export async function generateAIAgentGroup(data: GenerateAIAgentGroupReq): Promise<BaseResponse<{ group?: AIAgentGroup, preview?: AIAgentPreview[] }>> {
  // 生成人设需要调用模型，耗时可能超过默认超时
  const res = await axiosClient.post('/admin/ai-agent-groups/generate', data, { timeout: data.preview ? 120000 : 30000 })
  return res.data
}

// 整组暂停 / 恢复
export async function updateAIAgentGroupStatus(id: number, status: AIAgentStatus): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/ai-agent-groups/${id}/status`, { status })
  return res.data
}
