import AuthExperience from "@/components/auth/AuthExperience";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <AuthExperience mode="register" hasOAuthError={params.error !== undefined} />;
}
