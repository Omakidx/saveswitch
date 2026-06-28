import React from "react";

export default function LoadingSpinner() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
    </div>
  );
}
