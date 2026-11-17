/* ===================================================================
   GRACIANUS — Web Worker for recursive hierarchical tree & indexing
   =================================================================== */

const CHILD_LEVEL_KEYS = ['partes', 'secciones', 'titulos', 'capitulos', 'articulos'];

function normalizeStr(str) {
  if (!str) return '';
  return String(str).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getNodeLabel(node) {
  return String(
    node.nombre || node.libro || node.parte || node.seccion ||
    node.titulo || node.capitulo || node.articulo || 'Sin título'
  ).trim();
}

function normalizeTreeNode(node, pathPrefix, index) {
  if (!node || typeof node !== 'object') return null;

  const nodeId = `${pathPrefix}-${index}`;
  const directCanones = Array.isArray(node.canones) ? node.canones : [];
  const children = [];

  CHILD_LEVEL_KEYS.forEach((key) => {
    if (Array.isArray(node[key]) && node[key].length > 0) {
      node[key].forEach((child, childIdx) => {
        const normalizedChild = normalizeTreeNode(child, `${nodeId}-${key}`, childIdx);
        if (normalizedChild) {
          normalizedChild._levelType = key;
          children.push(normalizedChild);
        }
      });
    }
  });

  const childrenCanonCount = children.reduce((sum, ch) => sum + ch._totalCanones, 0);

  return {
    ...node,
    _id: nodeId,
    _label: getNodeLabel(node),
    _children: children,
    canones: directCanones,
    _totalCanones: directCanones.length + childrenCanonCount
  };
}

function normalizeEstructura(db) {
  if (!db || !Array.isArray(db.estructura)) return [];
  return db.estructura
    .map((libro, i) => normalizeTreeNode(libro, 'libro', i))
    .filter(Boolean);
}

self.onmessage = async (e) => {
  const jsonUrl = (e.data && e.data.jsonUrl) || './data_jerarquica_final.json';
  try {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loaded = await res.json();

    const db = Array.isArray(loaded) ? { estructura: [], canones: loaded } : loaded;
    if (!Array.isArray(db.canones)) {
      throw new Error('Formato inválido en data_jerarquica_final.json: falta el array canones.');
    }

    db.estructura = normalizeEstructura(db);

    // Precompute accent-stripped search fields off the main thread
    db.canones.forEach((c) => {
      if (!c) return;
      c._qTexto = normalizeStr(c.texto);
      c._qTemas = Array.isArray(c.temas) ? c.temas.map(normalizeStr) : [];
    });

    self.postMessage({ ok: true, db });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
