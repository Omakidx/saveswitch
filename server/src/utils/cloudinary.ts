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

export async function uploadResource(base64Data: string, type: 'image' | 'pdf'): Promise<string> {
  try {
    configureCloudinary()
    
    const result = await cloudinary.uploader.upload(base64Data, {
      folder: RESOURCE_UPLOAD_FOLDER,
      resource_type: 'auto',
    })

    return result.secure_url
  } catch (error) {
    console.error('Cloudinary resource upload error:', error)
    throw new Error('Failed to upload resource')
  }
}
