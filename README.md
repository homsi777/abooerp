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