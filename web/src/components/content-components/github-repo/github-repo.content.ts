import type { GithubRepoProps } from './schema'
import { FolderGit2Icon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { githubRepoSchema } from './schema'

export default defineContentComponent({
  name: 'githubRepo',
  version: 1,
  schema: githubRepoSchema,
  component: dynamic(() => import('./github-repo')),
  icon: FolderGit2Icon,
  keywords: ['github', 'repo', 'repository', 'cangku', 'ck', '仓库', '项目'],
  fallback: ({ repo }: GithubRepoProps) => [
    ['p', {}, ['a', { href: `https://github.com/${repo}`, target: '_blank', rel: 'noopener noreferrer' }, `github.com/${repo}`]],
  ],
  example: () => ({ repo: 'snowykami/neo-blog' }),
})
