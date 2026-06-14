# نشر الويب + API على VPS (تطبيق الوكيل APK يتصل بنفس السحابة)

> **APK** يتصل بـ `https://www.abooerp.org/api/v1/` — أي ميزة جديدة في `agent-portal` تحتاج **نشر Backend + Frontend** على السحابة قبل تجربة التطبيق.

## نشر سريع (موصى به)

```bash
cd ~/abooerp
git checkout -- dist/
git clean -fd dist/
git pull origin web-browser-mode
bash scripts/deploy-abooerp-web.sh
```

السكربت ينفّذ: `npm install` → `server:migrate` → بناء الويب → بناء الـ API → نشر `dist/` → `nginx reload` → `pm2 restart abooerp-backend`.

## نشر يدوي (نفس الخطوات)

```bash
cd ~/abooerp
git checkout -- dist/
git clean -fd dist/
git pull origin web-browser-mode

git log -1 --oneline

npm install
npm run server:migrate
npm run build
npm run server:build

sudo rm -rf /var/www/abooerp/frontend/*
sudo cp -r dist/* /var/www/abooerp/frontend/

pm2 restart abooerp-backend --update-env
sudo nginx -t && sudo systemctl reload nginx
```

## تحقق بعد النشر

```bash
curl -s https://www.abooerp.org/api/v1/system/lan-health
# أو من المتصفح:
# https://www.abooerp.org/#/login
```

**ميزات بوابة الوكيل (APK):**

- `GET /api/v1/agent-portal/shipments?date=YYYY-MM-DD`
- `GET|POST /api/v1/agent-portal/vouchers`

## تطبيق Android (APK)

يُبنى محلياً من مجلد `apk/` في Android Studio — **لا يُرفع إلى VPS**.  
بعد نشر السحابة، ثبّت APK على الجهاز وجرب بحساب وكيل من النظام.
