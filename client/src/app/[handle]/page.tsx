import PublicProfileClient from './PublicProfileClient';
import XoomshareRoomClient from '@/components/xoomshare/XoomshareRoomClient';

export default async function PublicProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const resolvedParams = await params;
  const decodedHandle = decodeURIComponent(resolvedParams.handle);
  
  if (!decodedHandle.startsWith('@')) {
    return <XoomshareRoomClient pathCode={decodedHandle} />;
  }

  const username = decodedHandle.slice(1);

  // We can just pass the username to the client component to fetch everything,
  // or fetch it here. Since the dashboard fetches data on the client side with credentials,
  // doing it on the client is fine and consistent, but since it's a public endpoint we can fetch it here.
  // For simplicity and to match the existing patterns, we'll let a client component do it.
  
  return <PublicProfileClient username={username} />;
}
