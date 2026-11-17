/* ===================================================================
   GRACIANUS — Web Worker for non-blocking JSON fetch, parse & indexing
   =================================================================== */

function normalizeStr(str) {
  if (!str) return '';
  return String(str).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeEstructura(db) {
  if (!db || !db.estructura || !db.canones) return;
  const map = new Map();
  db.canones.forEach(c => map.set(c.numero, c));

  db.estructura.forEach(libro => {
    const hasEmptyTitle = (libro.titulos || []).some(t => !t.nombre || t.nombre.trim() === '');
    if (!hasEmptyTitle) return;

    const newTitulos = [];
    const seenTitles = new Map();

    (libro.titulos || []).forEach(t => {
      if (!t.nombre || t.nombre.trim() === '') {
        (t.canones || []).forEach(num => {
          const c = map.get(num);
          if (!c) return;
          const titName = (c.titulo || c.capitulo || 'Cánones Generales').trim();
          const key = titName.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
          if (!seenTitles.has(key)) {
            const groupObj = { nombre: titName, canones: [] };
            seenTitles.set(key, groupObj);
            newTitulos.push(groupObj);
          }
          seenTitles.get(key).canones.push(num);
        });
      } else {
        const titName = t.nombre.trim();
        const key = titName.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
        if (!seenTitles.has(key)) {
          const groupObj = { nombre: titName, canones: [] };
          seenTitles.set(key, groupObj);
          newTitulos.push(groupObj);
        }
        (t.canones || []).forEach(num => {
          if (!seenTitles.get(key).canones.includes(num)) {
            seenTitles.get(key).canones.push(num);
          }
        });
      }
    });

    libro.titulos = newTitulos;
  });
}

self.onmessage = async (e) => {
  const jsonUrl = (e.data && e.data.jsonUrl) || './data_multilingue_final.json';
  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loaded = await res.json();

    const db = Array.isArray(loaded) ? { estructura: [], canones: loaded } : loaded;
    if (!Array.isArray(db.canones)) {
      throw new Error('Formato inválido en data_multilingue_final.json: falta el array canones.');
    }

    if (Array.isArray(db.estructura) && db.estructura.length > 0) {
      normalizeEstructura(db);
    }

    // Precompute accent-stripped search fields off the main thread
    db.canones.forEach(c => {
      if (!c) return;
      c._qTexto = normalizeStr(c.texto);
      c._qTemas = Array.isArray(c.temas) ? c.temas.map(normalizeStr) : [];
    });

    self.postMessage({ ok: true, db });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
