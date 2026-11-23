/**
 * Developer setting: play a video file from the device instead of the camera.
 * Turned on with ?video=1. The file is read through a local object URL, so nothing is uploaded.
 * The same <video> element feeds the same pipeline (detector, tracker, masks, shutter, hold),
 * and the video plays at its own frame rate.
 */

export function videoFileMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('video') === '1'
}

/** Point the video element at a local file and start playing it once (no loop). */
export function attachVideoFile(video: HTMLVideoElement, file: File): string {
  const url = URL.createObjectURL(file)
  video.srcObject = null
  video.muted = true
  video.loop = false
  video.src = url
  void video.play().catch(() => {
    // Autoplay can be refused; the user's file pick counts as a gesture, so this is rare.
  })
  return url
}

/** Detach the file and free its object URL. */
export function detachVideoFile(video: HTMLVideoElement, url: string | null) {
  video.pause()
  video.removeAttribute('src')
  video.load()
  if (url) URL.revokeObjectURL(url)
}
