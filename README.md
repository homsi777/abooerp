cd ~/abooerp && \
git pull origin web-browser-mode && \
npm install && \
npm run build && \
sudo rm -rf /var/www/abooerp/frontend/* && \
sudo cp -r dist/* /var/www/abooerp/frontend/ && \
pm2 restart abooerp-backend --update-env && \
sudo nginx -t && \
sudo systemctl reload nginx



cd ~/abooerp
git diff package.json          # اختياري: شوف الفرق
git checkout -- package.json   # تجاهل التعديل المحلي
git pull origin web-browser-mode
npm install
npm run build
sudo rm -rf /var/www/abooerp/frontend/*
sudo cp -r dist/* /var/www/abooerp/frontend/
pm2 restart abooerp-backend --update-env
sudo nginx -t && sudo systemctl reload nginx





cd ~/abooerp

# 1) تجاهل تعديلات dist ثم السحب
git checkout -- dist/
git clean -fd dist/
git pull origin web-browser-mode

# 2) تأكد أنك وصلت للcommit الصحيح
git log -1 --oneline
# يجب أن يظهر: eeb0d1f تعديل السندات للمحاسب

# 3) تأكد أن الملفات الجديدة موجودة
ls -la src/components/finance/VoucherExcelGrid.tsx

# 4) بناء ونشر
npm run build
# يجب أن ترى: ✓ 1887 modules transformed

sudo rm -rf /var/www/abooerp/frontend/*
sudo cp -r dist/* /var/www/abooerp/frontend/

pm2 restart abooerp-backend --update-env
sudo nginx -t && sudo systemctl reload nginx




