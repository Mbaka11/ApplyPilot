// Synthetic upload behavior, enabled explicitly by tests. Not captured SAP JavaScript.
window.sfUploads = { mode: 'normal', uploads: [], enabled: false, dialogButtons: 0 };
sfUploads.enable = () => {
  sfUploads.enabled = true;
  const decoy = document.createElement('input'); decoy.type = 'file'; decoy.id = 'unrelated-file'; decoy.hidden = true; document.body.append(decoy);
};
for (const [id, kind] of [['cv-trigger', 'cv'], ['letter-trigger', 'letter']]) document.getElementById(id).addEventListener('click', () => {
  if (!sfUploads.enabled) return;
  const show = () => {
    const dialog = document.createElement('div'); dialog.role = 'dialog'; dialog.id = 'upload-dialog';
    dialog.setAttribute('aria-label', 'Choisir la source de téléversement des pièces jointes');
    dialog.innerHTML = '<div><div><div><div><div><div><span><span id="upload-caption">Téléverser</span><input id="upload-file" type="file" accept=".pdf" aria-labelledby="upload-caption"></span></div></div></div></div></div></div><span role="button" tabindex="0">Téléverser depuis cet appareil</span><span role="button" tabindex="0">Autre source</span>';
    document.body.append(dialog);
    for(const button of dialog.querySelectorAll('[role="button"]')) button.addEventListener('click', () => sfUploads.dialogButtons++);
    const input = dialog.querySelector('input');
    if (sfUploads.mode === 'ambiguous') dialog.append(input.cloneNode());
    if (sfUploads.mode === 'non-pdf') input.accept = 'image/png';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      sfUploads.uploads.push({ kind, name: file.name, content: await file.text() });
      if (sfUploads.mode === 'hold') return;
      setTimeout(() => {
        dialog.remove();
        if (sfUploads.mode === 'reject') return;
        const targetId = sfUploads.mode === 'wrong-zone' ? (kind === 'cv' ? 'letter-label' : 'cv-label') : kind + '-label';
        const target = document.getElementById(targetId).parentElement;
        const name = document.createElement('a'); name.textContent = file.name; name.href = '#fixture-file'; target.append(name);
        if (sfUploads.mode === 'replace-trigger') document.getElementById(id).remove();
        if (sfUploads.mode === 'rollback') setTimeout(() => name.remove(), 120);
      }, 70);
    });
  };
  if(sfUploads.mode === 'delayed') setTimeout(show, 700); else show();
});
