// Cloudinary Configuration for Clarified Dashboard
// Free account setup: https://cloudinary.com/
// 1. Sign up for a free Cloudinary account.
// 2. Note your "Cloud name" from the Cloudinary Dashboard (e.g. "clarified-sa").
// 3. Go to Settings (gear icon) -> Upload -> Scroll down to "Upload presets" -> Add upload preset.
// 4. Set "Signing Mode" to "Unsigned" and give it a name (e.g. "clarified_preset").
// 5. Click Save, then paste your Cloud Name and Preset below:

export const cloudinaryConfig = {
    cloudName: "stam320t",
    uploadPreset: "clarisa",
    folder: "clarified_media"
};

export function isCloudinaryConfigured() {
    return Boolean(
        cloudinaryConfig.cloudName &&
        !cloudinaryConfig.cloudName.includes("YOUR_CLOUD_NAME") &&
        cloudinaryConfig.uploadPreset &&
        !cloudinaryConfig.uploadPreset.includes("YOUR_UPLOAD_PRESET")
    );
}
