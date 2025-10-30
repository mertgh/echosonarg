# 🗄️ Ubuntu VPS'e MongoDB Kurulum Rehberi

## 📋 Gereksinimler
- Ubuntu Server (18.04, 20.04, 22.04 veya 24.04)
- Root veya sudo yetkisi
- SSH erişimi
- En az 2GB RAM önerilir

---

## 🚀 Adım Adım Kurulum

### Adım 1: Sunucuya Bağlan
```bash
ssh root@your-vps-ip
# veya
ssh username@your-vps-ip
```

---

### Adım 2: Sistemi Güncelle
```bash
sudo apt update
sudo apt upgrade -y
```

---

### Adım 3: MongoDB GPG Anahtarını Ekle

**Ubuntu 22.04 / 24.04 için:**
```bash
sudo apt-get install gnupg curl -y

curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor
```

**Ubuntu 20.04 için:**
```bash
sudo apt-get install gnupg curl -y

curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor
```

---

### Adım 4: MongoDB Repository Ekle

**Ubuntu 22.04 (Jammy) için:**
```bash
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
```

**Ubuntu 20.04 (Focal) için:**
```bash
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
```

**Ubuntu 24.04 (Noble) için:**
```bash
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
```

---

### Adım 5: Package Listesini Yenile
```bash
sudo apt update
```

---

### Adım 6: MongoDB'yi Kur
```bash
sudo apt install -y mongodb-org
```

Bu komut şunları kuracak:
- mongodb-org-server (veritabanı)
- mongodb-org-mongos (sharding)
- mongodb-org-shell (komut satırı)
- mongodb-org-tools (araçlar)

---

### Adım 7: MongoDB Servisini Başlat
```bash
# Servisi başlat
sudo systemctl start mongod

# Otomatik başlatmayı aktifleştir (reboot'ta)
sudo systemctl enable mongod

# Durumu kontrol et
sudo systemctl status mongod
```

**Başarılı çıktı:**
```
● mongod.service - MongoDB Database Server
     Loaded: loaded
     Active: active (running)
```

---

### Adım 8: MongoDB'nin Çalıştığını Test Et
```bash
# MongoDB shell'e bağlan
mongosh

# Başarılı bağlantı göreceksin:
# Current Mongosh Log ID: ...
# Connecting to: mongodb://127.0.0.1:27017/
```

**Basit test:**
```javascript
// MongoDB shell'de
show dbs
use space-sonar-io
db.users.insertOne({test: "hello"})
db.users.find()
exit
```

---

### Adım 9: Güvenlik Duvarı Ayarları (İsteğe Bağlı)

**Sadece localhost erişimi (Önerilen):**
MongoDB varsayılan olarak sadece localhost'tan erişilebilir. Bu güvenlidir.

**Uzaktan erişim gerekiyorsa (DİKKATLİ!):**
```bash
# MongoDB config dosyasını düzenle
sudo nano /etc/mongod.conf

# Şu satırı bul:
#   bindIp: 127.0.0.1
# Şu şekilde değiştir:
#   bindIp: 0.0.0.0

# Servisi yeniden başlat
sudo systemctl restart mongod
```

**⚠️ UYARI:** Uzaktan erişim açarsan mutlaka authentication kur!

---

### Adım 10: MongoDB Kullanıcısı Oluştur (Güvenlik - Önerilen)

```bash
# MongoDB shell'e gir
mongosh

# Admin veritabanına geç
use admin

# Admin kullanıcı oluştur
db.createUser({
  user: "admin",
  pwd: "güçlü-şifre-buraya",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
})

# Oyun veritabanına geç
use space-sonar-io

# Oyun için kullanıcı oluştur
db.createUser({
  user: "gameuser",
  pwd: "başka-güçlü-şifre",
  roles: [ { role: "readWrite", db: "space-sonar-io" } ]
})

exit
```

**Artık authentication etkin. Config'i güncelle:**
```bash
sudo nano /etc/mongod.conf

# security bölümünü bul ve ekle:
security:
  authorization: enabled

# Servisi yeniden başlat
sudo systemctl restart mongod
```

**Bağlantı URI güncelle (server.js'de):**
```javascript
const MONGODB_URI = process.env.MONGODB_URI || 
  'mongodb://gameuser:başka-güçlü-şifre@localhost:27017/space-sonar-io';
```

---

## 🎮 Oyun Sunucusunu Başlat

### Adım 11: Node.js Kur (Yoksa)
```bash
# Node.js 20.x kurulumu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Versiyonu kontrol et
node --version
npm --version
```

---

### Adım 12: Oyun Dosyalarını Yükle

**Git ile:**
```bash
cd /var/www
git clone your-repo-url space-sonar-io
cd space-sonar-io
npm install
```

**Veya SCP/SFTP ile:**
```bash
# Kendi bilgisayarından VPS'e
scp -r space-sonar-io/ root@your-vps-ip:/var/www/
```

---

### Adım 13: Environment Variables Ayarla
```bash
cd /var/www/space-sonar-io

# .env dosyası oluştur
nano .env

# İçeriği:
MONGODB_URI=mongodb://localhost:27017/space-sonar-io
PORT=3000

# Kaydet (Ctrl+X, Y, Enter)
```

**server.js'de env kullan:**
```javascript
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/space-sonar-io';
const PORT = process.env.PORT || 3000;
```

---

### Adım 14: PM2 ile Sürekli Çalıştır (Önerilen)

```bash
# PM2 kur (process manager)
sudo npm install -g pm2

# Oyunu başlat
cd /var/www/space-sonar-io
pm2 start server.js --name "space-sonar-io"

# Otomatik başlatma (reboot'ta)
pm2 startup
pm2 save

# Durumu kontrol et
pm2 status
pm2 logs space-sonar-io

# Yeniden başlat
pm2 restart space-sonar-io

# Durdur
pm2 stop space-sonar-io
```

---

### Adım 15: Nginx Reverse Proxy (Opsiyonel ama Önerilen)

**Nginx kur:**
```bash
sudo apt install nginx -y
```

**Config oluştur:**
```bash
sudo nano /etc/nginx/sites-available/space-sonar-io

# İçerik:
server {
    listen 80;
    server_name your-domain.com;  # veya IP adresi

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Kaydet
```

**Aktifleştir:**
```bash
sudo ln -s /etc/nginx/sites-available/space-sonar-io /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Artık `http://your-domain.com` veya `http://your-vps-ip` ile erişebilirsin!

---

## 🔒 SSL/HTTPS Ekle (Önerilen)

```bash
# Certbot kur
sudo apt install certbot python3-certbot-nginx -y

# SSL sertifikası al
sudo certbot --nginx -d your-domain.com

# Otomatik yenileme
sudo certbot renew --dry-run
```

Artık `https://your-domain.com` ile güvenli erişim!

---

## 🛠️ Sorun Giderme

### MongoDB başlamıyor?
```bash
# Log'ları kontrol et
sudo journalctl -u mongod -f

# Config'i kontrol et
sudo nano /etc/mongod.conf

# Yeniden başlat
sudo systemctl restart mongod
```

### Bağlantı hatası?
```bash
# MongoDB dinliyor mu?
sudo netstat -tuln | grep 27017

# Firewall kontrolü
sudo ufw status
sudo ufw allow 27017  # Dikkatli! Sadece gerekirse
```

### Disk doldu?
```bash
# MongoDB data klasörü boyutu
du -sh /var/lib/mongodb

# Eski log'ları temizle
sudo rm /var/log/mongodb/mongod.log.*
```

---

## 📊 MongoDB Yönetim Komutları

```bash
# MongoDB'ye bağlan
mongosh

# Tüm veritabanlarını göster
show dbs

# Oyun veritabanına geç
use space-sonar-io

# Tüm kullanıcıları göster
db.users.find().pretty()

# Kullanıcı sayısı
db.users.countDocuments()

# En yüksek skorlu kullanıcılar
db.users.find().sort({totalScore: -1}).limit(10)

# Kullanıcı sil (dikkatli!)
db.users.deleteOne({username: "test"})

# Tüm veritabanını sil (ÇOK DİKKATLİ!)
db.dropDatabase()
```

---

## 🎯 Production Checklist

**Deploy öncesi kontrol listesi:**

- [ ] MongoDB kurulu ve çalışıyor
- [ ] Authentication aktif (kullanıcı/şifre)
- [ ] Environment variables ayarlı
- [ ] PM2 ile otomatik başlatma aktif
- [ ] Nginx reverse proxy kurulu
- [ ] SSL sertifikası kurulu (HTTPS)
- [ ] Firewall kuralları ayarlı
- [ ] MongoDB backup sistemi kurulu
- [ ] Log rotation aktif
- [ ] Server monitoring kurulu

---

## 💾 Yedekleme (Backup)

**Manuel yedek:**
```bash
# Tüm veritabanını yedekle
mongodump --db=space-sonar-io --out=/backup/mongodb/$(date +%Y%m%d)

# Geri yükle
mongorestore --db=space-sonar-io /backup/mongodb/20241030/space-sonar-io/
```

**Otomatik yedekleme (cron):**
```bash
# Crontab düzenle
crontab -e

# Her gün saat 3'te yedek al
0 3 * * * mongodump --db=space-sonar-io --out=/backup/mongodb/$(date +\%Y\%m\%d)

# Eski yedekleri sil (30 gün)
0 4 * * * find /backup/mongodb -type d -mtime +30 -exec rm -rf {} \;
```

---

## 🔍 Monitoring

**MongoDB durumu:**
```bash
# Servis durumu
sudo systemctl status mongod

# Gerçek zamanlı log
sudo tail -f /var/log/mongodb/mongod.log

# PM2 ile oyun durumu
pm2 status
pm2 monit
```

**Performans:**
```bash
mongosh

# DB stats
use space-sonar-io
db.stats()

# Server stats
db.serverStatus()

# Connection sayısı
db.serverStatus().connections
```

---

## 🌐 Uzaktan Bağlantı (Gerekirse)

**1. MongoDB Config:**
```bash
sudo nano /etc/mongod.conf

# Değiştir:
net:
  bindIp: 0.0.0.0  # Tüm IP'lerden erişim
  port: 27017
```

**2. Firewall:**
```bash
sudo ufw allow 27017
```

**3. Bağlantı String:**
```javascript
mongodb://username:password@your-vps-ip:27017/space-sonar-io
```

**⚠️ GÜVENLİK UYARISI:**
- Asla authentication olmadan 0.0.0.0 açma!
- Güçlü şifre kullan
- Firewall kuralları kur
- SSL/TLS kullan (production'da)

---

## 🎮 Oyunu Başlat

```bash
cd /var/www/space-sonar-io

# Environment variable ile başlat
export MONGODB_URI="mongodb://localhost:27017/space-sonar-io"
export PORT=3000

# PM2 ile başlat
pm2 start server.js --name "space-sonar-io"

# Veya direkt
npm start
```

**Tarayıcıdan test:**
```
http://your-vps-ip:3000
```

---

## 🚨 Hızlı Kurulum (Tek Komut)

**Basit kurulum (Ubuntu 22.04):**
```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor && \
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list && \
sudo apt update && \
sudo apt install -y mongodb-org && \
sudo systemctl start mongod && \
sudo systemctl enable mongod && \
echo "MongoDB kurulumu tamamlandı!"
```

---

## 📝 Özet Komutlar

```bash
# Kurulum
sudo apt update
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org

# Başlat
sudo systemctl start mongod
sudo systemctl enable mongod

# Kontrol
sudo systemctl status mongod
mongosh

# PM2 ile oyun başlat
cd /var/www/space-sonar-io
pm2 start server.js --name "space-sonar-io"
```

---

## 🎯 VPS Önerilen Specs

**Minimum:**
- 1 CPU Core
- 2GB RAM
- 20GB Disk
- Ubuntu 20.04+

**Önerilen:**
- 2 CPU Cores
- 4GB RAM
- 40GB SSD
- Ubuntu 22.04 LTS

**100+ oyuncu için:**
- 4 CPU Cores
- 8GB RAM
- 80GB SSD
- Load balancer

---

## 📞 Destek

**Hata alırsan:**

1. **Log'ları kontrol et:**
```bash
sudo journalctl -u mongod -n 50
pm2 logs space-sonar-io
```

2. **Yeniden başlat:**
```bash
sudo systemctl restart mongod
pm2 restart space-sonar-io
```

3. **Servis durumu:**
```bash
sudo systemctl status mongod
pm2 status
```

---

## ✅ Kurulum Sonrası Test

```bash
# 1. MongoDB çalışıyor mu?
sudo systemctl status mongod

# 2. Bağlantı test
mongosh

# 3. Oyun sunucusu çalışıyor mu?
pm2 status

# 4. Port dinliyor mu?
sudo netstat -tuln | grep 3000

# 5. Tarayıcıdan test
curl http://localhost:3000
```

**Başarılı ise:**
- MongoDB: ✅ active (running)
- PM2: ✅ online
- Port 3000: ✅ LISTEN
- Web: ✅ HTML döner

---

## 🚀 Production Deployment

```bash
# 1. MongoDB kur (yukarıdaki adımlar)
# 2. Node.js kur
# 3. PM2 kur
# 4. Nginx kur
# 5. SSL kur
# 6. Environment variables ayarla
# 7. PM2 ile başlat
# 8. Nginx proxy ayarla
# 9. DNS ayarla (domain için)
# 10. Test et!
```

**Deployment komutu:**
```bash
cd /var/www/space-sonar-io
git pull
npm install
pm2 restart space-sonar-io
```

---

## 🎊 Tamamlandı!

MongoDB kuruldu ve oyun hazır! 🎮

**Test URL'leri:**
- Local: `http://localhost:3000`
- VPS: `http://your-vps-ip:3000`
- Domain: `http://your-domain.com` (Nginx ile)
- HTTPS: `https://your-domain.com` (SSL ile)

**Artık:**
- ✅ Kullanıcılar kayıt olabilir
- ✅ Şifreler güvenli (bcrypt)
- ✅ İlerleme veritabanında
- ✅ Herhangi bir cihazdan giriş
- ✅ Online multiplayer hazır!

İyi oyunlar! 🚀🎮

