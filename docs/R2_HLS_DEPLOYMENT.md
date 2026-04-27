# Tarmoq Academy: Cloudflare R2 + HLS Deployment

## 1. Cloudflare R2 tayyorlash

Cloudflare dashboardda R2 bucket yarating va API token oling. Bucket uchun Public URL yoki custom CDN domain ulang.

Backend `.env`:

```env
API_PUBLIC_URL=https://api.tarmoqacademy.uz
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=tarmoq-videos
R2_PUBLIC_URL=https://cdn.tarmoqacademy.uz
VIDEO_TOKEN_SECRET=long_random_secret
VIDEO_TOKEN_TTL=2h
VIDEO_ALLOWED_ORIGINS=https://tarmoqacademy.uz,https://www.tarmoqacademy.uz,https://api.tarmoqacademy.uz
R2_SEGMENT_URL_TTL_SECONDS=3600
```

## 2. VPS paketlari

MobaXterm orqali VPS ga kiring:

```bash
sudo apt update
sudo apt install -y ffmpeg
cd /var/www/backend
npm install
```

ffmpeg tekshirish:

```bash
ffmpeg -version
```

## 3. PM2 restart

```bash
pm2 restart backend
pm2 logs backend
```

Agar app hali PM2 da yo'q bo'lsa:

```bash
pm2 start server.js --name backend
pm2 save
```

## 4. Nginx config

API proxy:

```nginx
server {
    server_name api.tarmoqacademy.uz;

    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

Apply:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Admin upload oqimi

1. Admin panelda dars yarating yoki mavjud darsni tahrirlang.
2. `MP4 video yuklash (R2 + HLS)` maydonidan `.mp4` tanlang.
3. Backend ffmpeg orqali `360p`, `720p`, `1080p` HLS yaratadi.
4. Fayllar R2 ga quyidagi path bilan yuklanadi:

```text
courses/{courseId}/lessons/{lessonId}/master.m3u8
courses/{courseId}/lessons/{lessonId}/360/index.m3u8
courses/{courseId}/lessons/{lessonId}/720/index.m3u8
courses/{courseId}/lessons/{lessonId}/1080/index.m3u8
courses/{courseId}/lessons/{lessonId}/{quality}/segment_00001.ts
```

## 6. Eski MP4 videolarni migratsiya qilish

Barcha lokal `/uploads/videos` MP4 videolar:

```bash
npm run migrate:videos:hls
```

Bitta dars:

```bash
node scripts/migrateVideosToR2Hls.js --lessonId=LESSON_ID
```

Xatolik bo'lsa ham davom etish:

```bash
MIGRATION_CONTINUE_ON_ERROR=true npm run migrate:videos:hls
```

## 7. Security modeli

Frontend video uchun avval:

```text
GET /api/videos/lessons/:lessonId/playback-url
Authorization: Bearer JWT
```

Backend foydalanuvchi kursga yozilganini tekshiradi va qisqa muddatli HLS token beradi. Master/variant playlistlar backendda token orqali ochiladi, `.ts` segmentlar esa qisqa muddatli R2 presigned URL bilan to'g'ridan-to'g'ri R2/CDN orqali yuklanadi.

Qo'shimcha hotlink protection uchun tavsiya:

- Cloudflare custom domain ishlating: `cdn.tarmoqacademy.uz`
- Backend playlist endpointlarida `VIDEO_ALLOWED_ORIGINS` orqali Origin/Referer tekshiruv yoqilgan
- Cloudflare WAF rule qo'ying: referer `tarmoqacademy.uz` yoki `api.tarmoqacademy.uz` bo'lmagan requestlarni bloklash
- R2 bucketni public emas, faqat presigned URL orqali ishlatish eng xavfsiz variant
- `R2_SEGMENT_URL_TTL_SECONDS` ni 900-3600 oralig'ida ushlang

## 8. Performance

Bu architecture’da katta `.ts` segment trafik VPS’dan o'tmaydi. VPS faqat kichik `.m3u8` playlistlarni token bilan qayta yozadi. 100+ concurrent user uchun:

- API serverni PM2 cluster mode bilan yuring
- Nginx `proxy_read_timeout` upload/transcode uchun katta bo'lsin
- Cloudflare CDN cache segmentlarni edge’da ushlasin
- Upload/transcode server CPU’sini user-facing API’dan ajratish keyingi bosqichda foydali

PM2 cluster:

```bash
pm2 start server.js --name backend -i max
pm2 save
```

## 9. Cost optimization

- HLS segmentlarni immutable cache bilan saqlang.
- Keraksiz eski lesson video prefixlarini R2 lifecycle bilan o'chiring.
- Juda uzun videolarda `HLS_SEGMENT_SECONDS=8` yoki `10` qilib request sonini kamaytiring.
- Source MP4 fayllarni R2 da alohida arxivlash kerak bo'lmasa saqlamang.
- R2 egress bepul modelidan foydalanish uchun video segmentlarni R2/CDN orqali bering, VPS orqali proxy qilmang.
