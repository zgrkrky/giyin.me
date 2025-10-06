// Gerekli kütüphaneleri import ediyoruz
const express = require('express');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');




// ---------- AYARLAR ----------
const RAW_SA_B64 = process.env.GCP_SA_KEY_BASE64;
if (!RAW_SA_B64) {
  console.error('Missing env GCP_SA_KEY_BASE64');
  process.exit(1);
}
const saJson = JSON.parse(Buffer.from(RAW_SA_B64, 'base64').toString('utf8'));

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  credentials: {
    client_email: saJson.client_email,
    private_key: saJson.private_key,
  },
});
const bucketName = process.env.BUCKET_NAME;
const bucket = storage.bucket(bucketName);
const PORT = process.env.PORT || 3001;
const app = express();
// --------------------------------



// --- Middleware ---
const allowed = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// Ör: "https://giyin-me.onrender.com, http://localhost:5173"
// CORS
app.use(cors({
  origin: allowed.length ? allowed : true,
  credentials: true,
}));

// JSON bodies (generated image upload vs.)
app.use(express.json({ limit: '25mb' }));


// Multer (memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
// --- Health & root (opsiyonel ama faydalı) ---
app.get('/', (_req, res) => res.send('Backend OK'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

/**
 * /upload rotası:
 * Bu 'endpoint', ön yüzden gelen bir dosyayı alır ve GCS'e yükler.
 */
app.post('/upload', upload.single('user_image'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  // Yüklenecek dosya için yeni ve benzersiz bir isim oluşturuyoruz
  // ve 'user-uploads' klasörünün altına koyuyoruz.
  const blob = bucket.file(`user-uploads/${Date.now()}_${req.file.originalname}`);
  
  // Dosyayı GCS'e yazmak için bir 'stream' (akış) oluşturuyoruz
  const blobStream = blob.createWriteStream({
    resumable: false,
  });

  blobStream.on('error', (err) => {
    console.error('GCS Upload Error:', err);
    res.status(500).send({ message: err.message });
  });

  blobStream.on('finish', () => {
    // Dosyanın herkese açık URL'ini oluşturuyoruz
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
    console.log(`Dosya başarıyla yüklendi: ${publicUrl}`);
    res.status(200).send({
      message: 'File uploaded successfully.',
      url: publicUrl,
    });
  });

  // Dosya verisini stream'e yazarak yüklemeyi başlatıyoruz
  blobStream.end(req.file.buffer);
});
/**
 * /upload-garment rotası:
 * Kullanıcının kıyafet fotoğrafını GCS'e yükler.
 * Not: Bucket private ise aşağıdaki "signed URL" üretimini kullanırız (önerilen).
 */
app.post('/upload-garment', upload.single('garment_image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    // Kıyafetler için ayrı bir prefix kullanıyoruz
    const objectPath = `garment-uploads/${Date.now()}_${req.file.originalname}`;
    const file = bucket.file(objectPath);

    // Dosyayı yaz (meta ile)
    const blobStream = file.createWriteStream({
      resumable: false,
      metadata: {
        contentType: req.file.mimetype || 'application/octet-stream',
        cacheControl: 'public, max-age=31536000, immutable',
        contentDisposition: 'inline',
      },
    });

    blobStream.on('error', (err) => {
      console.error('GCS Upload Error (garment):', err);
      return res.status(500).send({ message: err.message });
    });

    blobStream.on('finish', async () => {
      try {
        // Bucket private ise: signed URL üret (7 gün)
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 gün
        });

        // (Bilgi amaçlı) public URL de hesaplıyoruz — bucket public değilse çalışmaz.
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

        console.log(`👕 Kıyafet yüklendi: ${objectPath}`);
        return res.status(200).send({
          message: 'Garment uploaded successfully.',
          url: signedUrl,          // <- Frontend bu alanı kullanabilir (signed URL)
          signedUrl,               // <- Aynı değer, isimli olarak da dönüyoruz
          publicUrl,               // <- Sadece bilgi amaçlı
          path: objectPath,        // <- İleride gerekirse yenileme için işine yarar
        });
      } catch (e) {
        console.error('Signed URL error (garment):', e);
        return res.status(500).send({ message: 'Failed to generate signed URL.' });
      }
    });

    blobStream.end(req.file.buffer);
  } catch (e) {
    console.error('Upload handler error (garment):', e);
    return res.status(500).send({ message: e.message });
  }
});
/**
 * /upload-generated:
 * AI'nin oluşturduğu görseli (data:image/...;base64,...) GCS'ye kaydeder.
 */
app.post('/upload-generated', async (req, res) => {
  try {
    // Body parser üstte global: app.use(express.json({ limit: '25mb' }))
    const { imageData } = req.body || {};
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).send('No image data provided.');
    }

    // "data:image/...;base64,..." → base64 kısmını ayıkla
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const filename = `user-generated-uploads/${Date.now()}.png`;
    const file = bucket.file(filename);

    await file.save(buffer, {
      metadata: { contentType: 'image/png' },
      resumable: false,
    });

    // Bucket private → signed URL
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });

    console.log(`🧠 Üretilen görsel yüklendi: ${filename}`);
    return res.status(200).json({
      message: 'Generated image uploaded successfully.',
      url: signedUrl,
      path: filename,
    });
  } catch (error) {
    console.error('GCS Upload Error (generated):', error);
    return res.status(500).json({ message: 'Failed to upload generated image.' });
  }
});
// GCS signed URL'i backend üzerinden indirip CORS sorununu çözen proxy
app.get('/proxy-download', async (req, res) => {
  try {
    const url = req.query.url;
    const filename = req.query.filename || 'image.png';
    if (!url) return res.status(400).send('Missing url');

    // Node 18+ ile global fetch var. Eski Node sürümünde node-fetch ekleyebilirsin.
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream error: ${upstream.statusText}`);
    }

    // İçerik tipi ve indirme başlığı
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream ederek kullanıcıya aktar
    if (upstream.body && upstream.body.pipe) {
      upstream.body.pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    }
  } catch (err) {
    console.error('Proxy download error:', err);
    res.status(500).send('Proxy failed');
  }
});

// Sunucuyu başlatıyoruz
app.listen(PORT, () => {
  console.log(`✅ Backend sunucusu http://localhost:${PORT} adresinde çalışıyor.`);
});

