import { Navbar } from "@/components/Navbar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="flex justify-center">
        <Navbar />
      </header>
      <main>
        {children}
      </main>
    </>
  );
}
