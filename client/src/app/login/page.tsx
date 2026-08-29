import AuthExperience from "@/components/auth/AuthExperience";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <AuthExperience mode="login" hasOAuthError={params.error !== undefined} />;
}
