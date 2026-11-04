import { getTranslations } from 'next-intl/server'
import { AIAgentDetailPage } from '@/components/console/ai-agents/agent-detail'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('ai_agents.detail.title'),
  }
}

export default function Page() {
  return <AIAgentDetailPage />
}
