// ApplyPilot — service worker : ouverture du panneau latéral + relais « mémoire des réponses » vers le serveur.
const DEFAULT_SERVER = 'http://127.0.0.1:4317';

async function serverUrl() {
  const { serverUrl: url } = await chrome.storage.local.get('serverUrl');
  return (url || DEFAULT_SERVER).replace(/\/+$/, '');
}

function enablePanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ap:memory') return false;
  (async () => {
    try {
      const { activeAppCompany } = await chrome.storage.local.get('activeAppCompany');
      const res = await fetch(`${await serverUrl()}/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: msg.items || [], company: activeAppCompany || '' }),
      });
      const data = await res.json();
      chrome.runtime.sendMessage({ type: 'ap:memorySaved', added: data.added, total: data.total }).catch(() => {});
      sendResponse({ ok: res.ok, ...data });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
