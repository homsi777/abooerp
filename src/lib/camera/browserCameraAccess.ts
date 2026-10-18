/** هل يمكن للمتصفح طلب الكاميرا أصلاً؟ */
export function canUseBrowserCamera(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** getUserMedia يعمل فقط في سياق آمن: HTTPS أو localhost */
export function isSecureCameraContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export function cameraEnvironmentMessage(): string | null {
  if (!canUseBrowserCamera()) {
    return 'المتصفح لا يدعم الوصول إلى الكاميرا.';
  }
  if (!isSecureCameraContext()) {
    return 'الكاميرا لا تعمل على هذا العنوان. افتحي الموقع عبر HTTPS (مثل https://www.abooerp.org) أو من localhost على نفس الجهاز — وليس عبر IP شبكة محلية http://192.168…';
  }
  return null;
}

function permissionDeniedMessage(): string {
  return 'تم رفض إذن الكاميرا. من إعدادات المتصفح أو الموقع (🔒 بجانب العنوان) فعّلي «الكاميرا» ثم أعيدي المحاولة.';
}

function mapGetUserMediaError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return permissionDeniedMessage();
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'لم يُعثر على كاميرا على هذا الجهاز.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'الكاميرا مستخدمة من تطبيق آخر. أغلقيه ثم أعيدي المحاولة.';
    }
    if (err.name === 'SecurityError') {
      return cameraEnvironmentMessage() ?? permissionDeniedMessage();
    }
  }
  return 'تعذر تشغيل الكاميرا. تحققي من الإذن ومن أن الموقع يفتح عبر HTTPS.';
}

/**
 * يُستدعى من onClick مباشرة (قبل فتح نافذة الماسح) حتى يبقى طلب الإذن
 * مرتبطاً بإيماءة المستخدم — مطلوب على iPhone/Android.
 * يُوقف المسار فور منح الإذن؛ html5-qrcode يفتح الكاميرا مجدداً داخل النافذة.
 */
export async function requestCameraPermissionForScan(): Promise<string | null> {
  const env = cameraEnvironmentMessage();
  if (env) return env;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return null;
  } catch (firstErr) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return null;
    } catch {
      return mapGetUserMediaError(firstErr);
    }
  }
}
