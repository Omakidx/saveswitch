"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./AuthExperience.module.css";

type Mode = "login" | "register";
type Theme = "dark" | "light";

const COPY = {
  login: {
    eyebrow: "Welcome back",
    heading: "Save once. Pick up\nanywhere.",
    description:
      "Sign in to keep the links, notes, and snippets that matter within reach on every device.",
    google: "Continue with Google",
    prompt: "New to SaveSwitch?",
    href: "/register",
    link: "Create an account",
  },
  register: {
    eyebrow: "Start with SaveSwitch",
    heading: "Save once. Pick up\nanywhere.",
    description: "Create your workspace and move seamlessly from one screen to the next.",
    google: "Sign up with Google",
    prompt: "Already have an account?",
    href: "/login",
    link: "Sign in",
  },
} as const;

function ProductMark() {
  return (
    <svg className={styles.productMark} aria-hidden="true" viewBox="0 0 48 48" fill="none">
      <path d="M8 12.5c0-2.49 2.01-4.5 4.5-4.5h23c2.49 0 4.5 2.01 4.5 4.5v23c0 2.49-2.01 4.5-4.5 4.5h-23A4.5 4.5 0 0 1 8 35.5v-23Z" />
      <path d="M15 28.25V17.5h18v10.75M18 32.5h12M23 28.25l-2 4.25M25 28.25l2 4.25" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C12.4142 1.25 12.75 1.58579 12.75 2V3C12.75 3.41421 12.4142 3.75 12 3.75C11.5858 3.75 11.25 3.41421 11.25 3V2C11.25 1.58579 11.5858 1.25 12 1.25ZM4.39861 4.39861C4.6915 4.10572 5.16638 4.10572 5.45927 4.39861L5.85211 4.79145C6.145 5.08434 6.145 5.55921 5.85211 5.85211C5.55921 6.145 5.08434 6.145 4.79145 5.85211L4.39861 5.45927C4.10572 5.16638 4.10572 4.6915 4.39861 4.39861ZM19.6011 4.39887C19.894 4.69176 19.894 5.16664 19.6011 5.45953L19.2083 5.85237C18.9154 6.14526 18.4405 6.14526 18.1476 5.85237C17.8547 5.55947 17.8547 5.0846 18.1476 4.79171L18.5405 4.39887C18.8334 4.10598 19.3082 4.10598 19.6011 4.39887ZM12 6.75C9.1005 6.75 6.75 9.1005 6.75 12C6.75 14.8995 9.1005 17.25 12 17.25C14.8995 17.25 17.25 14.8995 17.25 12C17.25 9.1005 14.8995 6.75 12 6.75ZM5.25 12C5.25 8.27208 8.27208 5.25 12 5.25C15.7279 5.25 18.75 8.27208 18.75 12C18.75 15.7279 15.7279 18.75 12 18.75C8.27208 18.75 5.25 15.7279 5.25 12ZM1.25 12C1.25 11.5858 1.58579 11.25 2 11.25H3C3.41421 11.25 3.75 11.5858 3.75 12C3.75 12.4142 3.41421 12.75 3 12.75H2C1.58579 12.75 1.25 12.4142 1.25 12ZM20.25 12C20.25 11.5858 20.5858 11.25 21 11.25H22C22.4142 11.25 22.75 11.5858 22.75 12C22.75 12.4142 22.4142 12.75 22 12.75H21C20.5858 12.75 20.25 12.4142 20.25 12ZM18.1476 18.1476C18.4405 17.8547 18.9154 17.8547 19.2083 18.1476L19.6011 18.5405C19.894 18.8334 19.894 19.3082 19.6011 19.6011C19.3082 19.894 18.8334 19.894 18.5405 19.6011L18.1476 19.2083C17.8547 18.9154 17.8547 18.4405 18.1476 18.1476ZM5.85211 18.1479C6.145 18.4408 6.145 18.9157 5.85211 19.2086L5.45927 19.6014C5.16638 19.8943 4.6915 19.8943 4.39861 19.6014C4.10572 19.3085 4.10572 18.8336 4.39861 18.5407L4.79145 18.1479C5.08434 17.855 5.55921 17.855 5.85211 18.1479ZM12 20.25C12.4142 20.25 12.75 20.5858 12.75 21V22C12.75 22.4142 12.4142 22.75 12 22.75C11.5858 22.75 11.25 22.4142 11.25 22V21C11.25 20.5858 11.5858 20.25 12 20.25Z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M11.0174 2.80157C6.37072 3.29221 2.75 7.22328 2.75 12C2.75 17.1086 6.89137 21.25 12 21.25C16.7767 21.25 20.7078 17.6293 21.1984 12.9826C19.8717 14.6669 17.8126 15.75 15.5 15.75C11.4959 15.75 8.25 12.5041 8.25 8.5C8.25 6.18738 9.33315 4.1283 11.0174 2.80157ZM1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C12.7166 1.25 13.0754 1.82126 13.1368 2.27627C13.196 2.71398 13.0342 3.27065 12.531 3.57467C10.8627 4.5828 9.75 6.41182 9.75 8.5C9.75 11.6756 12.3244 14.25 15.5 14.25C17.5882 14.25 19.4172 13.1373 20.4253 11.469C20.7293 10.9658 21.286 10.804 21.7237 10.8632C22.1787 10.9246 22.75 11.2834 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12Z" fill="currentColor" />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="SaveSwitch home">
      <span className={styles.brandGlyph}>S</span>
      <span>SaveSwitch</span>
    </Link>
  );
}

function getStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem("saveswitch-auth-theme");
    if (stored === "light" || stored === "dark") return stored;

    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function AuthExperience({
  mode,
  hasOAuthError,
}: {
  mode: Mode;
  hasOAuthError: boolean;
}) {
  const content = COPY[mode];
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setTheme(getStoredTheme()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);

    try {
      window.localStorage.setItem("saveswitch-auth-theme", nextTheme);
    } catch {
      // The visible setting remains usable when storage is restricted.
    }
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <main className={styles.page} data-theme={theme}>
      <section className={styles.story} aria-label="About SaveSwitch">
        <div className={styles.storyHeader}>
          <Brand />
          <span className={styles.sync}><i />Synced</span>
        </div>
        <div className={styles.storyBody}>
          <p className={styles.kicker}>A quieter way to move between devices</p>
          <h2>Keep the good stuff in motion.</h2>
          <p>Save a thought on one screen. Pick it up on the next. Your personal workspace follows your flow.</p>
          <div className={styles.deviceScene} aria-hidden="true">
            <div className={styles.desktop}>
              <div className={styles.browserDots}><i /><i /><i /></div>
              <div className={styles.desktopBody}><span /><b /><b /><b /></div>
            </div>
            <div className={styles.transfer}><span>Copy</span><b>→</b><span>Paste</span></div>
            <div className={styles.phone}><i /><ProductMark /><div><span /><span /><span /></div></div>
          </div>
        </div>
        <p className={styles.storyFooter}>For the tabs, texts, and tiny ideas you want to keep.</p>
      </section>

      <section className={styles.action} aria-labelledby="auth-heading">
        <header className={styles.mobileHeader}><Brand /></header>
        <button
          type="button"
          className={styles.theme}
          onClick={toggleTheme}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          <ThemeIcon theme={theme} />
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>

        <div className={styles.card}>
          <div className={styles.cardMark} aria-hidden="true"><ProductMark /></div>
          <p className={styles.kicker}>{content.eyebrow}</p>
          <h1 id="auth-heading">{content.heading}</h1>
          <p className={styles.description}>{content.description}</p>
          {hasOAuthError ? (
            <div className={styles.error} role="alert">
              <strong>We couldn&apos;t complete your Google sign-in.</strong>
              <span>Please try again, or choose Xoomshare to continue without an account.</span>
            </div>
          ) : null}
          <div className={styles.actions}>
            <a className={`${styles.button} ${styles.google}`} href={`${API_BASE}/auth/google`}>
              <Image src="/images/login/google-icon.svg" alt="" width={18} height={18} aria-hidden="true" />
              <span>{content.google}</span>
              <Arrow />
            </a>
            <Link className={`${styles.button} ${styles.xoomshare}`} href="/xoomshare">
              <Image src="/images/login/cloud-lightning.svg" alt="" width={19} height={19} aria-hidden="true" />
              <span>Open Xoomshare</span>
              <Arrow />
            </Link>
          </div>
          <p className={styles.crosslink}>
            {content.prompt} <Link href={content.href}>{content.link}</Link>
          </p>
        </div>
        <p className={styles.note}>By continuing, you agree to use SaveSwitch responsibly.</p>
      </section>
    </main>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
    </svg>
  );
}
