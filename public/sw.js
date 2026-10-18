// خدمة عامل بسيطة فقط لتحقيق شرط "قابلية التثبيت" في المتصفح (Chrome يتطلب
// service worker مع معالج fetch). لا تخزين مؤقت متعمَّد — كل طلب يمر مباشرة
// إلى الشبكة كالمعتاد، فلا يُغيَّر سلوك التطبيق الفعلي بأي شكل.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
