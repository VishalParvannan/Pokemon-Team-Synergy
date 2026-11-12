// Reusable DOM helpers and form controls. Browser-only; exposes a global `UI`.
const UI = (function () {
  const { clampInt } = PokeLogic;
  const formatName = PokeTeam.pretty;

  const TYPE_COLORS = {
    normal: "#A8A878", fire: "#F08030", water: "#6890F0", electric: "#F8D030",
    grass: "#78C850", ice: "#98D8D8", fighting: "#C03028", poison: "#A040A0",
    ground: "#E0C068", flying: "#A890F0", psychic: "#F85888", bug: "#A8B820",
    rock: "#B8A038", ghost: "#705898", dark: "#705848", steel: "#B8B8D0",
    dragon: "#7038F8", fairy: "#EE99AC"
  };
  // Type badges use white text; these light backgrounds need dark text for contrast
  const DARK_TEXT_TYPES = new Set(["electric", "ground", "ice", "steel", "fairy", "normal", "grass", "bug", "flying"]);

  // API data is untrusted: escape before putting it into HTML
  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function safeSprite(url) {
    return typeof url === "string" && /^https:\/\//.test(url) ? url : "";
  }

  function spriteImg(url, size, extra = "") {
    const src = safeSprite(url);
    return src
      ? `<img src="${esc(src)}" style="width:${size}px; height:${size}px; image-rendering:pixelated; ${extra}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'tab-icon-placeholder',style:'width:${size}px;height:${size}px'}))" />`
      : `<div class="tab-icon-placeholder" style="width:${size}px; height:${size}px; ${extra}" aria-hidden="true"></div>`;
  }

  function typeBadge(t) {
    const color = TYPE_COLORS[t] || "#777";
    return `<span class="type-badge" style="background:${color}; color:${DARK_TEXT_TYPES.has(t) ? "#111827" : "#fff"}">${esc(t)}</span>`;
  }

  function setStatus(message) {
    const el = document.getElementById("statusMessage");
    if (el) el.textContent = message;
  }

  let controlId = 0;
  const nextId = () => `ctl-${++controlId}`;

  function createDropdown(label, options, selectedValue, onChange, opts = {}) {
    const box = document.createElement("div");
    box.className = "field";
    const id = nextId();
    const lbl = document.createElement("label");
    lbl.className = "selector-label";
    lbl.htmlFor = id;
    lbl.textContent = label;
    box.appendChild(lbl);

    const select = document.createElement("select");
    select.id = id;
    select.className = "ev-input wide-input";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = `-- Select ${label} --`;
    select.appendChild(defaultOpt);
    options.forEach(optVal => {
      const opt = document.createElement("option");
      opt.value = optVal;
      opt.textContent = formatName(optVal) + (opts.hidden && opts.hidden.includes(optVal) ? " (hidden)" : "");
      if (optVal === selectedValue) opt.selected = true;
      select.appendChild(opt);
    });
    // A saved value that is not offered any more (e.g. after a format change) stays visible
    if (selectedValue && !options.includes(selectedValue)) {
      const opt = document.createElement("option");
      opt.value = selectedValue;
      opt.textContent = `${formatName(selectedValue)} (unavailable)`;
      opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = (e) => onChange(e.target.value);
    box.appendChild(select);
    return box;
  }

  // Rank options for a query: prefix matches first, then word-start, then substring
  function searchOptions(options, query, limit = 8) {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    if (!q) return [];
    const scored = [];
    for (const opt of options) {
      const idx = opt.indexOf(q);
      if (idx === -1) continue;
      const rank = idx === 0 ? 0 : opt[idx - 1] === "-" ? 1 : 2;
      scored.push({ opt, rank });
    }
    scored.sort((a, b) => a.rank - b.rank || a.opt.length - b.opt.length || a.opt.localeCompare(b.opt));
    return scored.slice(0, limit).map(x => x.opt);
  }

  // Text box that suggests the best matches as you type (keyboard and screen-reader operable)
  function createSearchBox(label, options, selectedValue, onChange, clearable = false, hint = "") {
    const box = document.createElement("div");
    box.className = "field search-field";
    const id = nextId();
    const listId = `${id}-list`;

    const lbl = document.createElement("label");
    lbl.className = "selector-label";
    lbl.htmlFor = id;
    lbl.textContent = label;
    box.appendChild(lbl);

    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.className = "ev-input wide-input";
    input.placeholder = `Search ${label.toLowerCase()}…`;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);
    box.appendChild(input);

    const list = document.createElement("ul");
    list.id = listId;
    list.className = "search-results";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", `${label} suggestions`);
    list.hidden = true;
    box.appendChild(list);

    if (selectedValue) {
      const chip = document.createElement("div");
      chip.className = "search-selected";
      const text = document.createElement("span");
      text.textContent = `Selected: ${formatName(selectedValue)}`;
      chip.appendChild(text);
      if (clearable) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "search-clear";
        clear.textContent = "Clear";
        clear.setAttribute("aria-label", `Clear ${label}`);
        clear.onclick = () => onChange("");
        chip.appendChild(clear);
      }
      box.appendChild(chip);
    }
    if (hint) {
      const h = document.createElement("div");
      h.className = "field-hint";
      h.textContent = hint;
      box.appendChild(h);
    }

    let matches = [];
    let active = -1;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
    const choose = (val) => { close(); input.value = ""; onChange(val); };
    const highlight = () => {
      Array.from(list.children).forEach((li, i) => { li.classList.toggle("active", i === active); li.setAttribute("aria-selected", String(i === active)); });
      if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
      else input.removeAttribute("aria-activedescendant");
    };
    const refresh = () => {
      matches = searchOptions(options, input.value);
      list.innerHTML = "";
      if (!input.value.trim()) { close(); return; }
      if (matches.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = options.length ? "No matches" : "Nothing to choose from";
        list.appendChild(li);
      }
      matches.forEach((m, i) => {
        const li = document.createElement("li");
        li.id = `${listId}-${i}`;
        li.setAttribute("role", "option");
        li.textContent = formatName(m);
        li.onmousedown = (e) => { e.preventDefault(); choose(m); };
        list.appendChild(li);
      });
      active = matches.length ? 0 : -1;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight();
    };

    input.oninput = refresh;
    input.onblur = close;
    input.onkeydown = (e) => {
      if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); active = (active + 1) % matches.length; highlight(); }
      else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; highlight(); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(matches[active]); }
      else if (e.key === "Escape") { close(); }
    };
    return box;
  }

  function createNumberField(label, value, min, max, onChange) {
    const box = document.createElement("div");
    box.className = "field";
    const id = nextId();
    box.innerHTML = `
      <label class="selector-label" for="${id}">${esc(label)}</label>
      <input id="${id}" type="number" class="ev-input wide-input" min="${min}" max="${max}" value="${value}" />
    `;
    const input = box.querySelector("input");
    input.onchange = () => {
      const v = clampInt(input.value, min, max);
      input.value = v;
      onChange(v);
    };
    return box;
  }

  return { TYPE_COLORS, esc, safeSprite, spriteImg, typeBadge, setStatus, createDropdown, searchOptions, createSearchBox, createNumberField, formatName };
})();
