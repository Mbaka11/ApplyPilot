// Petits widgets qui imitent le comportement de Workday / React pour les tests.
window.Mock = (() => {
  /** Champ « contrôlé » façon React : la valeur revient à l'état tant qu'aucun événement input ne l'a changé. */
  function controlled(input) {
    let state = input.value;
    input.addEventListener('input', () => {
      state = input.value;
    });
    setInterval(() => {
      if (input.value !== state) input.value = state;
    }, 20);
  }

  function closeAll() {
    document.querySelectorAll('.popup').forEach((p) => p.remove());
    document.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });

  /** Bouton liste déroulante (portail en fin de body), comme les « Select One » de Workday. */
  function dropdown(btn, options, onChange) {
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.type = 'button';
    if (!btn.textContent.trim()) btn.textContent = 'Select One';
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true') return closeAll();
      closeAll();
      const ul = document.createElement('ul');
      ul.className = 'popup';
      ul.setAttribute('role', 'listbox');
      for (const o of options) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = o;
        li.addEventListener('click', () => {
          btn.textContent = o;
          closeAll();
          onChange?.(o);
        });
        ul.appendChild(li);
      }
      document.body.appendChild(ul);
      btn.setAttribute('aria-expanded', 'true');
    });
  }

  /** Champ « prompt » Workday : saisie + Entrée → options ; clic → pastille sélectionnée. */
  function prompt(container, options, { multi = false } = {}) {
    const input = container.querySelector('input');
    const list = container.querySelector('[data-automation-id="selectedItemList"]');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.keyCode !== 13) return; // Workday vérifie aussi keyCode
      e.preventDefault();
      closeAll();
      const q = input.value.toLowerCase();
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.setAttribute('role', 'listbox');
      for (const o of options.filter((x) => x.toLowerCase().includes(q))) {
        const div = document.createElement('div');
        div.setAttribute('data-automation-id', 'promptOption');
        div.setAttribute('data-automation-label', o);
        div.setAttribute('role', 'option');
        div.textContent = o;
        div.addEventListener('click', () => {
          if (!multi) list.innerHTML = '';
          const li = document.createElement('li');
          li.setAttribute('role', 'listitem');
          li.setAttribute('data-automation-id', 'selectedItem');
          li.textContent = o;
          list.appendChild(li);
          input.value = '';
          closeAll();
        });
        popup.appendChild(div);
      }
      document.body.appendChild(popup);
    });
  }

  /** Construit un champ Workday standard. */
  function field(parent, { id, label, html }) {
    const div = document.createElement('div');
    div.setAttribute('data-automation-id', `formField-${id}`);
    div.innerHTML = `<label>${label}</label>${html}`;
    parent.appendChild(div);
    return div;
  }

  function promptField(parent, id, label, options, opts) {
    const f = field(parent, {
      id,
      label,
      html: `<div data-automation-id="multiselectInputContainer"><ul data-automation-id="selectedItemList"></ul><input type="text" data-uxi-widget-type="selectinput" placeholder="Search"></div>`,
    });
    prompt(f, options, opts);
    return f;
  }

  function dropdownField(parent, id, label, options, onChange) {
    const f = field(parent, { id, label, html: `<button data-automation-id="${id}">Select One</button>` });
    dropdown(f.querySelector('button'), options, onChange);
    return f;
  }

  function dateField(parent, id, label, { month = true } = {}) {
    return field(parent, {
      id,
      label,
      html: `<div data-automation-id="dateInputWrapper">${month ? '<input type="text" data-automation-id="dateSectionMonth-input" role="spinbutton" placeholder="MM">' : ''}<input type="text" data-automation-id="dateSectionYear-input" role="spinbutton" placeholder="YYYY"></div>`,
    });
  }

  return { controlled, dropdown, prompt, field, promptField, dropdownField, dateField, closeAll };
})();
