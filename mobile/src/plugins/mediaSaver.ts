import { registerPlugin } from "@capacitor/core";

export interface MediaSaverPlugin {
  saveToPhotos(options: { path: string }): Promise<{
    saved: boolean;
    destination?: string;
  }>;
}

export const MediaSaver = registerPlugin<MediaSaverPlugin>("MediaSaver");
