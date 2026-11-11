import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOCALE_DATA } from '.'

type Messages = Record<string, unknown>

// ICU 语法树里用到的部分（完整类型在 @formatjs/icu-messageformat-parser，它不是本项目的直接依赖）
interface MessageElement {
  type: number
  value?: string
  children?: MessageElement[]
  options?: Record<string, { value: MessageElement[] }>
}

interface IcuParser {
  parse: (message: string) => MessageElement[]
  TYPE: { literal: number, pound: number, tag: number }
}

// 用 next-intl 运行时同一份 ICU 解析器（next-intl → use-intl → intl-messageformat → @formatjs/icu-messageformat-parser），
// 解析结果与界面实际渲染一致，单引号转义、富文本标签、plural / select 都按真实规则处理
async function loadParser(): Promise<IcuParser> {
  let require = createRequire(import.meta.url)
  for (const pkg of ['next-intl', 'use-intl', 'intl-messageformat'])
    require = createRequire(require.resolve(pkg))
  return await import(require.resolve('@formatjs/icu-messageformat-parser')) as IcuParser
}

function flatten(messages: Messages, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object')
      flatten(value as Messages, path).forEach((v, k) => out.set(k, v))
    else
      out.set(path, String(value))
  }
  return out
}

interface MessageShape {
  /** 参数名与富文本标签（标签记为 <name>），含 plural / select 各分支里的参数 */
  args: string[]
  /** 被单引号转义成普通文字的花括号片段，如 '{title}' 渲染出来就是字面的 {title} */
  escaped: string[]
}

describe('各语言文案的 ICU 占位符与 zh 一致', () => {
  let parser: IcuParser
  beforeAll(async () => {
    parser = await loadParser()
  })

  function shape(message: string): MessageShape {
    const args = new Set<string>()
    const escaped: string[] = []
    const walk = (elements: MessageElement[]) => {
      for (const element of elements) {
        if (element.type === parser.TYPE.literal) {
          escaped.push(...(element.value ?? '').match(/\{[^{}]*\}/g) ?? [])
        }
        else if (element.type === parser.TYPE.tag) {
          args.add(`<${element.value}>`)
          walk(element.children ?? [])
        }
        else if (element.type !== parser.TYPE.pound) {
          args.add(element.value ?? '')
          Object.values(element.options ?? {}).forEach(option => walk(option.value))
        }
      }
    }
    walk(parser.parse(message))
    return { args: [...args].sort(), escaped: escaped.sort() }
  }

  const base = flatten(LOCALE_DATA['zh-CN'])

  it.each(Object.keys(LOCALE_DATA))('%s', (code) => {
    const problems: string[] = []
    for (const [key, message] of flatten(LOCALE_DATA[code])) {
      const reference = base.get(key)
      if (reference === undefined) {
        problems.push(`${key}：zh 中没有这个 key`)
        continue
      }
      let actual: MessageShape
      try {
        actual = shape(message)
      }
      catch (error) {
        problems.push(`${key}：ICU 语法错误 ${(error as Error).message}`)
        continue
      }
      const expected = shape(reference)
      if (actual.args.join() !== expected.args.join())
        problems.push(`${key}：参数 [${actual.args.join(', ')}]，zh 为 [${expected.args.join(', ')}]`)
      // zh 本身有意写成字面花括号的（如说明里展示的 '{song_id}'）其他语言保持一致即可；多出来的说明占位符被单引号转义掉了
      if (actual.escaped.join() !== expected.escaped.join())
        problems.push(`${key}：被单引号转义成普通文字的花括号 [${actual.escaped.join(', ')}]，zh 为 [${expected.escaped.join(', ')}]（ICU 里 '{x}' 不是占位符，引号请用 ‘’ 或 “”）`)
    }
    expect(problems).toEqual([])
  })
})
