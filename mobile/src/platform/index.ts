/**
 * Platform Service for Mobile (Capacitor) with Web fallbacks
 * Provides platform-specific implementations for file operations, preferences, etc.
 * Includes fallbacks for localhost development mode
 */

import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { App } from "@capacitor/app";
import { CapacitorHttp } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";

// Check if running in native Capacitor environment
const isNative = Capacitor.isNativePlatform();

// Types
export type AssetType = "image" | "video" | "audio" | "text";

export interface AssetMetadata {
  id: string;
  filePath: string;
  fileName: string;
  type: AssetType;
  modelSlug: string;
  createdAt: string;
  tags: string[];
  isFavorite: boolean;
  previewUrl?: string;
}

export interface SaveAssetResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface DeleteAssetResult {
  success: boolean;
  error?: string;
}

export interface DeleteAssetsBulkResult {
  success: boolean;
  deletedCount: number;
  errors: string[];
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface AppSettings {
  theme: "auto" | "dark" | "light";
  language: string;
  autoSaveAssets: boolean;
  assetsDirectory: string;
}

// Storage keys
const KEYS = {
  API_KEY: "wavespeed_api_key",
  SETTINGS: "wavespeed_settings",
  ASSETS_METADATA: "wavespeed_assets_metadata",
};

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  theme: "auto",
  language: "en",
  autoSaveAssets: true,
  assetsDirectory: "WaveSpeed",
};

// Platform Service Interface
export interface PlatformService {
  // Storage
  getApiKey(): Promise<string | null>;
  setApiKey(apiKey: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(settings: Partial<AppSettings>): Promise<void>;
  clearAllData(): Promise<void>;

  // File operations
  saveAsset(
    url: string,
    type: AssetType,
    fileName: string,
    subDir: string,
  ): Promise<SaveAssetResult>;
  deleteAsset(filePath: string): Promise<DeleteAssetResult>;
  deleteAssetsBulk(filePaths: string[]): Promise<DeleteAssetsBulkResult>;
  getAssetsMetadata(): Promise<AssetMetadata[]>;
  saveAssetsMetadata(metadata: AssetMetadata[]): Promise<void>;
  checkFileExists(filePath: string): Promise<boolean>;
  getDefaultAssetsDirectory(): Promise<string>;

  // Download/Share
  downloadFile(url: string, filename: string): Promise<DownloadResult>;
  shareAsset(filePath: string): Promise<void>;

  // External links
  openExternal(url: string): Promise<void>;

  // Platform info
  getPlatform(): "electron" | "capacitor" | "web";
  getAppVersion(): Promise<string>;
  isMobile(): boolean;

  // HTTP proxy for CORS-free image loading
  fetchImageAsDataUrl(url: string): Promise<string | null>;

  // Clipboard operations
  copyToClipboard(text: string): Promise<boolean>;

  // Simple key-value storage (for language preference, etc.)
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Capacitor Implementation
class CapacitorPlatformService implements PlatformService {
  // Storage
  async getApiKey(): Promise<string | null> {
    const { value } = await Preferences.get({ key: KEYS.API_KEY });
    return value;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await Preferences.set({ key: KEYS.API_KEY, value: apiKey });
  }

  async getSettings(): Promise<AppSettings> {
    const { value } = await Preferences.get({ key: KEYS.SETTINGS });
    if (value) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(value) };
    }
    return DEFAULT_SETTINGS;
  }

  async setSettings(settings: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await Preferences.set({
      key: KEYS.SETTINGS,
      value: JSON.stringify(updated),
    });
  }

  async clearAllData(): Promise<void> {
    await Preferences.clear();
  }

  // File operations
  async saveAsset(
    url: string,
    type: AssetType,
    fileName: string,
    subDir: string,
  ): Promise<SaveAssetResult> {
    try {
      // For blob URLs, we need to fetch and convert to base64
      const response = await fetch(url);
      const blob = await response.blob();
      const base64 = await this.blobToBase64(blob);

      const directory = `WaveSpeed/${subDir}`;

      // Ensure directory exists
      try {
        await Filesystem.mkdir({
          path: directory,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch {
        // Directory might already exist
      }

      const filePath = `${directory}/${fileName}`;

      await Filesystem.writeFile({
        path: filePath,
        data: base64,
        directory: Directory.Documents,
      });

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteAsset(filePath: string): Promise<DeleteAssetResult> {
    try {
      await Filesystem.deleteFile({
        path: filePath,
        directory: Directory.Documents,
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteAssetsBulk(filePaths: string[]): Promise<DeleteAssetsBulkResult> {
    const errors: string[] = [];
    let deletedCount = 0;

    for (const filePath of filePaths) {
      const result = await this.deleteAsset(filePath);
      if (result.success) {
        deletedCount++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    return { success: errors.length === 0, deletedCount, errors };
  }

  async getAssetsMetadata(): Promise<AssetMetadata[]> {
    const { value } = await Preferences.get({ key: KEYS.ASSETS_METADATA });
    if (value) {
      return JSON.parse(value);
    }
    return [];
  }

  async saveAssetsMetadata(metadata: AssetMetadata[]): Promise<void> {
    await Preferences.set({
      key: KEYS.ASSETS_METADATA,
      value: JSON.stringify(metadata),
    });
  }

  async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await Filesystem.stat({
        path: filePath,
        directory: Directory.Documents,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getDefaultAssetsDirectory(): Promise<string> {
    return "Documents/WaveSpeed";
  }

  // Download/Share
  async downloadFile(url: string, filename: string): Promise<DownloadResult> {
    // In native mode, use CapacitorHttp to bypass CORS and Filesystem to save
    if (isNative) {
      try {
        // Use CapacitorHttp to fetch the file (bypasses CORS)
        const response = await CapacitorHttp.get({
          url,
          responseType: "blob",
        });

        if (response.status !== 200) {
          return { success: false, error: `HTTP ${response.status}` };
        }

        // The response.data is already base64 when responseType is 'blob'
        const base64 = response.data as string;

        // Ensure Downloads directory exists
        const directory = "Downloads";
        try {
          await Filesystem.mkdir({
            path: directory,
            directory: Directory.Documents,
            recursive: true,
          });
        } catch {
          // Directory might already exist
        }

        const filePath = `${directory}/${filename}`;

        await Filesystem.writeFile({
          path: filePath,
          data: base64,
          directory: Directory.Documents,
        });

        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // Web fallback: use browser download
    try {
      const response = await fetch(url, { mode: "cors" });
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up blob URL after a short delay
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

      return { success: true, filePath: filename };
    } catch (error) {
      // Final fallback: open in new tab
      window.open(url, "_blank");
      return { success: true, filePath: url };
    }
  }

  async shareAsset(filePath: string): Promise<void> {
    try {
      const file = await Filesystem.getUri({
        path: filePath,
        directory: Directory.Documents,
      });

      await Share.share({
        url: file.uri,
      });
    } catch (error) {
      console.error("Share failed:", error);
    }
  }

  // External links
  async openExternal(url: string): Promise<void> {
    try {
      await Browser.open({ url });
    } catch {
      // Fallback for web
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  // Platform info
  getPlatform(): "electron" | "capacitor" | "web" {
    return isNative ? "capacitor" : "web";
  }

  async getAppVersion(): Promise<string> {
    try {
      const info = await App.getInfo();
      return info.version;
    } catch {
      return "1.0.0";
    }
  }

  isMobile(): boolean {
    // In native mode, always true
    if (isNative) return true;
    // In web mode, check if it's a mobile browser
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  }

  // HTTP proxy for CORS-free image loading
  async fetchImageAsDataUrl(url: string): Promise<string | null> {
    // In native mode, use CapacitorHttp to bypass CORS
    if (isNative) {
      try {
        const response = await CapacitorHttp.get({
          url,
          responseType: "blob",
        });

        if (response.status !== 200) {
          console.error("Failed to fetch image:", response.status);
          return null;
        }

        // The response.data is a base64 string when responseType is 'blob'
        const base64Data = response.data as string;

        // Determine content type from response headers or URL
        const contentType =
          response.headers["content-type"] ||
          this.getContentTypeFromUrl(url) ||
          "image/jpeg";

        return `data:${contentType};base64,${base64Data}`;
      } catch (error) {
        console.error("Failed to fetch image as data URL:", error);
        return null;
      }
    }

    // In web mode, try regular fetch (may have CORS issues in production)
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) {
        console.error("Failed to fetch image:", response.status);
        return null;
      }
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error("Failed to fetch image as data URL (web fallback):", error);
      // Return the original URL as fallback for localhost development
      return url;
    }
  }

  // Clipboard operations
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback for older devices
      return this.copyToClipboardFallback(text);
    } catch {
      return this.copyToClipboardFallback(text);
    }
  }

  private copyToClipboardFallback(text: string): boolean {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = document.execCommand("copy");
      document.body.removeChild(textArea);
      return result;
    } catch {
      return false;
    }
  }

  // Simple key-value storage using Capacitor Preferences
  async getItem(key: string): Promise<string | null> {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      // Fallback to localStorage for web
      return localStorage.getItem(key);
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      await Preferences.set({ key, value });
    } catch {
      // Fallback to localStorage for web
      localStorage.setItem(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await Preferences.remove({ key });
    } catch {
      // Fallback to localStorage for web
      localStorage.removeItem(key);
    }
  }

  private getContentTypeFromUrl(url: string): string | null {
    const ext = url.split(".").pop()?.toLowerCase().split("?")[0];
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
    };
    return ext ? mimeTypes[ext] || null : null;
  }

  // Helper methods
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        // Remove data URL prefix
        resolve(base64.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

// Singleton instance
let platformService: PlatformService | null = null;

export function getPlatformService(): PlatformService {
  if (!platformService) {
    platformService = new CapacitorPlatformService();
  }
  return platformService;
}

export default getPlatformService;
