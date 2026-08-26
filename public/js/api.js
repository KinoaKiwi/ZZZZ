/* Thin fetch wrapper: JSON in, JSON out, errors as thrown Error with a French message. */

async function request(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };

  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Serveur injoignable.');
  }

  if (response.status === 204) return {};

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erreur ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),

  /** Upload with progress, since fetch cannot report it. */
  upload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        let payload = {};
        try { payload = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(payload.error || `Erreur ${xhr.status}.`));
      });
      xhr.addEventListener('error', () => reject(new Error('Envoi interrompu.')));
      xhr.send(formData);
    });
  },
};

export const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const str = search.toString();
  return str ? `?${str}` : '';
};
