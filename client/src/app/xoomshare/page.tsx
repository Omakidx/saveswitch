"use client";

import Image from "next/image";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { API_BASE } from "@/lib/api";

export default function CreateXoomsharePage() {
  const router = useRouter();
  const [pathCode, setPathCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setCreating(true);

    try {
      const res = await fetch(`${API_BASE}/xoomshare`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathCode: pathCode.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Unable to create Xoomshare page");
        return;
      }

      router.push(`/${encodeURIComponent(data.room.pathCode)}`);
    } catch {
      setError("Network error while creating Xoomshare page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-dvh w-full bg-black font-inter text-white">
      <Link
        href="/login"
        className="absolute left-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
        aria-label="Back to login"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <div className="flex min-h-dvh items-center justify-center px-6 py-8">
        <form onSubmit={handleCreate} className="flex w-full max-w-[320px] flex-col items-center">
          <label
            htmlFor="xoomshare-code"
            className="mb-8 w-full max-w-[280px] text-center text-[13px] font-bold leading-[18px] text-white"
          >
            Create your unique page destination path for your resources
          </label>

          <div className="flex w-full items-end gap-2 border-b border-white/70 focus-within:border-white transition-colors pb-1">
            <input
              id="xoomshare-code"
              value={pathCode}
              onChange={(event) => setPathCode(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="My Secret Page For Videos I Found Online"
              className="h-10 min-w-0 flex-1 border-none bg-transparent px-0 text-center text-[11px] font-medium leading-none text-white !outline-none focus:!border-none focus:!outline-none focus:!ring-0 placeholder:text-[#5d5d5d]"
              style={{ boxShadow: 'none', border: 'none', outline: 'none' }}
              aria-label="Secret page code"
            />
            <button
              type="submit"
              disabled={creating || !pathCode.trim()}
              className="flex h-10 w-8 shrink-0 items-center justify-center border-none bg-transparent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Create Xoomshare page"
            >
              <Image src="/images/lock-icon.svg" alt="Lock" width={14} height={18} />
            </button>
          </div>

          <div className="w-full text-right mt-6">
            <p className="text-[11.375px] font-medium text-white">
              NOTE: Case Sensitive
            </p>
          </div>

          {error && (
            <p className="mt-5 w-full text-center text-[12px] font-medium leading-[16px] text-red-300">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
