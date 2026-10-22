export default function BlogSidebar({ cards }: { cards: React.ReactNode[] }) {
  return (
    <div className="grid gap-4">
      {/* 卡片可能因未配置 / 无内容而不渲染，空容器隐藏以免留下多余间距 */}
      {cards.map((card, idx) => (
        <div key={idx} className="empty:hidden">{card}</div>
      ))}
    </div>
  )
}
