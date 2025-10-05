export async function downloadFile(url: string, filename = 'image.png') {
  try {
    // data: URL ise direkt indir
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    // GCS signed URL ise backend proxy'yi kullan
    const isGcs = url.startsWith('https://storage.googleapis.com/');
    const downloadUrl = isGcs
      ? `http://localhost:3001/proxy-download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      : url;

    const res = await fetch(downloadUrl, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('downloadFile error:', err);
  }
}
