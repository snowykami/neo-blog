'use client'

import { Check, Copy, ExternalLink, Info, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSiteInfo } from '@/contexts/site-info-context'
import copyToClipboard from '@/lib/clipboard'
import { useAIAgentT } from './shared'

// 「人物蒸馏」skill 在仓库中的位置（skills/neo-blog-persona-distill）
const REPO_URL = 'https://github.com/snowykami/neo-blog'
const SKILL_NAME = 'neo-blog-persona-distill'
const SKILL_URL = `${REPO_URL}/tree/main/skills/${SKILL_NAME}`
const STEPS = ['step_install', 'step_distill', 'step_import'] as const

// 人物蒸馏：给出安装 skill 的提示词，复制给 Claude Code、Codex 等 Agent 客户端即可自行安装
export function DistillSkillDialog({ open, onOpenChange, onImport }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: () => void
}) {
  const t = useAIAgentT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('distill.title')}</DialogTitle>
          <DialogDescription>{t('distill.description')}</DialogDescription>
        </DialogHeader>
        {open && <DistillSkillBody onImport={onImport} />}
      </DialogContent>
    </Dialog>
  )
}

function DistillSkillBody({ onImport }: { onImport: () => void }) {
  const t = useAIAgentT()
  const { siteInfo } = useSiteInfo()
  const [copied, setCopied] = useState(false)
  const prompt = t('distill.prompt', {
    repoUrl: REPO_URL,
    skillName: SKILL_NAME,
    siteUrl: siteInfo.baseUrl || window.location.origin,
  })

  const copy = async () => {
    if (await copyToClipboard(prompt)) {
      setCopied(true)
      toast.success(t('distill.copied'))
    }
    else {
      toast.error(t('distill.copy_failed'))
    }
  }

  return (
    <div className="grid gap-4">
      <ol className="grid gap-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary tabular-nums">{index + 1}</span>
            <span className="pt-0.5">{t(`distill.${step}`)}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('distill.prompt_label')}</span>
          <Button type="button" size="sm" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {t('distill.copy')}
          </Button>
        </div>
        <pre className="max-h-64 overflow-y-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">{prompt}</pre>
      </div>
      <Alert>
        <Info />
        <AlertDescription><p>{t('distill.consent')}</p></AlertDescription>
      </Alert>
      <DialogFooter>
        <Button type="button" variant="ghost" asChild>
          <a href={SKILL_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t('distill.view_skill')}
          </a>
        </Button>
        <Button type="button" onClick={onImport}>
          <Upload />
          {t('distill.go_import')}
        </Button>
      </DialogFooter>
    </div>
  )
}
