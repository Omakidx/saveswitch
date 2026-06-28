import XoomshareRoomClient from "@/components/xoomshare/XoomshareRoomClient";

export default async function XoomshareRoomPage({
  params,
}: {
  params: Promise<{ pathCode: string }>;
}) {
  const resolvedParams = await params;
  return <XoomshareRoomClient pathCode={decodeURIComponent(resolvedParams.pathCode)} />;
}
