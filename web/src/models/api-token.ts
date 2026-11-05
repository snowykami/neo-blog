// 个人 API Token 的权限范围：与后端 constant.APITokenScopes 对应
export const API_TOKEN_SCOPES = ['posts:read', 'posts:write', 'posts:publish', 'files:write', 'ai_agents:read', 'ai_agents:write'] as const

export type APITokenScope = (typeof API_TOKEN_SCOPES)[number]

// 写入与发布文章需要编辑及以上角色，管理 AI 用户只有管理员可以，其余权限范围所有登录用户可用（与后端 RoleAllowsScope 一致）
export const EDITOR_ONLY_SCOPES: readonly APITokenScope[] = ['posts:write', 'posts:publish']
export const ADMIN_ONLY_SCOPES: readonly APITokenScope[] = ['ai_agents:read', 'ai_agents:write']

export interface APIToken {
  id: number
  name: string
  prefix: string // 明文开头几位，用于辨认
  scopes: APITokenScope[]
  expiresAt: string | null // 为空表示永不过期
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}
