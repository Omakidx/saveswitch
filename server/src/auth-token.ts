export const AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
export const AUTH_TOKEN_EXPIRATION = '7d'

export const createAuthTokenClaims = ({ sub, email }: { sub: string; email: string }) => ({
  sub,
  email,
  iat: true,
  exp: AUTH_TOKEN_EXPIRATION,
})
