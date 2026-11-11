import { describe, expect, it, vi } from 'vitest'
import { entranceContinueScript, installEntranceContinue } from './entrance-continue'

function shell(kind: 'skeleton' | 'page') {
  const el = document.createElement('div')
  el.setAttribute('data-site-shell', kind)
  const content = document.createElement('div')
  content.className = 'enter-fade-up enter-delay-150'
  el.append(content)
  return { el, content }
}

function fakeAnimation() {
  return { currentTime: 0 as number | null, finish: vi.fn() }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('installEntranceContinue', () => {
  installEntranceContinue(document)

  it('骨架换成正文时，正文的入场动画从骨架播到的进度接着播', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const skeleton = shell('skeleton')
    document.body.append(skeleton.el)
    await flush()
    now.mockReturnValue(1120)
    const page = shell('page')
    const animation = fakeAnimation()
    page.content.getAnimations = () => [animation as unknown as Animation]
    skeleton.el.replaceWith(page.el)
    await flush()
    expect(animation.currentTime).toBe(120)
    expect(animation.finish).not.toHaveBeenCalled()
    now.mockRestore()
    page.el.remove()
  })

  it('没有骨架被换下时（普通跳转）正文照常从头播', async () => {
    const page = shell('page')
    const animation = fakeAnimation()
    page.content.getAnimations = () => [animation as unknown as Animation]
    document.body.append(page.el)
    await flush()
    expect(animation.currentTime).toBe(0)
    expect(animation.finish).not.toHaveBeenCalled()
    page.el.remove()
  })

  it('内联脚本可以解析', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(entranceContinueScript)).not.toThrow()
  })
})
