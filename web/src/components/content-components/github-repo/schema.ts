import { z } from 'zod'
import { GITHUB_REPO_PATTERN } from '../safe-url'

export { GITHUB_REPO_PATTERN }

export const githubRepoSchema = z.object({
  repo: z.string().trim().regex(GITHUB_REPO_PATTERN).refine(value => !/\/\.{1,2}$/.test(value)).default(''),
})

export type GithubRepoProps = z.output<typeof githubRepoSchema>
