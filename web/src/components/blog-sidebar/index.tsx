export default function Sidebar({ cards }: { cards: React.ReactNode[] }) {
  return (
    <div className="lg:col-span-1 space-y-6 self-start">
      {cards.map((card, idx) => (
        <div key={idx}>{card}</div>
      ))}
    </div>
  );
}