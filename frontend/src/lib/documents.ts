import { API_BASE_URL, getToken } from './api';
import { translateServerMessage } from './serverMessages';

// CC-085 (R1.5): opens a printed document (PDF, in the user's language) in a new tab. The tab is opened at the click so
// the browser does not block it; the file is fetched with the session token. A server without PDF output (HTTP 503)
// falls back to the print view (HTML), which the browser prints. Every export is recorded by the server.
export async function openDocument(type: 'ipc' | 'subcontract-certificate', id: number, lang: 'ar' | 'en'): Promise<void> {
  const tab = window.open('', '_blank');
  const get = (format: 'pdf' | 'html') => fetch(`${API_BASE_URL}/documents/${type}/${id}?format=${format}&lang=${lang}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  try {
    let res = await get('pdf');
    if (res.status === 503) res = await get('html');
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(translateServerMessage(payload?.error ?? `API request failed: ${res.status}`));
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
