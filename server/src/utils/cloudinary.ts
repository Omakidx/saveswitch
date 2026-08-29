import { v2 as cloudinary } from 'cloudinary'

const ALLOWED_IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const DATA_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,/i
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024
const PROFILE_UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'saveswitch/profiles'

export class CloudinaryConfigurationError extends Error {
  constructor(message = 'Cloudinary is not configured correctly') {
    super(message)
    this.name = 'CloudinaryConfigurationError'
  }
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageValidationError'
  }
}

export class ImageUploadError extends Error {
  constructor(message = 'Failed to upload image') {
    super(message)
    this.name = 'ImageUploadError'
  }
}

function configureCloudinary() {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim()

  if (cloudinaryUrl) {
    if (!cloudinaryUrl.toLowerCase().startsWith('cloudinary://')) {
      throw new CloudinaryConfigurationError('CLOUDINARY_URL must start with cloudinary://')
    }

    cloudinary.config(true)
    return
  }

  // Cloudinary SDK automatically picks up CLOUDINARY_URL from process.env?.trim()
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim()
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim()
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim()
  const missing = [
    ['CLOUDINARY_CLOUD_NAME', cloudName],
    ['CLOUDINARY_API_KEY', apiKey],
    ['CLOUDINARY_API_SECRET', apiSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new CloudinaryConfigurationError(
      `Missing Cloudinary environment variables: ${missing.join(', ')}`
    )
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  })
}

function validateDataImage(dataUrl: string) {
  const match = dataUrl.match(DATA_IMAGE_PATTERN)
  if (!match) {
    throw new ImageValidationError('Profile image must be a PNG, JPG, WebP, or GIF')
  }

  const extension = match[1]!.toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.has(extension)) {
    throw new ImageValidationError('Unsupported profile image type')
  }

  const base64 = dataUrl.slice(match[0].length)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const byteLength = Math.floor((base64.length * 3) / 4) - padding

  if (byteLength <= 0) {
    throw new ImageValidationError('Profile image is empty')
  }

  if (byteLength > MAX_PROFILE_IMAGE_BYTES) {
    throw new ImageValidationError('Profile image must be smaller than 5MB')
  }
}

function isCloudinaryConfigurationRejection(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybeError = error as { http_code?: number; message?: string }
  return (
    maybeError.http_code === 401 ||
    maybeError.http_code === 403 ||
    maybeError.message?.includes('Invalid cloud_name') ||
    maybeError.message?.includes('missing permissions') ||
    maybeError.message?.includes('Must supply') ||
    false
  )
}

export async function uploadImage(base64Image: string): Promise<string> {
  try {
    configureCloudinary()
    validateDataImage(base64Image)

    const result = await cloudinary.uploader.upload(base64Image, {
      folder: PROFILE_UPLOAD_FOLDER,
      allowed_formats: [...ALLOWED_IMAGE_TYPES],
      resource_type: 'image',
    })

    return result.secure_url
  } catch (error) {
    if (
      error instanceof CloudinaryConfigurationError ||
      error instanceof ImageValidationError
    ) {
      throw error
    }

    if (isCloudinaryConfigurationRejection(error)) {
      const maybeError = error as { http_code?: number }
      if (maybeError.http_code === 403) {
        throw new CloudinaryConfigurationError(
          'Cloudinary credentials do not have upload/create permission. Update CLOUDINARY_URL with an API key that can create image assets.'
        )
      }

      throw new CloudinaryConfigurationError(
        'Cloudinary credentials were rejected. Check CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET in .env.local.'
      )
    }

    console.error('Cloudinary upload error:', error)
    throw new ImageUploadError()
  }
}

const RESOURCE_UPLOAD_FOLDER = process.env.CLOUDINARY_RESOURCE_FOLDER || 'saveswitch/resources'
const MAX_RESOURCE_UPLOAD_BYTES = 10 * 1024 * 1024
const RESOURCE_DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i
const IMAGE_RESOURCE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])
const FILE_RESOURCE_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/x-tar',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'text/markdown',
])

export type ResourceUploadOptions = {
  retainDataUrlLocally?: boolean
}

export type UploadedResourceAsset = {
  url: string
  publicId: string | null
  resourceType: 'image' | 'raw'
}

export class ResourceUploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceUploadValidationError'
  }
}

export class ResourceUploadError extends Error {
  constructor(message = 'Failed to upload resource') {
    super(message)
    this.name = 'ResourceUploadError'
  }
}

function isAllowedFileMimeType(mimeType: string) {
  return (
    FILE_RESOURCE_MIME_TYPES.has(mimeType) ||
    /^audio\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType) ||
    /^video\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)
  )
}

export function getBase64ByteLength(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

export function getResourceDataUrlByteLength(dataUrl: string) {
  const match = RESOURCE_DATA_URL_PATTERN.exec(dataUrl)
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new ResourceUploadValidationError('Upload must be a valid base64 data URL')
  }
  return getBase64ByteLength(match[2])
}

/**
 * Validate uploaded resource data before it is persisted locally or forwarded
 * to Cloudinary. This intentionally accepts only base64 data URLs so the
 * stored value remains consumable by the existing image/download UI.
 */
export function validateResourceDataUrl(
  dataUrl: string,
  type: 'image' | 'pdf' | 'file'
) {
  const match = RESOURCE_DATA_URL_PATTERN.exec(dataUrl)
  if (!match) {
    throw new ResourceUploadValidationError('Upload must be a valid base64 data URL')
  }

  const mimeType = match[1]!.toLowerCase()
  const base64 = match[2]!

  if (!base64 || base64.length % 4 !== 0) {
    throw new ResourceUploadValidationError('Upload data is malformed')
  }

  if (type === 'image' && !IMAGE_RESOURCE_MIME_TYPES.has(mimeType)) {
    throw new ResourceUploadValidationError('Images must be PNG, JPG, WebP, or GIF files')
  }

  if (type === 'pdf' && mimeType !== 'application/pdf') {
    throw new ResourceUploadValidationError('PDF uploads must use application/pdf')
  }

  if (type === 'file' && !isAllowedFileMimeType(mimeType)) {
    throw new ResourceUploadValidationError('This file type is not supported for upload')
  }

  if (getResourceDataUrlByteLength(dataUrl) > MAX_RESOURCE_UPLOAD_BYTES) {
    throw new ResourceUploadValidationError('Uploads must be smaller than 10MB')
  }
}

export async function uploadResourceAsset(
  base64Data: string,
  type: 'image' | 'pdf' | 'file',
  { retainDataUrlLocally = false }: ResourceUploadOptions = {}
): Promise<UploadedResourceAsset> {
  validateResourceDataUrl(base64Data, type)

  // Only index.ts may opt into local persistence after it verifies the full,
  // loopback-only development contract. Production always uses Cloudinary.
  if (retainDataUrlLocally) {
    return {
      url: base64Data,
      publicId: null,
      resourceType: type === 'image' ? 'image' : 'raw',
    }
  }

  try {
    configureCloudinary()

    const result = await cloudinary.uploader.upload(base64Data, {
      folder: RESOURCE_UPLOAD_FOLDER,
      resource_type: type === 'image' ? 'image' : 'raw',
    })

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: type === 'image' ? 'image' : 'raw',
    }
  } catch (error) {
    if (error instanceof CloudinaryConfigurationError) {
      throw error
    }

    if (isCloudinaryConfigurationRejection(error)) {
      throw new CloudinaryConfigurationError('Cloudinary credentials were rejected. Check the configured upload credentials.')
    }

    console.error('Cloudinary resource upload error:', error)
    throw new ResourceUploadError()
  }
}

/**
 * Best-effort cleanup for an upload that was accepted by Cloudinary but never
 * committed to our database. Local development data URLs have no public id and
 * therefore never make a remote destroy call.
 */
export async function destroyUploadedResourceAsset(asset: UploadedResourceAsset) {
  if (!asset.publicId) return false
  try {
    configureCloudinary()
    await cloudinary.uploader.destroy(asset.publicId, {
      resource_type: asset.resourceType,
      invalidate: true,
    })
    return true
  } catch (error) {
    console.error('Cloudinary resource cleanup error:', error)
    return false
  }
}

/** Injectable lifecycle helper for callers/tests. */
export async function cleanupUncommittedResourceAsset(
  asset: UploadedResourceAsset | null,
  cleanup: (asset: UploadedResourceAsset) => Promise<unknown> = destroyUploadedResourceAsset,
) {
  if (!asset?.publicId) return false
  return (await cleanup(asset)) === true
}

export const getAssetDeletionQueueOutcome = (destroyed: boolean) => (
  destroyed
    ? { remove: true, incrementAttempts: false }
    : { remove: false, incrementAttempts: true }
)

export const dedupeUploadedResourceAssets = (assets: UploadedResourceAsset[]) => {
  const seen = new Set<string>()
  return assets.filter((asset) => {
    if (!asset.publicId || seen.has(asset.publicId)) return false
    seen.add(asset.publicId)
    return true
  })
}

/** Backwards-compatible URL-only contract used by non-Xoomshare callers. */
export async function uploadResource(
  base64Data: string,
  type: 'image' | 'pdf' | 'file',
  options: ResourceUploadOptions = {},
): Promise<string> {
  return (await uploadResourceAsset(base64Data, type, options)).url
}
