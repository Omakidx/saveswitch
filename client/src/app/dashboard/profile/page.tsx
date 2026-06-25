"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROFILE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  username: string | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; message: string }>({ isOpen: false, title: "", message: "" });
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [usernameMessage, setUsernameMessage] = useState("");
  const [picture, setPicture] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
        });
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
          setName(data.user.name);
          setPicture(data.user.picture);
          if (data.user.username) {
            setUsername(data.user.username);
            setOriginalUsername(data.user.username);
          }
        } else {
          router.push("/login");
        }
      } catch (err) {
        console.error("Error fetching user", err);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, [router]);

  useEffect(() => {
    if (!username.trim()) {
      setUsernameStatus("idle");
      setUsernameMessage("");
      return;
    }

    if (username === originalUsername) {
      setUsernameStatus("idle");
      setUsernameMessage("");
      return;
    }

    if (username.trim().length < 3 || username.trim().length > 20) {
      setUsernameStatus("invalid");
      setUsernameMessage("Username must be between 3 and 20 characters.");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(username.trim().toLowerCase())) {
      setUsernameStatus("invalid");
      setUsernameMessage("Only lowercase letters, numbers, and underscores.");
      return;
    }

    setUsernameStatus("checking");
    setUsernameMessage("Checking availability...");

    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/users/check-username?username=${encodeURIComponent(username.trim())}`, {
          credentials: "include",
        });
        const data = await res.json();
        
        if (data.available) {
          setUsernameStatus("available");
          setUsernameMessage("Username is available!");
        } else {
          setUsernameStatus("taken");
          setUsernameMessage(data.error || "Username is already taken.");
        }
      } catch (err) {
        setUsernameStatus("idle");
        setUsernameMessage("");
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [username, originalUsername]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!ALLOWED_PROFILE_IMAGE_TYPES.has(file.type)) {
        setModalState({
          isOpen: true,
          title: "Unsupported Image",
          message: "Please choose a PNG, JPG, WebP, or GIF image.",
        });
        e.target.value = "";
        return;
      }

      if (file.size > MAX_PROFILE_IMAGE_BYTES) {
        setModalState({
          isOpen: true,
          title: "Image Too Large",
          message: "Please choose an image smaller than 5MB.",
        });
        e.target.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setPicture(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), picture, username: username.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setModalState({
          isOpen: true,
          title: "Profile Updated",
          message: "Your profile has been saved successfully.",
        });
        setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1500);
      } else {
        setModalState({
          isOpen: true,
          title: "Error",
          message: data.error || "Failed to save profile",
        });
      }
    } catch (err: unknown) {
      console.error("Error saving profile", err);
      setModalState({
        isOpen: true,
        title: "Error",
        message: err instanceof Error ? err.message : "Failed to save profile",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = user ? (name !== user.name || picture !== user.picture || username !== (user.username || "")) : false;

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <Modal
        isOpen={modalState.isOpen}
        title={modalState.title}
        message={modalState.message}
        cancelText="OK"
        onClose={() => setModalState({ ...modalState, isOpen: false })}
      />
      <div className="flex h-screen w-full items-center justify-center bg-black font-arimo relative overflow-hidden">


      <div className="relative z-10 w-full max-w-2xl px-8">
        <button
          onClick={() => router.push("/dashboard")}
          className="mb-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors duration-200 border-none bg-transparent cursor-pointer group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-chevron-down.svg"
            alt=""
            className="w-4 h-4 rotate-90 opacity-60 group-hover:opacity-100 transition-all duration-200"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <span className="text-sm font-medium">Back to Dashboard</span>
        </button>

        <div className="flex flex-col w-full">
          <h1 className="text-2xl font-bold text-white mb-2">Edit Profile</h1>
          <p className="text-white/50 text-sm mb-8">
            Update your display name and profile picture.
          </p>

          <form onSubmit={handleSave} className="flex flex-row items-start gap-12 w-full mt-4">
            <div className="flex-shrink-0">
              <div
                className="relative group cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-white/10 relative transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
                  {picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={picture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/icons/avatar-placeholder.png"
                      alt="Placeholder"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                {/* Camera Badge */}
                <div className="absolute bottom-0 right-0 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110 border border-black/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/icons/icon-camera.svg"
                    alt="Change picture"
                    className="w-5 h-5"
                    style={{ filter: "brightness(0)" }}
                  />
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                />
              </div>
            </div>

            <div className="flex flex-col gap-6 flex-1">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-white/70 ml-2">Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 focus:bg-white/10 transition-all duration-200"
                  placeholder="Enter your name"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-white/70 ml-2">Username</label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`w-full bg-white/5 backdrop-blur-md border rounded-full px-4 py-2 text-sm text-white placeholder-white/30 outline-none transition-all duration-200 ${
                      usernameStatus === "invalid" || usernameStatus === "taken"
                        ? "border-red-500/50 focus:border-red-500"
                        : usernameStatus === "available"
                        ? "border-green-500/50 focus:border-green-500"
                        : "border-white/10 focus:border-white/30 focus:bg-white/10"
                    }`}
                    placeholder="e.g. duck_se00"
                    pattern="^[A-Za-z0-9_]+$"
                    title="Only letters, numbers, and underscores are allowed"
                    minLength={3}
                    maxLength={20}
                    required
                  />
                  {usernameStatus === "checking" && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-white/50"></div>
                    </div>
                  )}
                  {usernameStatus === "available" && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/icon-checkmark.svg" alt="Available" className="w-4 h-4 text-green-500" style={{ filter: "invert(64%) sepia(50%) saturate(1478%) hue-rotate(85deg) brightness(97%) contrast(93%)" }} />
                    </div>
                  )}
                  {(usernameStatus === "taken" || usernameStatus === "invalid") && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/icon-error.svg" alt="Error" className="w-4 h-4 text-red-500" style={{ filter: "invert(42%) sepia(93%) saturate(1352%) hue-rotate(336deg) brightness(119%) contrast(119%)" }} />
                    </div>
                  )}
                </div>
                {usernameMessage && (
                  <span
                    className={`text-xs ml-2 mt-1 ${
                      usernameStatus === "invalid" || usernameStatus === "taken"
                        ? "text-red-400"
                        : usernameStatus === "available"
                        ? "text-green-400"
                        : "text-white/50"
                    }`}
                  >
                    {usernameMessage}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-white/70 ml-2">Email Address</label>
                <input
                  type="text"
                  value={user?.email || ""}
                  disabled
                  className="w-full bg-white/5 backdrop-blur-md border border-white/5 rounded-full px-4 py-2 text-sm text-white/50 outline-none cursor-not-allowed"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!hasChanges || saving || usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "checking"}
                  className={`rounded-full border font-medium px-6 py-2 text-sm inline-flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    hasChanges
                      ? "bg-white text-black border-transparent hover:bg-white/90 active:scale-[0.98]"
                      : "bg-white/10 backdrop-blur-md border-white/20 text-white"
                  }`}
                >
                  {saving ? (
                    <>
                      <div className={`animate-spin rounded-full h-3.5 w-3.5 border-t-2 border-b-2 ${hasChanges ? "border-black" : "border-white"}`}></div>
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      </div>
    </>
  );
}
