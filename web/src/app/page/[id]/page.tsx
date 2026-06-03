import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPageById } from '@/api/page'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const page = await getPageById({ id }).then(res => res.data).catch(() => null)
  if (!page)
    return {}
  return {
    title: page.title,
    description: page.description,
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const page = await getPageById({ id }).then(res => res.data).catch(() => null)
  if (!page)
    notFound()

  return (
    <article className="py-10">
      <div className="prose dark:prose-invert max-w-3xl mx-auto">
        <h1>{page.title}</h1>
        {page.description && <p className="lead">{page.description}</p>}
        <div dangerouslySetInnerHTML={{ __html: page.content }} />
      </div>
    </article>
  )
}
