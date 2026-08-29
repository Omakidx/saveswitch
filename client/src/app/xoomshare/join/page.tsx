"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import styles from "../XoomshareEntry.module.css";

export default function JoinXoomsharePage() {
  const router = useRouter();
  const [pathCode, setPathCode] = useState("");
  const [error, setError] = useState("");

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = pathCode.trim();
    if (!trimmedCode) {
      setError("Enter a secret page code");
      return;
    }

    router.push(`/${encodeURIComponent(trimmedCode)}`);
  };

  return (
    <main className={`${styles.page} relative w-full font-inter`}>
      <Link
        href="/xoomshare"
        className={`${styles.back} absolute left-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-[#35362f] transition-colors focus:outline-none focus:ring-2 focus:ring-[#176bff] focus:ring-offset-2 sm:left-7 sm:top-7`}
        aria-label="Back to create Xoomshare"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <div className="flex min-h-dvh items-center justify-center px-5 py-8">
        <form onSubmit={handleJoin} className={`${styles.card} flex w-full max-w-[420px] flex-col rounded-[26px] p-6 sm:p-8`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#79796b]">Saveswitch</p>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.035em] text-[#34352e]">Join a Xoomshare room</h1>
          <p className="mt-2 text-[13px] leading-5 text-[#68685d]">Enter the exact room address shared with you to open its live canvas.</p>
          <label htmlFor="xoomshare-join-code" className="mt-7 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#6f6e61]">Room address</label>
          <div className={`${styles.input} mt-2 flex w-full items-center gap-3 pb-2`}>
            <input
              id="xoomshare-join-code"
              value={pathCode}
              onChange={(event) => {
                setPathCode(event.target.value);
                setError("");
              }}
              autoFocus
              spellCheck={false}
              placeholder="Paste a room address"
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[14px] font-medium leading-none text-[#35362f] outline-none placeholder:text-[#949385]"
              aria-label="Secret page code"
            />
            <button
              type="submit"
              className={`${styles.submit} flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80`}
              aria-label="Join Xoomshare page"
            >
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4.75 7V5.4a3.25 3.25 0 0 1 6.5 0V7M3.75 7h8.5v6.25h-8.5V7Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <p className="mt-3 text-[11px] text-[#7c7b6e]">Room addresses are case sensitive.</p>

          {error && (
            <p className="mt-5 w-full text-[12px] font-medium leading-[16px] text-[#d12a2a]" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
