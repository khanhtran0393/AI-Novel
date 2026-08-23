export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black font-sans text-zinc-300" suppressHydrationWarning>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-wide text-zinc-100">Nova Studio Runtime</h1>
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          GUI chính của app hiện chạy qua Electron runtime nội bộ (<code className="text-amber-400">nova/</code>) —
          không qua Next.js server này nữa.
        </p>
        <p className="text-sm text-zinc-500">
          Khởi động app: <code className="text-amber-400">Khoi_Dong_App.bat</code> hoặc{' '}
          <code className="text-amber-400">Khoi_Dong_App_Silent.vbs</code>
        </p>
      </div>
    </div>
  );
}
