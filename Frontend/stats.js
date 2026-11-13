// Saved teams page: reads the builder's local store (read-only except for "Open in builder").
(function () {
  const { esc, spriteImg, formatName } = UI;
  const STORE_KEY = "pokemonTeamSynergy.v2";
  const list = document.getElementById("teamsList");
  const isFormatId = (id) => PokeFormats.FORMATS.some(f => f.id === id);

  let store = null;
  try { store = PokeTeam.sanitizeStore(JSON.parse(localStorage.getItem(STORE_KEY)), isFormatId); } catch (err) { store = null; }

  if (!store) {
    list.innerHTML = `<p class="sub-text">No saved teams yet. <a href="index.html">Build one in the team builder.</a></p>`;
    return;
  }

  store.teams.forEach(team => {
    const members = team.slots.filter(s => s.name);
    // Saved teams don't keep earlier typings, so current types are used with the format's chart
    const summary = PokeAnalysis.defensiveSummary(members, PokeFormats.findFormat(team.format.id).era);
    const shared = PokeAnalysis.sharedWeaknesses(summary).filter(s => s.answers.length < s.weakNames.length);
    const card = document.createElement("article");
    card.className = "team-summary";
    card.innerHTML = `
      <h2>${esc(team.name)}${team.id === store.activeTeamId ? " <small class='sub-text'>(open in builder)</small>" : ""}</h2>
      <p class="sub-text">${esc(PokeFormats.findFormat(team.format.id).name)} · ${members.length}/6 Pokémon</p>
      <div class="members">${members.map(m => `<span class="member">${spriteImg(m.sprite, 32)} ${esc(formatName(m.name))}</span>`).join("") || "<span class='sub-text'>Empty team</span>"}</div>
      <p class="sub-text" style="margin-top:10px;">${shared.length
        ? "Types hitting more members than can take them: " + shared.map(s => `${esc(formatName(s.type))} (${s.weakNames.length} weak, ${s.answers.length} answer${s.answers.length === 1 ? "" : "s"})`).join(", ")
        : members.length ? "No type hits more members than the team can resist or ignore." : ""}</p>`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "small-button";
    open.textContent = "Open in builder";
    open.onclick = () => {
      store.activeTeamId = team.id;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(PokeTeam.serializeStore(store))); } catch (err) { /* open anyway */ }
      location.href = "index.html";
    };
    card.appendChild(open);
    list.appendChild(card);
  });
})();
