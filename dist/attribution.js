(function (root) {
  const clean = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) : '';
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const result = {};
    for (const key of ['source', 'medium', 'campaign', 'content', 'term']) result[key] = clean(raw[key]);
    result.referrer = '';
    try { const ref = typeof raw.referrer === 'string' ? raw.referrer : ''; const url = new URL(/^[a-z0-9.-]+$/i.test(ref) ? `https://${ref}` : ref); if (/^https?:$/.test(url.protocol)) result.referrer = url.hostname.toLowerCase().slice(0, 160); } catch (_) {}
    // Only a classification is retained; advertising click identifiers are never stored.
    result.googleAds = raw.googleAds === true;
    return result;
  }
  function label(raw) {
    if (!raw) return 'Origem não registrada';
    const source = String(raw.source || '').toLowerCase();
    const referrer = String(raw.referrer || '').toLowerCase();
    const paid = /^(cpc|ppc|paid|paid_social|paid_search|display|cpm)$/.test(String(raw.medium || '').toLowerCase());
    if (raw.googleAds || (source === 'google' && paid)) return 'Google Ads';
    if (/^(instagram|ig)$/.test(source)) return paid ? 'Instagram · anúncio' : 'Instagram';
    if (/^(facebook|fb|meta)$/.test(source)) return paid ? 'Meta · anúncio' : 'Facebook / Meta';
    if (source === 'google') return 'Google';
    if (source) return raw.source;
    if (/(^|\.)google\.(com|com\.br|co\.uk|pt|es|fr|de|ca)$/.test(referrer)) return 'Google · busca orgânica';
    if (/(^|\.)instagram\.com$/.test(referrer)) return 'Instagram';
    if (/(^|\.)facebook\.com$/.test(referrer)) return 'Facebook';
    return referrer || 'Direto / sem referência';
  }
  const api = { normalize, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.motorizeAttribution = api;
})(typeof window !== 'undefined' ? window : globalThis);
