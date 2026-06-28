"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import GoogleOneTap from "@/components/GoogleOneTap";
import { API_BASE } from "@/lib/api";
const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "599000387525-8lf1uufr1o2t2smf41bbgtevu3kjp4is.apps.googleusercontent.com";

export default function RegisterPage() {
  const router = useRouter();

  const handleGoogleSignUp = () => {
    // Redirect to backend OAuth initiation endpoint
    window.location.href = `${API_BASE}/auth/google`;
  };

  const handleXoomshare = () => {
    router.push("/xoomshare");
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      console.error("OAuth error:", error);
    }
  }, []);

  return (
    <>
      <GoogleOneTap clientId={GOOGLE_CLIENT_ID} />
      <div className="flex min-h-dvh w-full items-center justify-center bg-[rgba(0,0,0,0.98)] px-4 py-8 font-inter">
        <div className="flex w-full max-w-[370px] flex-col items-center">
          {/* ── Main Card ── */}
          <div className="w-full max-w-[350px] rounded-lg">
            <div className="flex w-full flex-col items-center gap-1.5 rounded-[18px] bg-[#121212] px-[30px] py-[15px]">
              {/* Logo + Heading Block */}
              <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
                {/* Logo row — centered */}
                <div className="flex h-[42px] w-full justify-center">
                  <Image
                    src="/images/register/saveswitch-logo.svg"
                    alt="Saveswitch"
                    width={128}
                    height={48}
                    priority
                  />
                </div>

                {/* Text block — below logo */}
                <div className="flex w-full flex-col items-stretch gap-[3.5px]">
                  <h1 className="text-[14.875px] leading-[21px] font-bold text-[#CBCCD2] text-center m-0">
                    Sign up to Saveswitch
                  </h1>
                  <p className="text-[11.375px] leading-[15.75px] font-normal text-[rgba(203,204,210,0.7)] text-center m-0 w-full">
                    Register an account, or use Xoomshare
                  </p>
                </div>
              </div>

              {/* Xoomshare button */}
              <div className="flex justify-center items-center p-2.5">
                <button
                  type="button"
                  id="xoomshare-btn"
                  onClick={handleXoomshare}
                  className="flex items-center gap-2 px-3 w-[114px] h-[23px] bg-white rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-88 active:opacity-75"
                >
                  <Image
                    src="/images/register/cloud-lightning.svg"
                    alt=""
                    width={20}
                    height={20}
                    aria-hidden="true"
                  />
                  <span className="text-[11.375px] leading-[15.75px] font-bold text-black text-center">
                    Xoomshare
                  </span>
                </button>
              </div>

              {/* Continue with Google */}
              <div className="w-full max-w-[280px] rounded-[10px] bg-black">
                <button
                  type="button"
                  id="google-signup-btn"
                  onClick={handleGoogleSignUp}
                  className="flex items-center justify-center gap-2 w-full max-w-[276px] h-[28.5px] mx-auto bg-transparent border-none cursor-pointer rounded-[4px] shadow-[0px_1px_0px_0px_rgba(0,0,0,0.02),0px_2px_3px_-1px_rgba(0,0,0,0.08)] transition-opacity duration-150 hover:opacity-88 active:opacity-75"
                >
                  <Image
                    src="/images/register/google-icon.svg"
                    alt=""
                    width={14}
                    height={14}
                    aria-hidden="true"
                  />
                  <span className="text-[11.375px] leading-[15.75px] font-medium text-white text-center">
                    Continue with Google
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* ── Footer: Sign-in link ── */}
          <div className="w-full max-w-[350px]">
            <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 py-3.5">
              <span className="text-[11.375px] leading-[15.75px] font-normal text-[rgba(203,204,210,0.7)]">
                Already have an account?
              </span>
              <Link
                href="/login"
                className="text-[11.375px] leading-[15.75px] font-medium text-white no-underline transition-opacity duration-150 hover:opacity-80 hover:underline"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
