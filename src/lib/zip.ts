import JSZip from 'jszip'
import type { OutputFile } from './processing/types'

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after a beat so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadOutput(file: OutputFile): void {
  downloadBlob(new Blob([file.data], { type: file.mime }), file.name)
}

/** De-duplicate file names inside the archive (append (1), (2)…). */
function uniqueNames(files: OutputFile[]): OutputFile[] {
  const seen = new Map<string, number>()
  return files.map((f) => {
    let name = f.name
    if (seen.has(name)) {
      const count = seen.get(name)! + 1
      seen.set(name, count)
      const dot = name.lastIndexOf('.')
      name =
        dot > 0
          ? `${name.slice(0, dot)} (${count})${name.slice(dot)}`
          : `${name} (${count})`
    } else {
      seen.set(name, 0)
    }
    return { ...f, name }
  })
}

export async function createZip(
  files: OutputFile[],
  zipName = 'pdf-suite-output.zip'
): Promise<{ blob: Blob; name: string }> {
  const zip = new JSZip()
  for (const f of uniqueNames(files)) {
    zip.file(f.name, f.data)
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return { blob, name: zipName }
}

export async function downloadZip(
  files: OutputFile[],
  zipName?: string
): Promise<void> {
  const { blob, name } = await createZip(files, zipName)
  downloadBlob(blob, name)
}
