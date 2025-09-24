
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-2 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6 pt-4">
        {children}
      </div>
    </div>
  )
}