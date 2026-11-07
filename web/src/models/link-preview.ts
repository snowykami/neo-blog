// 外链预览：由 /api/get-link-info 抓取网页元信息生成
export interface LinkPreview {
  /** 网页标题；取不到时为空，由前端显示域名 */
  title: string
  description: string
  image?: string
  favicon?: string
  /** 请求预览时的原始地址 */
  url: string
  siteName?: string
}
