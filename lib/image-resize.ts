// Screenshots are often larger than Claude's 5 MB image limit — downscale in the browser first
const MAX_EDGE = 2400
const MAX_BYTES = 4 * 1024 * 1024

export async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= MAX_BYTES) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}
