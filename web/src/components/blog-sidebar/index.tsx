export default function BlogSidebar({ cards }: { cards: React.ReactNode[] }) {
  return (
    <div className="grid gap-4">
      {cards.map((card, idx) => (
        <div key={idx}>{card}</div>
      ))}
    </div>
  )
}
