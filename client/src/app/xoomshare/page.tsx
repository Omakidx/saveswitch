"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./XoomshareEntry.module.css";

export default function CreateXoomsharePage() {
  const router = useRouter();
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
        body: JSON.stringify({}),
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
    <main className={`${styles.page} relative w-full font-inter`}>
      <Link
        href="/dashboard"
        className={`${styles.back} absolute left-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-[#35362f] transition-colors focus:outline-none focus:ring-2 focus:ring-[#176bff] focus:ring-offset-2 sm:left-7 sm:top-7`}
        aria-label="Back to dashboard"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <div className="flex min-h-dvh items-center justify-center px-5 py-8">
        <form onSubmit={handleCreate} className={`${styles.card} flex w-full max-w-[420px] flex-col rounded-[26px] p-6 sm:p-8`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#79796b]">Saveswitch</p>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.035em] text-[#34352e]">Create a Xoomshare room</h1>
          <p className="mt-2 max-w-[320px] text-[13px] leading-5 text-[#68685d]">Create a private live resource canvas. Saveswitch generates a secure, unguessable room address for you to share.</p>
          <div className="mt-7 flex w-full items-center justify-between gap-4 rounded-2xl bg-white/45 px-4 py-3">
            <p className="text-[12px] leading-5 text-[#68685d]">The room expires after three hours.</p>
            <button
              type="submit"
              disabled={creating}
              className={`${styles.submit} flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
              aria-label="Create Xoomshare page"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>

          {error && (
            <p className="mt-5 w-full text-[12px] font-medium leading-[16px] text-[#d12a2a]" role="alert">
              {error}
            </p>
          )}
          <Link href="/xoomshare/join" className="mt-7 text-[12px] font-medium text-[#4f5046] underline decoration-[#a6a593] underline-offset-4 hover:text-[#176bff]">Join an existing room</Link>
        </form>
      </div>
    </main>
  );
}
