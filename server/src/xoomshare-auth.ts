/**
 * Xoomshare rooms are intentionally anonymous, so the server issues an opaque
 * participant id per room.  It is kept only in an HttpOnly cookie; clients
 * never submit an ownership id in a request body.
 */
export const XOOMSHARE_LEGACY_COOKIE = 'xoomshare_session'
const XOOMSHARE_COOKIE_PREFIX = 'xoomshare_room_'
const PARTICIPANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const XOOMSHARE_PATH_CODE_PATTERN = /^[A-Za-z0-9_-]+$/

export class XoomsharePathCodeError extends Error {}

/** 16 cryptographically random bytes encoded as URL-safe text (128 bits). */
export const generateXoomsharePathCode = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export const normalizeXoomsharePathCode = ({
  value,
  reservedPathCodes,
}: {
  value: unknown
  reservedPathCodes: ReadonlySet<string>
}) => {
  if (value === undefined || value === null || value === '') return generateXoomsharePathCode()
  if (typeof value !== 'string') throw new XoomsharePathCodeError('Secret page code must be text')

  const pathCode = value.trim()
  if (pathCode.length < 12 || pathCode.length > 48) {
    throw new XoomsharePathCodeError('Secret page code must be between 12 and 48 characters')
  }
  if (!XOOMSHARE_PATH_CODE_PATTERN.test(pathCode)) {
    throw new XoomsharePathCodeError('Use letters, numbers, hyphens, or underscores only')
  }
  if (reservedPathCodes.has(pathCode.toLowerCase()) || pathCode.startsWith('@')) {
    throw new XoomsharePathCodeError('That secret page code is reserved')
  }
  return pathCode
}

export const xoomshareCookieName = (pathCode: string) => `${XOOMSHARE_COOKIE_PREFIX}${pathCode}`

export const readCookie = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) return null

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator === -1) continue

    const key = segment.slice(0, separator).trim()
    if (key !== name) continue

    try {
      return decodeURIComponent(segment.slice(separator + 1).trim())
    } catch {
      return null
    }
  }

  return null
}

export const isParticipantId = (value: string | null): value is string =>
  value !== null && PARTICIPANT_ID_PATTERN.test(value)

export type XoomshareParticipant = {
  participantId: string | null
  isRoomOwner: boolean
  shouldPromoteLegacyOwner: boolean
}

/**
 * A legacy global session cookie may only prove ownership of the room whose
 * stored session id matches it.  It is deliberately not reused as a guest
 * identity in other rooms, which prevents ownership leaking across rooms.
 */
export const resolveXoomshareParticipant = ({
  cookieHeader,
  pathCode,
  roomSessionId,
}: {
  cookieHeader: string | null
  pathCode: string
  roomSessionId: string | null
}): XoomshareParticipant => {
  const roomCookie = readCookie(cookieHeader, xoomshareCookieName(pathCode))
  if (isParticipantId(roomCookie)) {
    return {
      participantId: roomCookie,
      isRoomOwner: roomSessionId !== null && roomCookie === roomSessionId,
      shouldPromoteLegacyOwner: false,
    }
  }

  const legacyCookie = readCookie(cookieHeader, XOOMSHARE_LEGACY_COOKIE)
  if (isParticipantId(legacyCookie) && roomSessionId !== null && legacyCookie === roomSessionId) {
    return {
      participantId: legacyCookie,
      isRoomOwner: true,
      shouldPromoteLegacyOwner: true,
    }
  }

  return { participantId: null, isRoomOwner: false, shouldPromoteLegacyOwner: false }
}

export const canManageXoomshareResource = ({
  isRoomOwner,
  participantId,
  resourceParticipantId,
}: {
  isRoomOwner: boolean
  participantId: string | null
  resourceParticipantId: string | null
}) => isRoomOwner || (participantId !== null && participantId === resourceParticipantId)

export const canCreateXoomshareResource = ({
  isRoomOwner,
  allowGuestResources,
}: {
  isRoomOwner: boolean
  allowGuestResources: boolean
}) => isRoomOwner || allowGuestResources

export const createXoomshareCookie = ({
  name,
  value,
  maxAge,
  secure,
}: {
  name: string
  value: string
  maxAge: number
  secure: boolean
}) => [
  `${name}=${encodeURIComponent(value)}`,
  'Path=/',
  `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  'HttpOnly',
  'SameSite=Lax',
  ...(secure ? ['Secure'] : []),
].join('; ')
