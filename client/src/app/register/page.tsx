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
      <div className="flex items-center justify-center min-h-screen w-full bg-[rgba(0,0,0,0.98)] font-inter">
        <div className="flex flex-col items-center w-[370px]">
          {/* ── Main Card ── */}
          <div className="w-[350px] rounded-lg">
            <div className="flex flex-col items-center px-[30px] py-[15px] gap-1.5 bg-[#121212] rounded-[18px] w-[350px]">
              {/* Logo + Heading Block */}
              <div className="relative w-[280px] h-[103.5px]">
                {/* Logo row — centered */}
                <div className="absolute top-0 left-0 flex justify-center w-[280px] h-[42px]">
                  <Image
                    src="/images/register/saveswitch-logo.svg"
                    alt="Saveswitch"
                    width={128}
                    height={48}
                    priority
                  />
                </div>

                {/* Text block — below logo */}
                <div className="absolute top-[56px] left-0 flex flex-col items-stretch gap-[3.5px] w-[280px]">
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
              <div className="w-[280px] bg-black rounded-[10px]">
                <button
                  type="button"
                  id="google-signup-btn"
                  onClick={handleGoogleSignUp}
                  className="flex items-center justify-center gap-2 w-[276px] h-[28.5px] mx-auto bg-transparent border-none cursor-pointer rounded-[4px] shadow-[0px_1px_0px_0px_rgba(0,0,0,0.02),0px_2px_3px_-1px_rgba(0,0,0,0.08)] transition-opacity duration-150 hover:opacity-88 active:opacity-75"
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
          <div className="w-[350px]">
            <div className="flex flex-row items-center justify-center py-3.5 gap-[3.5px] whitespace-nowrap">
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
