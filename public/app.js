// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
const editor = document.querySelector('#composer');
if (editor) {
  let timer, sequence = 0;
  const preview = async () => {
    const current = ++sequence;
    try {
      const response = await fetch('/preview', { method: 'POST', body: new URLSearchParams(new FormData(editor)) });
      if (!response.ok) throw new Error('Preview unavailable. Save your draft and check your session.');
      const html = await response.text();
      if (current === sequence) { document.querySelector('#preview').srcdoc = html; document.querySelector('#preview-status').textContent = 'Preview uses a sample reader. Remote images may load.'; }
    } catch (error) { document.querySelector('#preview-status').textContent = error.message; }
  };
  editor.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 300); });
  preview();
}
document.querySelector('#csv-file')?.addEventListener('change', async event => {
  const file = event.target.files[0];
  if (file && file.size <= 5 * 1024 * 1024) document.querySelector('#csv').value = await file.text();
  else document.querySelector('#file-note').textContent = 'Choose a CSV file smaller than 5 MB.';
});
const progress = document.querySelector('[data-campaign]');
if (progress) {
  const refresh = async () => {
    try {
      const response = await fetch(`/campaigns/${progress.dataset.campaign}/progress`);
      if (!response.ok) return;
      const value = await response.json();
      for (const [key, count] of Object.entries(value.counts)) { const node = document.querySelector(`[data-count="${key}"]`); if (node) node.textContent = count; }
      document.querySelector('#campaign-status').textContent = value.status;
      document.querySelector('progress').value = value.counts.total - value.counts.pending - value.counts.inflight;
      if (value.status === 'sending') setTimeout(refresh, 2000);
    } catch { document.querySelector('#campaign-status').textContent = 'Connection interrupted. Refresh to reconnect.'; }
  };
  refresh();
}
