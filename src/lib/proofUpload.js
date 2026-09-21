const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'heic']
export const PROOF_ACCEPT =
  '.jpg,.jpeg,.png,.pdf,.heic,image/jpeg,image/png,image/heic,application/pdf'
const MAX_BYTES = 15 * 1024 * 1024 // 15MB

export function validateProofFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return 'That file type is not supported. Use JPG, PNG, HEIC, or PDF.'
  }
  if (file.size > MAX_BYTES) {
    return 'That file is too large. Keep it under 15MB.'
  }
  return null
}

// Bucket is private — the returned path is a storage key, not a URL.
// Fetch a signed URL to actually view the file later.
export async function uploadProof(supabase, email, file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${email}/${Date.now()}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('service-proofs')
    .upload(path, file, { contentType: file.type || undefined })
  if (error) throw error
  return path
}

export async function signedProofUrl(supabase, path, expiresIn = 60) {
  const { data, error } = await supabase.storage.from('service-proofs').createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}
