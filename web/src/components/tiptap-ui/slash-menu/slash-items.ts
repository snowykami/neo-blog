import type { BlockTypeId } from '@/components/tiptap-editor/editor-commands'
import type { SlashCommandItem } from '@/components/tiptap-extension/slash-command-extension'
import { CalendarIcon, ImageIcon, MinusIcon, SparklesIcon, TableIcon } from 'lucide-react'
import { CONTENT_COMPONENTS } from '@/components/content-components/registry'
import { getBlockTypeDef, setBlockType } from '@/components/tiptap-editor/editor-commands'

type Translate = (key: string, values?: Record<string, string | number>) => string

// 分组：定义顺序即菜单展示顺序
type SlashGroup = 'ai' | 'basic' | 'list' | 'media' | 'other'

interface SlashItemDef {
  id: BlockTypeId | 'ai' | 'image' | 'table' | 'hr' | 'date'
  group: SlashGroup
  // 中文 / 拼音 / 英文别名
  keywords: string[]
}

const SLASH_ITEM_DEFS: SlashItemDef[] = [
  { group: 'ai', id: 'ai', keywords: ['ai', 'write', 'continue', 'bangxie', 'bx', 'xuxie', 'xiezuo', '帮写', '续写', '写作', '生成'] },
  { group: 'basic', id: 'paragraph', keywords: ['text', 'p', 'paragraph', 'zhengwen', 'zw', 'duanluo', '正文', '段落', 'wenben'] },
  { group: 'basic', id: 'h1', keywords: ['h1', 'heading', 'title', 'biaoti', 'bt', 'biaoti1', 'yiji', '标题', '一级', '大标题'] },
  { group: 'basic', id: 'h2', keywords: ['h2', 'heading', 'title', 'biaoti', 'bt', 'biaoti2', 'erji', '标题', '二级'] },
  { group: 'basic', id: 'h3', keywords: ['h3', 'heading', 'title', 'biaoti', 'bt', 'biaoti3', 'sanji', '标题', '三级'] },
  { group: 'basic', id: 'h4', keywords: ['h4', 'heading', 'title', 'biaoti', 'bt', 'biaoti4', 'siji', '标题', '四级', '小标题'] },
  { group: 'basic', id: 'blockquote', keywords: ['quote', 'blockquote', 'yinyong', 'yy', '引用', '>'] },
  { group: 'basic', id: 'codeBlock', keywords: ['code', 'codeblock', 'pre', 'daima', 'dm', 'daimakuai', '代码', '```'] },
  { group: 'list', id: 'bulletList', keywords: ['ul', 'bullet', 'list', 'wuxu', 'wx', 'liebiao', 'lb', '列表', '无序', '-'] },
  { group: 'list', id: 'orderedList', keywords: ['ol', 'ordered', 'number', 'list', 'youxu', 'yx', 'bianhao', 'liebiao', '列表', '有序', '编号'] },
  { group: 'list', id: 'taskList', keywords: ['todo', 'task', 'check', 'renwu', 'rw', 'daiban', 'db', '待办', '任务', '清单', 'liebiao', '列表'] },
  { group: 'media', id: 'image', keywords: ['img', 'image', 'picture', 'photo', 'tupian', 'tp', 'zhaopian', '图片', '照片', '上传'] },
  { group: 'media', id: 'table', keywords: ['table', 'grid', 'biaoge', 'bg', '表格'] },
  { group: 'other', id: 'hr', keywords: ['hr', 'divider', 'line', 'separator', 'fengexian', 'fgx', 'fenge', '分割线', '---'] },
  { group: 'other', id: 'date', keywords: ['date', 'today', 'riqi', 'rq', 'jintian', '日期', '今天'] },
]

/** 内置组件（组件块），排在“其他”之前 */
function buildComponentItems(t: Translate, ct: Translate): SlashCommandItem[] {
  return CONTENT_COMPONENTS.map(def => ({
    id: `component-${def.name}`,
    group: t('slash.group_component'),
    title: ct(`${def.name}.name`),
    hint: ct(`${def.name}.description`),
    icon: def.icon,
    keywords: ['component', 'zujian', 'zj', '组件', ...def.keywords],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertComponentBlock(def.name).run()
    },
  }))
}

/**
 * 生成本地化后的斜杠命令项
 * @param t Console.editor 命名空间的翻译函数
 * @param ct ContentComponents 命名空间的翻译函数（组件名称与说明）
 * @param formatDate 插入“今天的日期”时的格式化函数
 * @param openAI 打开 AI 帮写面板
 */
export function buildSlashItems(t: Translate, ct: Translate, formatDate: (date: Date) => string, openAI: () => void): SlashCommandItem[] {
  const items = SLASH_ITEM_DEFS.map((def): SlashCommandItem => {
    const base = {
      id: def.id,
      group: t(`slash.group_${def.group}`),
      hint: t(`slash.hint_${def.id}`),
      keywords: def.keywords,
    }
    switch (def.id) {
      case 'ai':
        return {
          ...base,
          title: t('ai.write'),
          icon: SparklesIcon,
          // 删除 “/query” 后在当前位置打开 AI 帮写
          run: (editor, range) => {
            editor.chain().focus().deleteRange(range).run()
            openAI()
          },
        }
      case 'table':
        return {
          ...base,
          title: t('insert_table'),
          icon: TableIcon,
          run: (editor, range) => {
            editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          },
        }
      case 'image':
        return {
          ...base,
          title: t('insert_image'),
          icon: ImageIcon,
          // 沿用现有上传流程：插入图片上传块
          run: (editor, range) => {
            editor.chain().focus().deleteRange(range).insertContent({ type: 'imageUpload' }).run()
          },
        }
      case 'hr':
        return {
          ...base,
          title: t('insert_hr'),
          icon: MinusIcon,
          run: (editor, range) => {
            editor.chain().focus().deleteRange(range).setHorizontalRule().run()
          },
        }
      case 'date':
        return {
          ...base,
          title: t('slash.date'),
          icon: CalendarIcon,
          run: (editor, range) => {
            editor.chain().focus().deleteRange(range).insertContent(formatDate(new Date())).run()
          },
        }
      default: {
        const blockId = def.id
        return {
          ...base,
          title: t(`block.${blockId}`),
          icon: getBlockTypeDef(blockId).icon,
          run: (editor, range) => setBlockType(editor, blockId, { prep: chain => chain.deleteRange(range), force: true }),
        }
      }
    }
  })
  const otherIndex = items.findIndex(item => item.id === 'hr')
  items.splice(otherIndex < 0 ? items.length : otherIndex, 0, ...buildComponentItems(t, ct))
  return items
}

/** 按输入过滤：完全匹配 > 前缀匹配 > 包含匹配，保持分组顺序 */
export function filterSlashItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q)
    return items
  const groupOrder = [...new Set(items.map(item => item.group))]
  return items
    .map((item, index) => {
      const words = [item.title.toLowerCase(), ...item.keywords.map(k => k.toLowerCase())]
      let score = -1
      if (words.includes(q))
        score = 0
      else if (words.some(w => w.startsWith(q)))
        score = 1
      else if (words.some(w => w.includes(q)) || item.hint.toLowerCase().includes(q))
        score = 2
      return { item, score, index }
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => groupOrder.indexOf(a.item.group) - groupOrder.indexOf(b.item.group) || a.score - b.score || a.index - b.index)
    .map(entry => entry.item)
}
