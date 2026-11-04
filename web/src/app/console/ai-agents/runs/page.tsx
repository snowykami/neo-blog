import { getTranslations } from 'next-intl/server'
import { AgentRunsPage } from '@/components/console/ai-agents/runs-page'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('ai_agents.runs.title'),
  }
}

export default function Page() {
  return <AgentRunsPage />
}
