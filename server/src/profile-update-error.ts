import {
  CloudinaryConfigurationError,
  ImageUploadError,
  ImageValidationError,
} from './utils/cloudinary'

export type ProfileUpdateFailure = {
  status: 400 | 500 | 502
  error: string
}

/** Classify expected failures while keeping unexpected details out of logs and responses. */
export const reportProfileUpdateFailure = (failure: unknown): ProfileUpdateFailure => {
  if (failure instanceof ImageValidationError) {
    console.error('Profile update failed', { kind: 'image-validation' })
    return { status: 400, error: failure.message }
  }
  if (failure instanceof CloudinaryConfigurationError) {
    console.error('Profile update failed', { kind: 'provider-configuration' })
    return { status: 500, error: failure.message }
  }
  if (failure instanceof ImageUploadError) {
    console.error('Profile update failed', { kind: 'provider-upload' })
    return { status: 502, error: failure.message }
  }

  console.error('Profile update failed', { kind: 'unexpected' })
  return { status: 500, error: 'Unable to update the profile right now.' }
}
