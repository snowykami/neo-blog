import type { Metadata } from 'next'
import type { ArchiveGroup } from './archive'
import type { Post } from '@/models/post'
import process from 'node:process'
import { getTranslations } from 'next-intl/server'
import { listPostsServer } from '@/api/post.server'
import { OrderBy } from '@/models/common'
import { getPostUrl } from '@/utils/common/route'
import { Archive } from './archive'

// 归档日期按站点时区计算，与后端容器的 TZ 保持一致；在服务端算好再传给客户端，避免水合时因时区不同而错位
const ARCHIVE_TIME_ZONE = process.env.TZ || 'Asia/Chongqing'

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('archive') }
}

function getDateParts(date: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ARCHIVE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(date))
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { year: Number(get('year')), monthDay: `${get('month')}-${get('day')}` }
}

// 按年份分组，年份倒序，组内保持接口返回的时间倒序
function groupByYear(posts: Post[]): ArchiveGroup[] {
  const groups: ArchiveGroup[] = []
  for (const post of posts) {
    const { year, monthDay } = getDateParts(post.createdAt)
    let group = groups.find(item => item.year === year)
    if (!group) {
      group = { year, posts: [] }
      groups.push(group)
    }
    group.posts.push({
      id: post.id,
      title: post.title,
      url: getPostUrl({ post }),
      date: monthDay,
      labels: (post.labels || []).map(label => label.name),
    })
  }
  return groups.sort((a, b) => b.year - a.year)
}

export default async function ArchivesPage({
  searchParams,
}: {
  searchParams: Promise<{ label?: string, category?: string }>
}) {
  // 支持 ?label=xxx / ?category=xxx 只看某个标签或分类的归档
  const { label = '', category = '' } = await searchParams
  const posts = await listPostsServer({ page: 1, size: 500, orderBy: OrderBy.CreatedAt, desc: true, noContent: true, label, category })
    .then(res => res.data.posts)
    .catch(() => [])

  return <Archive groups={groupByYear(posts)} filter={{ label, category }} />
}
