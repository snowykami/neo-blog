import { getTranslations } from 'next-intl/server'
import { AIAgentsPage } from '@/components/console/ai-agents/agents-page'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('ai_agents.title'),
  }
}

export default function Page() {
  return <AIAgentsPage />
}
