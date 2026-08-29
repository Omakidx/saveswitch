"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import styles from "./ProfilePage.module.css";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROFILE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type Notice = { tone: "success" | "error"; message: string } | null;

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  username: string | null;
}

function normaliseUsername(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function validateUsername(value: string) {
  if (value.length < 3 || value.length > 20) {
    return "Username must be between 3 and 20 characters.";
  }

  if (!/^[a-z0-9_]+$/.test(value)) {
    return "Only lowercase letters, numbers, and underscores.";
  }

  return null;
}

function profileGradient(seed: string) {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) {
    value = (value << 5) - value + seed.charCodeAt(index);
    value |= 0;
  }

  const hue = Math.abs(value) % 360;
  return {
    background: `radial-gradient(circle at 25% 25%, hsl(${hue} 88% 76%), transparent 42%), radial-gradient(circle at 76% 72%, hsl(${(hue + 98) % 360} 78% 67%), transparent 48%), linear-gradient(135deg, hsl(${(hue + 36) % 360} 74% 70%), hsl(${(hue + 172) % 360} 68% 62%))`,
  };
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5 7.5 12l7 7" /></svg>;
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5h3l1.25-2h6.5l1.25 2h3A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5V10a1.5 1.5 0 0 1 1.5-1.5Z" /><circle cx="12" cy="13" r="3.25" /></svg>;
}

function LogOutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" /><path d="m14 8 4 4-4 4M18 12H9" /></svg>;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameMessage, setUsernameMessage] = useState("");
  const [picture, setPicture] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const usernameAbortRef = useRef<AbortController | null>(null);
  const usernameRequestRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((nextNotice: Exclude<Notice, null>) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(nextNotice);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const loadUser = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        credentials: "include",
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Unable to load your profile right now.");
      const data = await response.json();

      if (!data.authenticated || !data.user) {
        router.replace("/login");
        return;
      }

      const nextUser = data.user as User;
      setUser(nextUser);
      setName(nextUser.name ?? "");
      setPicture(nextUser.picture ?? "");
      const nextUsername = normaliseUsername(nextUser.username);
      setUsername(nextUsername);
      setOriginalUsername(nextUsername);
      setUsernameStatus("idle");
      setUsernameMessage("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "Unable to load your profile right now.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void loadUser();
    }, 0);
    return () => {
      clearTimeout(initialLoad);
      loadAbortRef.current?.abort();
      usernameAbortRef.current?.abort();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [loadUser]);

  useEffect(() => {
    const normalised = normaliseUsername(username);
    const original = normaliseUsername(originalUsername);
    usernameAbortRef.current?.abort();
    usernameRequestRef.current += 1;
    const requestId = usernameRequestRef.current;

    if (!normalised || normalised === original) {
      const resetStatus = setTimeout(() => {
        if (requestId !== usernameRequestRef.current) return;
        setUsernameStatus("idle");
        setUsernameMessage("");
      }, 0);
      return () => clearTimeout(resetStatus);
    }

    const validationError = validateUsername(normalised);
    if (validationError) {
      const setInvalidStatus = setTimeout(() => {
        if (requestId !== usernameRequestRef.current) return;
        setUsernameStatus("invalid");
        setUsernameMessage(validationError);
      }, 0);
      return () => clearTimeout(setInvalidStatus);
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setUsernameStatus("checking");
      setUsernameMessage("Checking availability…");
      try {
        const response = await fetch(`${API_BASE}/users/check-username?username=${encodeURIComponent(normalised)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const data = await response.json();
        if (requestId !== usernameRequestRef.current) return;

        if (data.available) {
          setUsernameStatus("available");
          setUsernameMessage("Username is available.");
        } else {
          setUsernameStatus("taken");
          setUsernameMessage(data.error || "Username is already taken.");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestId !== usernameRequestRef.current) return;
        setUsernameStatus("idle");
        setUsernameMessage("Couldn’t check availability. Try again before saving.");
      }
    }, 420);

    usernameAbortRef.current = controller;
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [username, originalUsername]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_PROFILE_IMAGE_TYPES.has(file.type)) {
      showNotice({ tone: "error", message: "Please choose a PNG, JPG, WebP, or GIF image." });
      event.target.value = "";
      return;
    }

    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      showNotice({ tone: "error", message: "Please choose an image smaller than 5MB." });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setPicture(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => showNotice({ tone: "error", message: "That image could not be read. Please try another file." });
    reader.readAsDataURL(file);
  };

  const currentUsername = normaliseUsername(username);
  const originalNormalisedUsername = normaliseUsername(originalUsername);
  const usernameChanged = currentUsername !== originalNormalisedUsername;
  const usernameValidationError = currentUsername ? validateUsername(currentUsername) : null;
  const nameIsValid = Boolean(name.trim());
  const usernameReady = !usernameChanged || (!usernameValidationError && usernameStatus === "available");
  const hasChanges = Boolean(user) && (
    name.trim() !== user?.name ||
    picture !== user?.picture ||
    usernameChanged
  );

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    if (!nameIsValid) {
      showNotice({ tone: "error", message: "Display name is required." });
      return;
    }

    if (usernameChanged && !currentUsername) {
      setUsernameStatus("invalid");
      setUsernameMessage("A username can’t be cleared once set.");
      return;
    }

    if (usernameValidationError || !usernameReady) {
      setUsernameStatus(usernameValidationError ? "invalid" : usernameStatus);
      setUsernameMessage(usernameValidationError ?? "Finish checking username availability before saving.");
      return;
    }

    const body: { name: string; picture?: string; username?: string } = { name: name.trim() };
    if (picture !== user.picture) body.picture = picture;
    if (usernameChanged && currentUsername) body.username = currentUsername;

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok || !data.success || !data.user) {
        throw new Error(data.error || "Failed to save profile.");
      }

      const canonicalUser = data.user as User;
      setUser(canonicalUser);
      setName(canonicalUser.name ?? "");
      setPicture(canonicalUser.picture ?? "");
      const canonicalUsername = normaliseUsername(canonicalUser.username);
      setUsername(canonicalUsername);
      setOriginalUsername(canonicalUsername);
      setUsernameStatus("idle");
      setUsernameMessage("");
      showNotice({ tone: "success", message: "Profile saved." });
      router.refresh();
    } catch (error) {
      showNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to save profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const response = await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Couldn’t sign out right now.");
      router.replace("/login");
      router.refresh();
    } catch (error) {
      showNotice({ tone: "error", message: error instanceof Error ? error.message : "Couldn’t sign out right now." });
      setSigningOut(false);
    }
  };

  const fallbackGradient = useMemo(() => profileGradient(user?.id || user?.email || "saveswitch"), [user?.email, user?.id]);

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <div className={styles.loadingCard} role="status">
          <span className={styles.loadingBall} aria-hidden="true" />
          <span>Loading your profile</span>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className={styles.page}>
        <section className={styles.errorCard} role="alert">
          <p className={styles.eyebrow}>PROFILE</p>
          <h1>We couldn’t open your profile.</h1>
          <p>{loadError}</p>
          <div className={styles.errorActions}>
            <button type="button" className={styles.primaryButton} onClick={() => void loadUser()}>Try again</button>
            <button type="button" className={styles.quietButton} onClick={() => router.push("/dashboard")}>Back to dashboard</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.orbOne} aria-hidden="true" />
      <div className={styles.orbTwo} aria-hidden="true" />
      <section className={styles.shell} aria-labelledby="profile-title">
        <header className={styles.header}>
          <button type="button" className={styles.backButton} onClick={() => router.push("/dashboard")}>
            <BackIcon />
            <span>Dashboard</span>
          </button>
          <button type="button" className={styles.signOutButton} onClick={() => void handleSignOut()} disabled={signingOut}>
            <LogOutIcon />
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </header>

        {notice && <div className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeSuccess}`} role="status">{notice.message}</div>}

        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>YOUR SPACE</p>
          <h1 id="profile-title">Profile settings</h1>
          <p>Keep the identity that travels with your saved spaces.</p>
        </div>

        <form className={styles.profileGrid} onSubmit={handleSave}>
          <section className={styles.identityCard} aria-labelledby="identity-heading">
            <div className={styles.cardHeading}>
              <p className={styles.eyebrow}>IDENTITY</p>
              <h2 id="identity-heading">Your presence</h2>
            </div>
            <div className={styles.avatarBlock}>
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Change profile picture"
              >
                <span className={styles.avatar} style={!picture ? fallbackGradient : undefined}>
                  {picture ? (
                    // The selected image can be a local data URL, which Next Image does not support.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picture} alt="Your profile" />
                  ) : <span aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "S"}</span>}
                </span>
                <span className={styles.cameraBadge}><CameraIcon /></span>
              </button>
              <div>
                <p className={styles.avatarTitle}>Profile image</p>
                <p className={styles.avatarHelp}>PNG, JPG, WebP, or GIF. Up to 5 MB.</p>
                <button type="button" className={styles.changePhoto} onClick={() => fileInputRef.current?.click()}>Choose image</button>
              </div>
              <input
                id="profile-picture"
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileChange}
              />
            </div>
          </section>

          <section className={styles.formCard} aria-labelledby="details-heading">
            <div className={styles.cardHeading}>
              <p className={styles.eyebrow}>ACCOUNT</p>
              <h2 id="details-heading">Personal details</h2>
            </div>

            <label className={styles.field} htmlFor="display-name">
              <span>Display name</span>
              <input
                id="display-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                maxLength={120}
                required
              />
            </label>

            <label className={styles.field} htmlFor="username">
              <span>Username <em>optional until you choose one</em></span>
              <div className={styles.inputWithStatus}>
                <input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. duck_se00"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  minLength={3}
                  maxLength={20}
                  aria-invalid={usernameStatus === "taken" || usernameStatus === "invalid"}
                  aria-describedby={usernameMessage ? "username-status" : undefined}
                  className={usernameStatus === "taken" || usernameStatus === "invalid" ? styles.inputInvalid : usernameStatus === "available" ? styles.inputAvailable : undefined}
                />
                {usernameStatus === "checking" && <span className={styles.fieldSpinner} aria-label="Checking username" />}
                {usernameStatus === "available" && <span className={styles.fieldSuccess} aria-hidden="true">✓</span>}
                {(usernameStatus === "taken" || usernameStatus === "invalid") && <span className={styles.fieldError} aria-hidden="true">!</span>}
              </div>
              {usernameMessage && <small id="username-status" className={usernameStatus === "taken" || usernameStatus === "invalid" ? styles.statusError : usernameStatus === "available" ? styles.statusSuccess : undefined}>{usernameMessage}</small>}
            </label>

            <label className={styles.field} htmlFor="email-address">
              <span>Email address</span>
              <input id="email-address" value={user?.email || ""} disabled readOnly aria-readonly="true" />
            </label>

            <div className={styles.saveRow}>
              <p>Changes are saved to your Saveswitch account.</p>
              <button type="submit" className={styles.primaryButton} disabled={!hasChanges || saving || !nameIsValid || !usernameReady}>
                {saving ? <><span className={styles.buttonSpinner} aria-hidden="true" />Saving…</> : "Save changes"}
              </button>
            </div>
          </section>
        </form>
      </section>
    </main>
  );
}
