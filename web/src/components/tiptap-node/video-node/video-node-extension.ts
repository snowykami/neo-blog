import { mergeAttributes, Node, ReactNodeViewRenderer } from '@tiptap/react'
import { parseMediaWidthPreset } from '../media-width'
import { VIDEO_CAPTION_ATTR, VIDEO_FIGURE_CLASS } from './video-node-constants'
import { VideoNodeView } from './video-node-view'

export interface VideoOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string, poster?: string }) => ReturnType
    }
  }
}

/**
 * 正文视频：整块节点，浏览器原生播放器（controls + playsinline），与图片一样支持对齐、宽度预设与注释。
 * 存储结构与图片一致：有注释时为 <figure class="video-figure"><video/><figcaption/></figure>，
 * 无注释时就是 <video>；宽度预设写在 data-width（占正文宽度百分比，见 media-width.ts）。
 * 播放器本身不接管点击，播放 / 暂停交给浏览器，节点操作走右键菜单（见 editor-context-menu.tsx）。
 */
export const Video = Node.create<VideoOptions>({
  name: 'video',

  group: 'block',

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      // 只用原生控件播放，不放自动播放；preload=metadata 只取时长与首帧
      HTMLAttributes: {
        controls: '',
        playsinline: '',
        preload: 'metadata',
      },
    }
  },

  addAttributes() {
    return {
      'src': {
        default: null,
      },
      // 封面图：不填时浏览器显示首帧
      'poster': {
        default: null,
      },
      'data-align': {
        default: null,
      },
      'data-width': {
        default: null,
        parseHTML: element => parseMediaWidthPreset(element.getAttribute('data-width')),
      },
      'caption': {
        default: null,
        parseHTML: element => element.querySelector('figcaption')?.textContent?.trim() || null,
        // 注释渲染为 figcaption，不作为 video 属性输出
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: `figure.${VIDEO_FIGURE_CLASS}`,
        getAttrs: (element) => {
          const video = element.querySelector('video[src]')
          if (!video)
            return false
          return {
            'src': video.getAttribute('src'),
            'poster': video.getAttribute('poster'),
            'data-align': element.getAttribute('data-align') || video.getAttribute('data-align'),
            'data-width': parseMediaWidthPreset(element.getAttribute('data-width') || video.getAttribute('data-width')),
          }
        },
      },
      {
        tag: 'video[src]',
        getAttrs: element => ({
          'src': element.getAttribute('src'),
          'poster': element.getAttribute('poster'),
          'data-align': element.getAttribute('data-align'),
          'data-width': parseMediaWidthPreset(element.getAttribute('data-width')),
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const video = ['video', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)] as const
    const caption = node.attrs.caption as string | null
    if (!caption)
      return video
    return [
      'figure',
      { 'class': VIDEO_FIGURE_CLASS, 'data-align': node.attrs['data-align'], 'data-width': node.attrs['data-width'] },
      video,
      ['figcaption', {}, caption],
    ]
  },

  addCommands() {
    return {
      setVideo:
        options =>
          ({ commands }) => commands.insertContent({ type: this.name, attrs: options }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView, {
      stopEvent: (props) => {
        const target = props.event.target as Element | null
        // 注释输入框内的事件交给输入框自己处理，避免被编辑器当作节点选择 / 删除
        if (target?.closest?.(`[${VIDEO_CAPTION_ATTR}]`))
          return true
        // 播放器的点击（播放 / 暂停 / 拖动进度）交给浏览器，否则原生控件收不到事件
        if (target?.closest?.('video'))
          return true
        if (/dragstart|dragover|dragend|drop/.test(props.event.type))
          return false
        return !/mousedown|drag|drop/.test(props.event.type)
      },
    })
  },
})

export default Video
