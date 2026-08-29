"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./XoomshareEntry.module.css";

export default function CreateXoomsharePage() {
  const router = useRouter();
  const [pathCode, setPathCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const normalizedPathCode = pathCode.trim();
  const hasValidPathCode = /^[A-Za-z0-9_-]{12,48}$/.test(normalizedPathCode);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!hasValidPathCode) {
      setError("Use 12–48 letters, numbers, hyphens, or underscores.");
      return;
    }
    setCreating(true);

    try {
      const res = await fetch(`${API_BASE}/xoomshare`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathCode: normalizedPathCode }),
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
          <p className="mt-2 max-w-[320px] text-[13px] leading-5 text-[#68685d]">Choose a private, case-sensitive address for a live resource canvas.</p>
          <label htmlFor="xoomshare-code" className="mt-7 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#6f6e61]">Room address</label>
          <div className={`${styles.input} mt-2 flex w-full items-center gap-2 pb-2 transition-colors`}>
            <input
              id="xoomshare-code"
              value={pathCode}
              onChange={(event) => setPathCode(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              minLength={12}
              maxLength={48}
              pattern="[A-Za-z0-9_-]{12,48}"
              title="Use 12–48 letters, numbers, hyphens, or underscores."
              placeholder="e.g. team_references"
              className="h-10 min-w-0 flex-1 border-none bg-transparent px-0 text-[14px] font-medium leading-none text-[#35362f] !outline-none focus:!border-none focus:!outline-none focus:!ring-0 placeholder:text-[#949385]"
              style={{ boxShadow: 'none', border: 'none', outline: 'none' }}
              aria-label="Secret page code"
            />
            <button
              type="submit"
              disabled={creating || !hasValidPathCode}
              className={`${styles.submit} flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
              aria-label="Create Xoomshare page"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>
          <p className="mt-3 text-[11px] text-[#7c7b6e]">12–48 letters, numbers, hyphens, or underscores · case sensitive · expires after three hours.</p>

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
