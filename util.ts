import { createHash } from 'node:crypto'

export const calculateFileHash = (
  filePath: string,
): {
  fileHash: string
  fileSize: number
} => {
  const hash = createHash('sha256')
  const fileBuffer = Deno.readFileSync(filePath)
  hash.update(fileBuffer)
  const fileHash = hash.digest('hex').slice(0, 32) // Grab the first 32 characters
  const fileSize = fileBuffer.length
  return { fileHash, fileSize }
}
