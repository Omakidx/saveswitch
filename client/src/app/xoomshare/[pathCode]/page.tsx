import XoomshareRoomClient from "@/components/xoomshare/XoomshareRoomClient";
import { safeDecodeURIComponent } from "@/lib/roomCode";

export default async function XoomshareRoomPage({
  params,
}: {
  params: Promise<{ pathCode: string }>;
}) {
  const resolvedParams = await params;
  const pathCode = safeDecodeURIComponent(resolvedParams.pathCode);
  return <XoomshareRoomClient key={pathCode} pathCode={pathCode} />;
}
