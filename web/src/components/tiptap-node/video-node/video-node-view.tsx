import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useCompositionInput } from '@/hooks/use-composition-input'
import { MEDIA_WIDTH_PERCENT, parseMediaWidthPreset } from '../media-width'
import { VIDEO_CAPTION_ATTR } from './video-node-constants'
import './video-node-view.scss'

/**
 * 视频节点视图：原生播放器 + 悬停 / 选中时出现的注释输入框。
 * 播放器自己处理点击（播放、暂停、拖动进度），节点的对齐与宽度通过右键菜单修改。
 */
export function VideoNodeView({ editor, node, selected, updateAttributes }: NodeViewProps) {
  const t = useTranslations('Console.post_edit')
  const [hovered, setHovered] = useState(false)
  // 记录加载失败的地址，换掉地址后自动恢复显示
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = String(node.attrs.src ?? '')
  const poster = node.attrs.poster as string | null
  const caption = node.attrs.caption as string | null
  const align = (node.attrs['data-align'] as string | null) ?? 'center'
  const widthPreset = parseMediaWidthPreset(node.attrs['data-width'])
  const editable = editor.isEditable
  // 与图片一致：悬停、选中或已有注释时显示注释输入框
  const showUi = editable && (hovered || selected || Boolean(caption))
  // 注释写回节点属性要等 NodeView 下一次渲染，直接受控会打断输入法组字，交给 useCompositionInput 处理
  const captionInput = useCompositionInput(caption ?? '', next => updateAttributes({ caption: next || null }))

  return (
    <NodeViewWrapper
      className="tiptap-video"
      data-align={align}
      data-width-preset={widthPreset ?? undefined}
      contentEditable={false}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        className="tiptap-video-container"
        style={{ width: widthPreset ? MEDIA_WIDTH_PERCENT[widthPreset] : '100%' }}
      >
        {failedSrc === src
          ? (
              // 播放不了的地址（404、浏览器不支持的编码）直接显示地址，方便作者排查
              <div className="tiptap-video-fallback" title={src}>
                <span className="max-w-full truncate px-3 text-xs">{src}</span>
              </div>
            )
          : (
              <video
                src={src}
                poster={poster ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="tiptap-video-media"
                draggable={false}
                onError={() => setFailedSrc(src)}
              />
            )}

        {editable
          ? showUi && (
            <input
              {...{ [VIDEO_CAPTION_ATTR]: '' }}
              {...captionInput}
              className="tiptap-video-caption"
              placeholder={t('video_caption_placeholder')}
            />
          )
          : caption && <div className="tiptap-video-caption">{caption}</div>}
      </div>
    </NodeViewWrapper>
  )
}
