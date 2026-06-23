export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-950 font-sans text-white h-screen w-full">
      <main className="flex flex-col items-center justify-center gap-6">
        <div className="text-center">
          <h1 className="text-5xl font-bold mb-4 tracking-tight">
            Save<span className="text-indigo-500">switch</span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-md">
            Cross-device clipboard sharing — powered by Bun & Next.js.
          </p>
        </div>
      </main>
    </div>
  );
}
