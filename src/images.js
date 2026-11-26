import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

// --- BILDER: EINFÜGEN, VERKLEINERN & IN FIRESTORE SPEICHERN ---
// Eingefügte Bilder werden im Browser verkleinert und als eigener Eintrag in der
// Sammlung "quiz_images" gespeichert. In der Frage steht nur ein kurzer Verweis
// ("fsimg:<id>"), damit das Quiz selbst klein bleibt (Firestore-Limit: 1 MB pro Eintrag).
export const FS_IMG_PREFIX = 'fsimg:';

export const MAX_IMG_CHARS = 900000;
 // Sicherheitsabstand zum 1-MB-Limit
export const isFsImage = (url) => typeof url === 'string' && url.startsWith(FS_IMG_PREFIX);

export const imagePromiseCache = new Map();
 // id -> Promise<dataUrl|null>
export const imageDataCache = new Map();
    // id -> dataUrl (bereits geladen)

export const fetchFsImage = (ref) => {
  const id = ref.slice(FS_IMG_PREFIX.length);
  if (!imagePromiseCache.has(id)) {
    const p = getDoc(doc(db, 'quiz_images', id))
      .then(snap => {
        const data = snap.exists() ? snap.data().data : null;
        if (data) imageDataCache.set(id, data);
        return data;
      })
      .catch(err => {
        console.error('Bild konnte nicht geladen werden:', err);
        imagePromiseCache.delete(id);
        return null;
      });
    imagePromiseCache.set(id, p);
  }
  return imagePromiseCache.get(id);
};

export const preloadImages = (questions) => {
  (questions || []).forEach(qq => { if (isFsImage(qq?.imgUrl)) fetchFsImage(qq.imgUrl); });
};

export const loadImageElement = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Die Datei ist kein lesbares Bild.')); };
  img.src = url;
});

export const compressImage = async (blob, maxW = 1920, maxH = 1080) => {
  const img = await loadImageElement(blob);
  let scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const qualities = [0.85, 0.75, 0.65, 0.5];
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of qualities) {
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality); // ältere Browser ohne WebP
      if (data.length <= MAX_IMG_CHARS) return { data, width: w, height: h };
    }
    scale *= 0.75;
  }
  throw new Error('Das Bild ist auch verkleinert noch zu groß.');
};

export const uploadQuizImage = async (blob) => {
  const { data, width, height } = await compressImage(blob);
  const ref = doc(collection(db, 'quiz_images'));
  const createdAt = Date.now();
  await setDoc(ref, { data, width, height, createdAt });
  // kleiner Index-Eintrag, damit das Aufräumen nicht alle Bilder herunterladen muss
  setDoc(doc(db, 'quiz_image_meta', ref.id), { createdAt, bytes: data.length }).catch(err => console.warn('Bild-Index nicht gespeichert:', err));
  imageDataCache.set(ref.id, data);
  imagePromiseCache.set(ref.id, Promise.resolve(data));
  return FS_IMG_PREFIX + ref.id;
};

// Holt ein Bild aus der Zwischenablage – außer es wurde eindeutig ein Link kopiert.
export const getImageFromClipboard = (e) => {
  const cd = e.clipboardData;
  if (!cd) return null;
  const text = (cd.getData('text/plain') || '').trim();
  if (/^(https?:\/\/|\/)\S+$/i.test(text)) return null;
  for (const item of Array.from(cd.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
};

export const useResolvedImage = (src) => {
  const initial = isFsImage(src) ? (imageDataCache.get(src.slice(FS_IMG_PREFIX.length)) || null) : src;
  const [resolved, setResolved] = useState(initial);
  useEffect(() => {
    if (!isFsImage(src)) { setResolved(src); return; }
    const cached = imageDataCache.get(src.slice(FS_IMG_PREFIX.length));
    if (cached) { setResolved(cached); return; }
    let alive = true;
    setResolved(null);
    fetchFsImage(src).then(d => { if (alive) setResolved(d); });
    return () => { alive = false; };
  }, [src]);
  return resolved;
};

// --- AUFRÄUMEN: ungenutzte Bilder finden & löschen ---
const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000; // frisch eingefügte Bilder 24 h lang nie löschen

const collectUsedImageIds = async () => {
  const used = new Set();
  const add = (qs) => (qs || []).forEach(q => { if (isFsImage(q?.imgUrl)) used.add(q.imgUrl.slice(FS_IMG_PREFIX.length)); });
  const [tpl, rooms] = await Promise.all([getDocs(collection(db, 'quiz_templates')), getDocs(collection(db, 'rooms'))]);
  tpl.docs.forEach(d => add(d.data().questions));
  rooms.docs.forEach(d => add(d.data().questions));
  return used;
};

// deep = true: lädt einmalig alle Bilder, um ältere (noch nicht erfasste) Bilder in den Index aufzunehmen
export const scanImages = async (deep = false) => {
  const used = await collectUsedImageIds();
  const metaSnap = await getDocs(collection(db, 'quiz_image_meta'));
  const meta = new Map(metaSnap.docs.map(d => [d.id, d.data()]));
  let added = 0;
  if (deep) {
    const all = await getDocs(collection(db, 'quiz_images'));
    const missing = all.docs.filter(d => !meta.has(d.id)).map(d => [d.id, { createdAt: d.data().createdAt || 0, bytes: (d.data().data || '').length }]);
    for (let i = 0; i < missing.length; i += 450) {
      const b = writeBatch(db);
      missing.slice(i, i + 450).forEach(([id, info]) => b.set(doc(db, 'quiz_image_meta', id), info));
      await b.commit();
    }
    missing.forEach(([id, info]) => meta.set(id, info));
    added = missing.length;
  }
  const now = Date.now();
  const entries = [...meta.entries()];
  const unused = entries.filter(([id, m]) => !used.has(id) && now - (m.createdAt || 0) > IMAGE_GRACE_MS);
  return {
    total: entries.length,
    used: entries.filter(([id]) => used.has(id)).length,
    unused,
    unusedBytes: unused.reduce((sum, [, m]) => sum + (m.bytes || 0), 0),
    recentUnused: entries.filter(([id, m]) => !used.has(id) && now - (m.createdAt || 0) <= IMAGE_GRACE_MS).length,
    deep,
    added,
  };
};

export const deleteImages = async (ids) => {
  for (let i = 0; i < ids.length; i += 200) {
    const b = writeBatch(db);
    ids.slice(i, i + 200).forEach(id => {
      b.delete(doc(db, 'quiz_images', id));
      b.delete(doc(db, 'quiz_image_meta', id));
      imageDataCache.delete(id);
      imagePromiseCache.delete(id);
    });
    await b.commit();
  }
};
