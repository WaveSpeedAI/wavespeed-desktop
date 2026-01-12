/**
 * Hook for downloading files on mobile using Capacitor Filesystem
 */
import { useCallback } from 'react'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'

const isNative = Capacitor.isNativePlatform()

export function useMobileDownload() {
  const { toast } = useToast()
  const { t } = useTranslation()

  /**
   * Convert blob to base64 string
   */
  const blobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = base64.split(',')[1]
        resolve(base64Data)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }, [])

  /**
   * Download a blob to the device
   */
  const downloadBlob = useCallback(async (
    blob: Blob,
    filename: string,
    options?: { showToast?: boolean; shareAfter?: boolean }
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    const { showToast = true, shareAfter = false } = options || {}

    try {
      if (isNative) {
        // Convert blob to base64
        const base64Data = await blobToBase64(blob)

        // Save to Downloads folder in Documents
        const directory = 'Downloads'

        // Ensure directory exists
        try {
          await Filesystem.mkdir({
            path: directory,
            directory: Directory.Documents,
            recursive: true
          })
        } catch {
          // Directory might already exist
        }

        const filePath = `${directory}/${filename}`

        await Filesystem.writeFile({
          path: filePath,
          data: base64Data,
          directory: Directory.Documents
        })

        if (showToast) {
          toast({
            title: t('common.success'),
            description: t('freeTools.downloadSuccess')
          })
        }

        // Optionally share the file
        if (shareAfter) {
          try {
            const fileUri = await Filesystem.getUri({
              path: filePath,
              directory: Directory.Documents
            })
            await Share.share({
              url: fileUri.uri
            })
          } catch (shareError) {
            console.warn('Share failed:', shareError)
          }
        }

        return { success: true, filePath }
      } else {
        // Web fallback: use browser download
        const blobUrl = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = blobUrl
        link.download = filename
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        // Clean up blob URL after a short delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 100)

        if (showToast) {
          toast({
            title: t('common.success'),
            description: t('freeTools.downloadStarted', 'Download started')
          })
        }

        return { success: true, filePath: filename }
      }
    } catch (error) {
      const errorMessage = (error as Error).message

      if (showToast) {
        toast({
          title: t('common.error'),
          description: errorMessage,
          variant: 'destructive'
        })
      }

      return { success: false, error: errorMessage }
    }
  }, [blobToBase64, toast, t])

  /**
   * Download from a blob URL
   */
  const downloadFromBlobUrl = useCallback(async (
    blobUrl: string,
    filename: string,
    options?: { showToast?: boolean; shareAfter?: boolean }
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const response = await fetch(blobUrl)
      const blob = await response.blob()
      return downloadBlob(blob, filename, options)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }, [downloadBlob])

  /**
   * Download from a data URL (base64)
   */
  const downloadFromDataUrl = useCallback(async (
    dataUrl: string,
    filename: string,
    options?: { showToast?: boolean; shareAfter?: boolean }
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      return downloadBlob(blob, filename, options)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }, [downloadBlob])

  return {
    downloadBlob,
    downloadFromBlobUrl,
    downloadFromDataUrl,
    isNative
  }
}
