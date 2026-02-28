import { describe, it, expect, vi, beforeEach } from "vitest";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { getPlatformService } from "@mobile/platform";

describe("CapacitorPlatformService", () => {
  let service: ReturnType<typeof getPlatformService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = getPlatformService();
  });

  describe("getApiKey / setApiKey", () => {
    it("should get API key from Preferences", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: "test-api-key" });

      const apiKey = await service.getApiKey();

      expect(apiKey).toBe("test-api-key");
      expect(Preferences.get).toHaveBeenCalledWith({
        key: "wavespeed_api_key",
      });
    });

    it("should return null when no API key stored", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: null });

      const apiKey = await service.getApiKey();

      expect(apiKey).toBeNull();
    });

    it("should set API key in Preferences", async () => {
      vi.mocked(Preferences.set).mockResolvedValue();

      await service.setApiKey("new-api-key");

      expect(Preferences.set).toHaveBeenCalledWith({
        key: "wavespeed_api_key",
        value: "new-api-key",
      });
    });
  });

  describe("getSettings / setSettings", () => {
    it("should return default settings when none stored", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: null });

      const settings = await service.getSettings();

      expect(settings).toEqual({
        theme: "auto",
        language: "en",
        autoSaveAssets: true,
        assetsDirectory: "WaveSpeed",
      });
    });

    it("should merge stored settings with defaults", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({
        value: JSON.stringify({ theme: "dark", language: "zh-CN" }),
      });

      const settings = await service.getSettings();

      expect(settings.theme).toBe("dark");
      expect(settings.language).toBe("zh-CN");
      expect(settings.autoSaveAssets).toBe(true); // default
    });

    it("should update settings partially", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: null });
      vi.mocked(Preferences.set).mockResolvedValue();

      await service.setSettings({ theme: "light" });

      expect(Preferences.set).toHaveBeenCalledWith({
        key: "wavespeed_settings",
        value: expect.stringContaining('"theme":"light"'),
      });
    });
  });

  describe("clearAllData", () => {
    it("should clear all Preferences", async () => {
      vi.mocked(Preferences.clear).mockResolvedValue();

      await service.clearAllData();

      expect(Preferences.clear).toHaveBeenCalled();
    });
  });

  describe("deleteAsset", () => {
    it("should delete file from Filesystem", async () => {
      vi.mocked(Filesystem.deleteFile).mockResolvedValue();

      const result = await service.deleteAsset("WaveSpeed/images/test.jpg");

      expect(result.success).toBe(true);
      expect(Filesystem.deleteFile).toHaveBeenCalledWith({
        path: "WaveSpeed/images/test.jpg",
        directory: Directory.Documents,
      });
    });

    it("should return error on failure", async () => {
      vi.mocked(Filesystem.deleteFile).mockRejectedValue(
        new Error("File not found"),
      );

      const result = await service.deleteAsset("non-existent.jpg");

      expect(result.success).toBe(false);
      expect(result.error).toBe("File not found");
    });
  });

  describe("deleteAssetsBulk", () => {
    it("should delete multiple files", async () => {
      vi.mocked(Filesystem.deleteFile).mockResolvedValue();

      const result = await service.deleteAssetsBulk(["file1.jpg", "file2.jpg"]);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("should track errors for failed deletions", async () => {
      vi.mocked(Filesystem.deleteFile)
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error("Permission denied"));

      const result = await service.deleteAssetsBulk(["file1.jpg", "file2.jpg"]);

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(1);
      expect(result.errors).toContain("Permission denied");
    });
  });

  describe("checkFileExists", () => {
    it("should return true when file exists", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        type: "file",
        size: 1000,
        mtime: Date.now(),
        ctime: Date.now(),
        uri: "test-uri",
      });

      const exists = await service.checkFileExists("test.jpg");

      expect(exists).toBe(true);
    });

    it("should return false when file does not exist", async () => {
      vi.mocked(Filesystem.stat).mockRejectedValue(new Error("File not found"));

      const exists = await service.checkFileExists("non-existent.jpg");

      expect(exists).toBe(false);
    });
  });

  describe("openExternal", () => {
    it("should open URL in browser", async () => {
      vi.mocked(Browser.open).mockResolvedValue();

      await service.openExternal("https://example.com");

      expect(Browser.open).toHaveBeenCalledWith({ url: "https://example.com" });
    });
  });

  describe("shareAsset", () => {
    it("should share file using Share plugin", async () => {
      vi.mocked(Filesystem.getUri).mockResolvedValue({
        uri: "file:///test.jpg",
      });
      vi.mocked(Share.share).mockResolvedValue({ activityType: undefined });

      await service.shareAsset("test.jpg");

      expect(Filesystem.getUri).toHaveBeenCalled();
      expect(Share.share).toHaveBeenCalledWith({ url: "file:///test.jpg" });
    });
  });

  describe("getPlatform / isMobile", () => {
    it("should return capacitor as platform", () => {
      expect(service.getPlatform()).toBe("capacitor");
    });

    it("should return true for isMobile", () => {
      expect(service.isMobile()).toBe(true);
    });
  });

  describe("getDefaultAssetsDirectory", () => {
    it("should return default directory path", async () => {
      const dir = await service.getDefaultAssetsDirectory();

      expect(dir).toBe("Documents/WaveSpeed");
    });
  });

  describe("getAssetsMetadata / saveAssetsMetadata", () => {
    it("should return empty array when no metadata stored", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: null });

      const metadata = await service.getAssetsMetadata();

      expect(metadata).toEqual([]);
    });

    it("should return stored metadata", async () => {
      const mockMetadata = [{ id: "1", fileName: "test.jpg" }];
      vi.mocked(Preferences.get).mockResolvedValue({
        value: JSON.stringify(mockMetadata),
      });

      const metadata = await service.getAssetsMetadata();

      expect(metadata).toEqual(mockMetadata);
    });

    it("should save metadata to Preferences", async () => {
      vi.mocked(Preferences.set).mockResolvedValue();
      const mockMetadata = [{ id: "1", fileName: "test.jpg" }];

      await service.saveAssetsMetadata(mockMetadata as any);

      expect(Preferences.set).toHaveBeenCalledWith({
        key: "wavespeed_assets_metadata",
        value: JSON.stringify(mockMetadata),
      });
    });
  });
});
