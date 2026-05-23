import { BrowserWindow } from 'electron';

export function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const splashHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:#0b1220;color:#e2e8f0;
    font-family:'Segoe UI',Arial,sans-serif;
    display:flex;align-items:center;justify-content:center;
    height:100vh;overflow:hidden;
  }
  .card{text-align:center;padding:32px 40px;width:100%;}
  .logo{font-size:26px;font-weight:700;color:#38bdf8;margin-bottom:6px;letter-spacing:-0.5px;}
  .sub{font-size:13px;color:#94a3b8;margin-bottom:28px;}
  .status{font-size:13px;color:#cbd5e1;margin-bottom:18px;min-height:20px;transition:all .3s;}
  .bar-wrap{background:#1e293b;border-radius:8px;height:6px;overflow:hidden;width:320px;margin:0 auto;}
  .bar{height:6px;border-radius:8px;background:linear-gradient(90deg,#0ea5e9,#38bdf8);
       width:30%;animation:pulse 1.4s ease-in-out infinite;}
  @keyframes pulse{0%,100%{opacity:.5;width:30%}50%{opacity:1;width:70%}}
</style>
</head>
<body>
<div class="card">
  <div class="logo">شركة عبو المحمود لنقل والخدمات الوجستية</div>
  <div class="sub">نظام إدارة الشحن والمحاسبة</div>
  <div class="status" id="status">جاري التشغيل...</div>
  <div class="bar-wrap"><div class="bar" id="bar"></div></div>
</div>
<script>
  // Listen for status updates from main process via title trick
  const observer = new MutationObserver(() => {
    const t = document.title;
    if(t && t !== 'splash') document.getElementById('status').textContent = t;
  });
  observer.observe(document.querySelector('title') || document.head, {childList:true,subtree:true,characterData:true});
</script>
</body>
</html>`;

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
  return splash;
}

/** Update the splash screen status message. */
export function setSplashStatus(splash: BrowserWindow, message: string): void {
  if (splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(
    `document.getElementById('status') && (document.getElementById('status').textContent = ${JSON.stringify(message)})`
  ).catch(() => {/* ignore */});
}
