import { z } from 'zod'

// owner/repo：与后端校验规则一致
export const GITHUB_REPO_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,38}\/[\w.-]{1,100}$/i

export const githubRepoSchema = z.object({
  repo: z.string().trim().regex(GITHUB_REPO_PATTERN).refine(value => !/\/\.{1,2}$/.test(value)).default(''),
})

export type GithubRepoProps = z.output<typeof githubRepoSchema>
