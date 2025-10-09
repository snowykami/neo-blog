import type { Metadata } from 'next'

export function generateMetadata(): Metadata {
  return { title: 'Archive' }
}

export default function ArchivesPage() {
  return (
    <div>
      <h1>归档</h1>
      <p>这里是博客文章的归档页面。</p>
    </div>
  )
}
