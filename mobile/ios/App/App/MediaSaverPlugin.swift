import Foundation
import Capacitor
import Photos
import UIKit

@objc(MediaSaverPlugin)
public class MediaSaverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MediaSaverPlugin"
    public let jsName = "MediaSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise)
    ]

    @objc func saveToPhotos(_ call: CAPPluginCall) {
        guard let rawPath = call.getString("path"), !rawPath.isEmpty else {
            call.reject("File path is required")
            return
        }

        let fileURL: URL
        if let parsedURL = URL(string: rawPath), parsedURL.scheme != nil {
            fileURL = parsedURL
        } else {
            fileURL = URL(fileURLWithPath: rawPath)
        }

        let saveOperation = {
            self.persistMedia(at: fileURL, call: call)
        }

        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            switch status {
            case .authorized, .limited:
                saveOperation()
            case .notDetermined:
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                    DispatchQueue.main.async {
                        if newStatus == .authorized || newStatus == .limited {
                            saveOperation()
                        } else {
                            call.reject("Photo library permission was denied")
                        }
                    }
                }
            default:
                call.reject("Photo library permission was denied")
            }
        } else {
            let status = PHPhotoLibrary.authorizationStatus()
            switch status {
            case .authorized:
                saveOperation()
            case .notDetermined:
                PHPhotoLibrary.requestAuthorization { newStatus in
                    DispatchQueue.main.async {
                        if newStatus == .authorized {
                            saveOperation()
                        } else {
                            call.reject("Photo library permission was denied")
                        }
                    }
                }
            default:
                call.reject("Photo library permission was denied")
            }
        }
    }

    private func persistMedia(at fileURL: URL, call: CAPPluginCall) {
        let fileExtension = fileURL.pathExtension.lowercased()
        let imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"]
        let videoExtensions = ["mp4", "mov", "m4v", "avi", "webm"]

        if imageExtensions.contains(fileExtension) {
            guard let image = UIImage(contentsOfFile: fileURL.path) else {
                call.reject("Unable to load image from saved file")
                return
            }

            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                DispatchQueue.main.async {
                    if success {
                        call.resolve(["saved": true, "destination": "photos"])
                    } else {
                        call.reject("Failed to save image to Photos", nil, error)
                    }
                }
            }
            return
        }

        if videoExtensions.contains(fileExtension) {
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            }) { success, error in
                DispatchQueue.main.async {
                    if success {
                        call.resolve(["saved": true, "destination": "photos"])
                    } else {
                        call.reject("Failed to save video to Photos", nil, error)
                    }
                }
            }
            return
        }

        call.reject("Unsupported media type for Photos save")
    }
}
