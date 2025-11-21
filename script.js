
/*
  Pokémon TCG Level 1 — Browser version
  - Simplified card types: Pokemon (Basic/Stage1), Energy, Supporter, Item
  - Decks are 60 cards (sample composition)
  - Prize = 6 cards
  - Opening hand 7, mulligans up to 3 total
  - User must choose starting Active from bench
  - Player goes first always
  - One energy attached per turn (flag)
  - Pokémon can't evolve same turn they were played - enforce via 'bornTurn' timestamp
  - Supporter max 1 per turn, items unlimited
  - Simplified supporter/item effects implemented
  - Coin flip implemented where necessary
  - Win conditions implemented
*/

// ---------- Utilities ----------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }
function nowTurn() { return game.turnCounter; }

function log(msg) {
  const l = document.getElementById('log');
  l.textContent += '[' + formatTime() + '] ' + msg + '\n';
  l.scrollTop = l.scrollHeight;
}

function formatTime() {
  const d = new Date();
  return d.toLocaleTimeString();
}

function promptCoinChoice(user) {
  if (user === 'player') {
    // ask user via confirm-style (simplified): prompt dialog
    let choice = confirm("Choose coin: OK = Heads, Cancel = Tails.\n(Press OK for Heads, Cancel for Tails)");
    return choice ? 'heads' : 'tails';
  } else {
    return Math.random() < 0.5 ? 'heads' : 'tails';
  }
}

// ---------- Card factory ----------
function createPokemon(name, hp, attackName, damage, stage='Basic') {
  return {
    type: 'Pokemon',
    name, hp, maxHp: hp, attackName, damage,
    stage, energy: 0,
    bornTurn: null, // turnCounter when it entered play
    id: Math.random().toString(36).slice(2,9)
  };
}
function createEnergy() {
  return { type: 'Energy', id: Math.random().toString(36).slice(2,9) };
}
function createSupporter(name, effectFunc, requiresCoin=false) {
  return { type: 'Supporter', name, effectFunc, requiresCoin, id: Math.random().toString(36).slice(2,9) };
}
function createItem(name, effectFunc, requiresCoin=false) {
  return { type: 'Item', name, effectFunc, requiresCoin, id: Math.random().toString(36).slice(2,9) };
}

// ---------- Simple sample card effects ----------
/* Supporter examples:
   - Draw 3 cards
   - Add 2 energy to a Pokemon
   - Return a bench pokemon to hand
   - Discard 2 cards from hand
   Some supporters may require coin flip for success.
*/
function supporterDraw3(player) {
  log(player.name + ' played Supporter: Draw 3 cards.');
  for (let i=0;i<3;i++) playerDrawCard(player);
  player.supporterUsedThisTurn = true;
}
function supporterAdd2Energy(player) {
  // add 2 energy to active if present
  if (!player.active) {
    log(player.name + "'s supporter failed — no active Pokémon.");
    player.supporterUsedThisTurn = true;
    return;
  }
  player.active.energy += 2;
  log(player.name + ' played Supporter: Added 2 energy to ' + player.active.name + '.');
  player.supporterUsedThisTurn = true;
}
function supporterReturnBenchToHand(player) {
  if (player.bench.length === 0) {
    log(player.name + "'s supporter has no bench to return.");
    player.supporterUsedThisTurn = true;
    return;
  }
  const returned = player.bench.splice(0,1)[0];
  player.hand.push(returned);
  log(player.name + ' played Supporter: Returned ' + returned.name + ' from bench to hand.');
  player.supporterUsedThisTurn = true;
}
function supporterDiscard2(player) {
  // discard 2 random from hand if able
  if (player.hand.length === 0) { log(player.name + ' played Supporter but has no cards to discard.'); player.supporterUsedThisTurn = true; return; }
  for (let i=0;i<2 && player.hand.length>0;i++){
    const idx = Math.floor(Math.random() * player.hand.length);
    const c = player.hand.splice(idx,1)[0];
    player.discard.push(c);
    log(player.name + ' discarded ' + (c.type === 'Pokemon' ? c.name : c.type + ' card') + ' due to Supporter.');
  }
  player.supporterUsedThisTurn = true;
}

/* Item examples:
   - Draw 2 cards
   - Retrieve 1 card from discard (random)
   - Heal 30 HP from a Pokémon
   - Add 1 energy to active
*/
function itemDraw2(player) {
  log(player.name + ' played Item: Draw 2 cards.');
  for (let i=0;i<2;i++) playerDrawCard(player);
}
function itemRetrieveFromDiscard(player) {
  if (player.discard.length === 0) { log(player.name + ' played Item but discard is empty.'); return; }
  const idx = Math.floor(Math.random() * player.discard.length);
  const card = player.discard.splice(idx,1)[0];
  player.hand.push(card);
  log(player.name + ' retrieved a card from discard: ' + (card.type === 'Pokemon' ? card.name : card.type));
}
function itemHeal30(player) {
  if (!player.active) { log(player.name + ' played Item but has no active Pokémon.'); return; }
  player.active.hp = Math.min(player.active.maxHp, player.active.hp + 30);
  log(player.name + ' healed 30 HP on ' + player.active.name + '.');
}
function itemAddEnergy(player) {
  if (!player.active) { log(player.name + ' played Item but has no active Pokémon.'); return; }
  player.active.energy += 1;
  log(player.name + ' added 1 Energy to ' + player.active.name + ' via Item.');
}

// ---------- Game state ----------
let game = {
  player: null,
  computer: null,
  currentPlayer: null,
  opponent: null,
  phase: 'setup', // setup, playing, ended
  userMustChooseActive: true,
  mulliganCount: 0, // global
  maxMulligans: 3,
  turnCounter: 1,
  playerFirst: true // user always first
};

// ---------- Build example 60-card decks ----------
function buildSampleDeck(seed='player') {
  const deck = [];
  // Add 18 Basic Pokémon
  for (let i=0;i<18;i++){
    deck.push(createPokemon('BasicMon-' + (i%6+1), 60 + (i%3)*10, 'Tackle', 20));
  }
  // Add 6 Stage1 evolutions (just for evolving mechanics)
  for (let i=0;i<6;i++){
    deck.push(createPokemon('Stage1Mon-' + (i+1), 100, 'Strong Hit', 50, 'Stage1'));
  }
  // Add 20 Energy
  for (let i=0;i<20;i++) deck.push(createEnergy());
  // Add 6 Supporters (mix)
  deck.push(createSupporter('Draw3', supporterDraw3));
  deck.push(createSupporter('Add2Energy', supporterAdd2Energy));
  deck.push(createSupporter('ReturnBench', supporterReturnBenchToHand));
  deck.push(createSupporter('Discard2', supporterDiscard2));
  // Duplicate some supporters for variety
  deck.push(createSupporter('Draw3', supporterDraw3));
  deck.push(createSupporter('Add2Energy', supporterAdd2Energy));
  // Add 10 Items (mix)
  for (let i=0;i<2;i++) deck.push(createItem('Draw2', itemDraw2));
  for (let i=0;i<2;i++) deck.push(createItem('RetrieveDiscard', itemRetrieveFromDiscard));
  for (let i=0;i<2;i++) deck.push(createItem('Heal30', itemHeal30));
  for (let i=0;i<4;i++) deck.push(createItem('AddEnergy', itemAddEnergy));
  // Fill to 60 if not yet
  while (deck.length < 60) deck.push(createEnergy());
  shuffle(deck);
  return deck;
}

// ---------- Player object init ----------
function makePlayer(name) {
  return {
    name,
    deck: buildSampleDeck(name),
    hand: [],
    discard: [],
    bench: [],
    active: null,
    prizes: [],
    supporterUsedThisTurn: false,
    energyAttachedThisTurn: false
  };
}

// ---------- Draw and deck helpers ----------
function playerDrawCard(player) {
  if (player.deck.length === 0) {
    log(player.name + ' cannot draw a card (deck empty).');
    return false;
  }
  const c = player.deck.shift();
  player.hand.push(c);
  // log only for some actions to reduce spam
  //log(player.name + ' drew a card.');
  return true;
}
function drawMultiple(player, n) {
  for (let i=0;i<n;i++){
    if (!playerDrawCard(player)) return false;
  }
  return true;
}

// ---------- Setup flow ----------
function setupNewGame() {
  game.player = makePlayer('You');
  game.computer = makePlayer('Computer');
  game.phase = 'setup';
  game.mulliganCount = 0;
  game.turnCounter = 1;
  game.playerFirst = true;
  game.userMustChooseActive = true;
  game.currentPlayer = game.player; // player will be first after setup
  game.opponent = game.computer;
  // initial draws
  for (let p of [game.player, game.computer]) {
    p.hand = [];
    p.discard = [];
    p.bench = [];
    p.active = null;
    p.prizes = [];
    p.supporterUsedThisTurn = false;
    p.energyAttachedThisTurn = false;
    // draw 7
    for (let i=0;i<7;i++) playerDrawCard(p);
    // prize cards: take top 6 from deck
    for (let i=0;i<6;i++){
      if (p.deck.length>0) p.prizes.push(p.deck.shift());
    }
  }
  updateUI();
  log('Game setup: Dealt opening hands and prizes.');
  // Check for mulligans immediately (if player has no Basic)
  handleMulligans();
  // After mulligans & bench building we will let user place Pokémon onto bench (clicking in hand).
  document.getElementById('btn-reveal-state').disabled = false;
  document.getElementById('btn-resume-setup').disabled = false;
}

// Mulligan rule: If opening hand has no Basic Pokémon -> mulligan. Global limit of 3 mulligans.
function hasBasicInHand(player) {
  return player.hand.some(c => c.type === 'Pokemon' && c.stage === 'Basic');
}
function handleMulligans() {
  // for each player with no basic, allow mulligan (player chooses to accept automatic mulligan)
  // we will auto-mulligan for CPU
  let attempts = 0;
  while (attempts <= 4) { // safe escape
    let didAny = false;
    if (!hasBasicInHand(game.player) && game.mulliganCount < game.maxMulligans) {
      // offer player mulligan
      const doMull = confirm('Your opening hand has no Basic Pokémon. Mulligan? (OK = Mulligan, Cancel = Keep hand)');
      if (doMull) {
        game.mulliganCount++;
        log('You mulliganed (global mulligans used: ' + game.mulliganCount + ').');
        // put hand back to deck, shuffle, draw 7
        game.player.deck.push(...game.player.hand);
        game.player.hand = [];
        shuffle(game.player.deck);
        for (let i=0;i<7;i++) playerDrawCard(game.player);
        didAny = true;
      }
    }
    if (!hasBasicInHand(game.computer) && game.mulliganCount < game.maxMulligans) {
      // CPU mulligans automatically
      game.mulliganCount++;
      log('Computer mulligans (global mulligans used: ' + game.mulliganCount + ').');
      game.computer.deck.push(...game.computer.hand);
      game.computer.hand = [];
      shuffle(game.computer.deck);
      for (let i=0;i<7;i++) playerDrawCard(game.computer);
      didAny = true;
    }
    if (!didAny) break;
    attempts++;
  }
  if (game.mulliganCount >= game.maxMulligans) {
    log('Maximum mulligans reached (' + game.maxMulligans + '). No further mulligans allowed.');
  }
  updateUI();
}

// ---------- UI and rendering ----------
let userSelectedHandCardId = null;
let chosenBenchIndexDuringSetup = null;

function renderPlayerHand() {
  const handDiv = document.getElementById('player-hand');
  handDiv.innerHTML = '';
  game.player.hand.forEach((c, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.handIndex = idx;
    let title = (c.type === 'Pokemon') ? `${c.name} (${c.stage}) HP:${c.hp}` : c.type;
    cardEl.innerHTML = `<b>${title}</b><div class="small">${c.type === 'Pokemon' ? 'Attack: ' + c.attackName + ' ('+c.damage+')' : ''}</div>`;
    cardEl.onclick = () => {
      // select for play
      const prev = document.querySelector('.hand .selected');
      if (prev) prev.classList.remove('selected');
      cardEl.classList.add('selected');
      userSelectedHandCardId = c.id;
    };
    handDiv.appendChild(cardEl);
  });
}

function renderBench(player, benchDivId, selectable=false) {
  const benchDiv = document.getElementById(benchDivId);
  benchDiv.innerHTML = '';
  for (let i=0;i<5;i++){
    const slot = document.createElement('div');
    slot.className = 'bench-slot';
    if (player.bench[i]) {
      const c = player.bench[i];
      slot.innerHTML = `<b>${c.name}</b><div class="small">HP:${c.hp}/${c.maxHp} | E:${c.energy}${c.stage!=='Basic'?' | '+c.stage:''}</div>`;
      if (selectable) {
        slot.onclick = () => {
          // during setup, if user clicks bench Pokémon, set as active
          if (game.phase === 'setup' && player === game.player) {
            chosenBenchIndexDuringSetup = i;
            // mark selection visually
            const slots = document.querySelectorAll('#player-bench .bench-slot');
            slots.forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
          }
        };
      }
    } else {
      slot.innerHTML = '<div class="small center">Empty</div>';
    }
    benchDiv.appendChild(slot);
  }
}

function renderActive(player, activeDivId) {
  const d = document.getElementById(activeDivId);
  if (!player.active) {
    d.innerHTML = '<div class="small center">No Active Pokémon</div>';
    return;
  }
  const p = player.active;
  d.innerHTML = `<b>${p.name}</b><div class="small">Stage:${p.stage} | HP: ${p.hp}/${p.maxHp} | Energy: ${p.energy}</div>
    <div class="small">Attack: ${p.attackName} (${p.damage})</div>`;
}

function updateUI() {
  // player info
  document.getElementById('player-deck-count').textContent = game.player.deck.length;
  document.getElementById('player-discard-count').textContent = game.player.discard.length;
  document.getElementById('player-prizes').textContent = game.player.prizes.length;
  document.getElementById('player-energy-attached').textContent = game.player.energyAttachedThisTurn ? 'yes' : 'no';
  document.getElementById('player-supporter-used').textContent = game.player.supporterUsedThisTurn ? 'yes' : 'no';

  document.getElementById('computer-deck-count').textContent = game.computer.deck.length;
  document.getElementById('computer-discard-count').textContent = game.computer.discard.length;
  document.getElementById('computer-prizes').textContent = game.computer.prizes.length;
  document.getElementById('computer-energy-attached').textContent = game.computer.energyAttachedThisTurn ? 'yes' : 'no';
  document.getElementById('computer-supporter-used').textContent = game.computer.supporterUsedThisTurn ? 'yes' : 'no';

  renderPlayerHand();
  renderBench(game.player, 'player-bench', true);
  renderBench(game.computer, 'computer-bench', false);
  renderActive(game.player, 'player-active');
  renderActive(game.computer, 'computer-active');

  document.getElementById('player-info').innerHTML = `<b>Turn:</b> ${game.turnCounter} | Phase: ${game.phase}<br><b>Current:</b> ${game.currentPlayer ? game.currentPlayer.name : 'N/A'}`;
  document.getElementById('computer-info').innerHTML = `<b>Computer</b>`;
}

// ---------- Card play logic (player) ----------
function findCardInHandById(player, id) {
  return player.hand.findIndex(c => c.id === id);
}

function playCardFromHand(index) {
  if (index < 0 || index >= game.player.hand.length) return;
  const card = game.player.hand[index];
  if (card.type === 'Pokemon') {
    // place on bench (if Basic) or attempt evolution
    if (card.stage === 'Basic') {
      if (game.player.bench.length >= 5) { alert('Bench full'); return; }
      // remove from hand and put on bench
      game.player.hand.splice(index,1);
      card.bornTurn = nowTurn();
      game.player.bench.push(card);
      log('You put Basic ' + card.name + ' onto the bench.');
      updateUI();
    } else {
      alert('Stage1/Pokemon must be evolved onto a matching Basic on bench/active using Evolve button.');
    }
  } else if (card.type === 'Energy') {
    alert('Energy cards must be attached using the "Attach Energy" button (select card in hand first).');
  } else if (card.type === 'Supporter') {
    // play supporter
    if (game.player.supporterUsedThisTurn) { alert('You already used a Supporter this turn.'); return; }
    if (card.requiresCoin) {
      const userChoice = promptCoinChoice('player');
      const flip = Math.random() < 0.5 ? 'heads' : 'tails';
      log('Coin flip: you chose ' + userChoice + '. Flip: ' + flip + '.');
      if (userChoice === flip) {
        game.player.hand.splice(index,1);
        card.effectFunc(game.player);
        game.player.discard.push(card);
      } else {
        log('Supporter failed due to coin.');
        game.player.supporterUsedThisTurn = true;
        game.player.hand.splice(index,1);
        game.player.discard.push(card);
      }
    } else {
      game.player.hand.splice(index,1);
      card.effectFunc(game.player);
      game.player.discard.push(card);
    }
    updateUI();
  } else if (card.type === 'Item') {
    // items can be played any number
    if (card.requiresCoin) {
      const userChoice = promptCoinChoice('player');
      const flip = Math.random() < 0.5 ? 'heads' : 'tails';
      log('Coin flip: you chose ' + userChoice + '. Flip: ' + flip + '.');
      if (userChoice === flip) {
        game.player.hand.splice(index,1);
        card.effectFunc(game.player);
        game.player.discard.push(card);
      } else {
        log('Item effect failed due to coin.');
        game.player.hand.splice(index,1);
        game.player.discard.push(card);
      }
    } else {
      game.player.hand.splice(index,1);
      card.effectFunc(game.player);
      game.player.discard.push(card);
    }
    updateUI();
  }
}

// Attach energy: choose an energy card in hand -> attach to a chosen pokemon (active or bench index)
function attachEnergyFromHand(handIndex, targetZone='active', benchIndex=0) {
  if (handIndex < 0 || handIndex >= game.player.hand.length) { alert('Select an Energy in hand to attach.'); return; }
  const card = game.player.hand[handIndex];
  if (card.type !== 'Energy') { alert('Selected card is not Energy.'); return; }
  if (game.player.energyAttachedThisTurn) { alert('You already attached energy this turn.'); return; }
  let target = null;
  if (targetZone === 'active') target = game.player.active;
  else if (targetZone === 'bench') target = game.player.bench[benchIndex];
  if (!target) { alert('No target to attach energy to.'); return; }
  // attach
  game.player.hand.splice(handIndex,1);
  target.energy += 1;
  game.player.energyAttachedThisTurn = true;
  log('You attached 1 Energy to ' + target.name + '.');
  updateUI();
}

// Evolve: pick a Stage1 in hand that matches a Basic on bench or active (matching by stage name prefix not enforced; we will allow any Stage1 to evolve any Basic for simplicity)
function evolveFromHand(handIndex, targetZone='active', benchIndex=0) {
  if (handIndex < 0 || handIndex >= game.player.hand.length) { alert('Select an evolution card in your hand.'); return; }
  const card = game.player.hand[handIndex];
  if (card.type !== 'Pokemon' || card.stage === 'Basic') { alert('Select a Stage1 Pokémon card to evolve.'); return; }
  let target = null;
  if (targetZone === 'active') target = game.player.active;
  else if (targetZone === 'bench') target = game.player.bench[benchIndex];
  if (!target) { alert('No target to evolve.'); return; }
  // cannot evolve on same turn the target entered play
  if (target.bornTurn === nowTurn()) { alert('Cannot evolve a Pokémon that was just put into play this turn.'); return; }
  // perform evolution - we replace target with evolving card, preserving energy and hp carried (common TCG rule: damage/energy carried over)
  const evolved = game.player.hand.splice(handIndex,1)[0];
  evolved.energy = target.energy; // carry over energy
  evolved.hp = Math.min(evolved.maxHp, target.hp); // carry damage across: target.hp remains, but evolved has full hp then set to target.hp
  evolved.bornTurn = nowTurn();
  // replace
  if (targetZone === 'active') {
    game.player.active = evolved;
  } else {
    game.player.bench[benchIndex] = evolved;
  }
  log('You evolved ' + target.name + ' into ' + evolved.name + '.');
  updateUI();
}

// Attack: if active has energy >=1, perform attack damage to opponent active; after attack, end user's turn automatically
function playerAttack() {
  const p = game.player;
  if (!p.active) { alert('No active Pokémon.'); return; }
  if (p.active.energy < 1) { alert('Not enough energy to attack.'); return; }
  // do damage
  const dmg = p.active.damage;
  const opp = game.computer;
  opp.active.hp -= dmg;
  log('You attacked with ' + p.active.name + ' for ' + dmg + ' damage on ' + opp.active.name + '.');
  // after attack, check knockout
  if (opp.active.hp <= 0) {
    log(opp.active.name + ' is Knocked Out!');
    // move opponent active to discard
    opp.discard.push(opp.active);
    opp.active = null;
    // attacker draws one prize
    if (p.prizes.length > 0) {
      const prize = p.prizes.pop();
      p.hand.push(prize);
      log('You took a Prize card! Prizes remaining: ' + p.prizes.length);
    }
    // promote bench to active if any
    if (opp.bench.length > 0) {
      opp.active = opp.bench.shift();
      log('Opponent promoted a Bench Pokémon to Active: ' + opp.active.name);
    } else {
      // opponent has no bench to replace -> you win
      log('Opponent has no bench to replace knocked out Pokémon. You win!');
      game.phase = 'ended';
      updateUI();
      return;
    }
  }
  // after attack, player's turn ends automatically
  endTurn();
}

// ---------- Computer (AI) behavior ----------
function computerTakeTurn() {
  if (game.phase !== 'playing') return;
  const cpu = game.computer;
  const player = game.player;
  log("Computer's turn begins.");

  // draw at start of turn
  if (!playerDrawCard(cpu)) {
    // lose by unable to draw
    log('Computer could not draw at start of turn. Computer loses — you win!');
    game.phase = 'ended';
    updateUI();
    return;
  } else {
    log('Computer draws a card.');
  }

  // reset flags for turn
  cpu.supporterUsedThisTurn = false;
  cpu.energyAttachedThisTurn = false;

  // Simple AI order:
  // 1. If has Basic active? if not, promote from bench or put Basic from hand to bench & promote.
  if (!cpu.active) {
    // if bench exists => promote
    if (cpu.bench.length > 0) {
      cpu.active = cpu.bench.shift();
      log('Computer promoted ' + cpu.active.name + ' to active.');
    } else {
      // try play a Basic from hand to bench then promote
      const idx = cpu.hand.findIndex(c => c.type === 'Pokemon' && c.stage === 'Basic');
      if (idx >= 0) {
        const card = cpu.hand.splice(idx,1)[0];
        card.bornTurn = nowTurn();
        cpu.bench.push(card);
        log('Computer put Basic ' + card.name + ' on the bench.');
        cpu.active = cpu.bench.shift();
        log('Computer promoted ' + cpu.active.name + ' to active.');
      } else {
        // no basic - likely shouldn't happen due to mulligans, but if so, they skip.
      }
    }
  }

  // 2. Attach energy if has energy card & hasn't attached yet
  if (!cpu.energyAttachedThisTurn) {
    const eIdx = cpu.hand.findIndex(c => c.type === 'Energy');
    if (eIdx >= 0 && cpu.active) {
      cpu.active.energy += 1;
      cpu.hand.splice(eIdx,1);
      cpu.energyAttachedThisTurn = true;
      log('Computer attached 1 energy to ' + cpu.active.name + '.');
    }
  }

  // 3. Maybe play Supporter if beneficial (Draw3)
  if (!cpu.supporterUsedThisTurn) {
    let sidx = cpu.hand.findIndex(c => c.type === 'Supporter' && c.name === 'Draw3');
    if (sidx >= 0) {
      const s = cpu.hand.splice(sidx,1)[0];
      s.effectFunc(cpu);
      cpu.discard.push(s);
      log('Computer played Supporter Draw3.');
    }
  }

  // 4. Attack if possible
  if (cpu.active && cpu.active.energy >= 1) {
    const dmg = cpu.active.damage;
    game.player.active.hp -= dmg;
    log('Computer attacked with ' + cpu.active.name + ' for ' + dmg + '. Your ' + game.player.active.name + ' now HP ' + Math.max(0, game.player.active.hp) + '.');
    // check KO
    if (game.player.active.hp <= 0) {
      log('Your ' + game.player.active.name + ' was Knocked Out by the computer!');
      game.player.discard.push(game.player.active);
      game.player.active = null;
      // computer takes a prize
      if (cpu.prizes.length > 0) {
        const prize = cpu.prizes.pop();
        cpu.hand.push(prize);
        log('Computer took a Prize. Computer prizes left: ' + cpu.prizes.length);
      }
      // promote bench to active if any
      if (game.player.bench.length > 0) {
        game.player.active = game.player.bench.shift();
        log('You must promote a bench Pokémon to Active: ' + game.player.active.name);
      } else {
        log('You have no bench Pokémon to replace knocked out Active. Computer wins!');
        game.phase = 'ended';
        updateUI();
        return;
      }
    }
    // computer's turn ends automatically after attack
  }

  // End of computer turn: check for win by prizes
  if (cpu.prizes.length === 0) {
    log('Computer collected all its prizes and wins.');
    game.phase = 'ended';
    updateUI();
    return;
  }

  // next turn: player's turn
  game.turnCounter++;
  game.currentPlayer = game.player;
  game.opponent = game.computer;
  updateUI();
}

// ---------- End turn ----------
function endTurn() {
  if (game.phase !== 'playing') return;
  // After a player's attack (or manual end), swap current player
  if (game.currentPlayer === game.player) {
    // player's turn ends, set flags reset handled at next player's start
    game.player.energyAttachedThisTurn = false; // will be set next turn
    game.player.supporterUsedThisTurn = false;
    // advance to computer
    game.currentPlayer = game.computer;
    game.opponent = game.player;
    game.turnCounter++;
    updateUI();
    // Computer's start-of-turn draw and actions
    // draw at start of computer's turn
    if (!playerDrawCard(game.computer)) {
      log('Computer cannot draw at start of its turn and loses. You win!');
      game.phase = 'ended';
      updateUI();
      return;
    } else {
      log('Computer draws a card at start of its turn.');
    }
    game.computer.energyAttachedThisTurn = false;
    game.computer.supporterUsedThisTurn = false;
    // Computer takes actions asynchronously via a small timeout to allow UI update
    setTimeout(() => computerTakeTurn(), 600);
  } else {
    // if somehow ended on computer turn, pass back
    game.currentPlayer = game.player;
    game.opponent = game.computer;
    game.turnCounter++;
    updateUI();
  }
}

// ---------- Event bindings ----------
document.getElementById('btn-new-game').onclick = () => {
  if (!confirm('Start a new game?')) return;
  setupNewGame();
};
document.getElementById('btn-play-card').onclick = () => {
  // play the selected card in hand (player)
  if (game.phase !== 'setup' && game.phase !== 'playing') { alert('Game not started'); return; }
  if (userSelectedHandCardId === null) { alert('Select a card in your hand first (click it).'); return; }
  const idx = findCardInHandById(game.player, userSelectedHandCardId);
  if (idx === -1) { alert('Selected card not found'); userSelectedHandCardId = null; return; }
  const card = game.player.hand[idx];
  if (game.phase === 'setup') {
    if (card.type === 'Pokemon' && card.stage === 'Basic') {
      // place onto bench
      if (game.player.bench.length >= 5) { alert('Bench full'); return; }
      const placed = game.player.hand.splice(idx,1)[0];
      placed.bornTurn = nowTurn();
      game.player.bench.push(placed);
      log('You placed Basic ' + placed.name + ' onto bench during setup.');
      userSelectedHandCardId = null;
      updateUI();
    } else {
      alert('During setup, only Basic Pokémon can be placed from hand to bench.');
    }
    return;
  } else {
    // playing phase: play card function handles supporters/items/pokemon (bench) etc.
    playCardFromHand(idx);
    userSelectedHandCardId = null;
  }
};
document.getElementById('btn-attach-energy').onclick = () => {
  // attach energy: user selects an energy card in hand (must be selected), and chooses target: active or a bench slot
  if (game.phase !== 'playing') { alert('You can attach energy after setup once the game is playing.'); return; }
  if (!userSelectedHandCardId) { alert('Select an Energy card in your hand first.'); return; }
  const idx = findCardInHandById(game.player, userSelectedHandCardId);
  if (idx === -1) { alert('Selected card not found'); return; }
  const card = game.player.hand[idx];
  if (card.type !== 'Energy') { alert('Selected card is not an Energy.'); return; }
  if (game.player.energyAttachedThisTurn) { alert('You already attached an energy this turn.'); return; }
  // ask user whether to attach to Active or bench
  const target = prompt('Attach to (type "A" for Active or bench slot number 1-5):', 'A');
  if (!target) return;
  if (target.toUpperCase() === 'A') {
    if (!game.player.active) { alert('No active Pokémon'); return; }
    attachEnergyFromHand(idx, 'active', 0);
  } else {
    const slot = parseInt(target) - 1;
    if (isNaN(slot) || slot < 0 || slot >= game.player.bench.length) { alert('Invalid bench slot number'); return; }
    attachEnergyFromHand(idx, 'bench', slot);
  }
  userSelectedHandCardId = null;
};
document.getElementById('btn-play-supporter').onclick = () => {
  if (game.phase !== 'playing') { alert('Supporters can be used during playing phase only.'); return; }
  if (game.player.supporterUsedThisTurn) { alert('You have already used a Supporter this turn.'); return; }
  if (!userSelectedHandCardId) { alert('Select a Supporter card in your hand (click it).'); return; }
  const idx = findCardInHandById(game.player, userSelectedHandCardId);
  if (idx === -1) return;
  const card = game.player.hand[idx];
  if (card.type !== 'Supporter') { alert('Selected card is not a Supporter.'); return; }
  // execute effect (supporter functions handle setting supporterUsedThisTurn)
  if (card.requiresCoin) {
    const userChoice = promptCoinChoice('player');
    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    log('Coin flip: you chose ' + userChoice + '. Flip: ' + flip + '.');
    if (userChoice === flip) {
      game.player.hand.splice(idx,1);
      card.effectFunc(game.player);
      game.player.discard.push(card);
    } else {
      log('Supporter failed due to coin.');
      game.player.supporterUsedThisTurn = true;
      game.player.hand.splice(idx,1);
      game.player.discard.push(card);
    }
  } else {
    game.player.hand.splice(idx,1);
    card.effectFunc(game.player);
    game.player.discard.push(card);
  }
  userSelectedHandCardId = null;
  updateUI();
};
document.getElementById('btn-play-item').onclick = () => {
  if (game.phase !== 'playing') { alert('Items can be used during playing phase only.'); return; }
  if (!userSelectedHandCardId) { alert('Select an Item card in your hand (click it).'); return; }
  const idx = findCardInHandById(game.player, userSelectedHandCardId);
  if (idx === -1) return;
  const card = game.player.hand[idx];
  if (card.type !== 'Item') { alert('Selected card is not an Item.'); return; }
  if (card.requiresCoin) {
    const userChoice = promptCoinChoice('player');
    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    log('Coin flip: you chose ' + userChoice + '. Flip: ' + flip + '.');
    if (userChoice === flip) {
      game.player.hand.splice(idx,1);
      card.effectFunc(game.player);
      game.player.discard.push(card);
    } else {
      log('Item failed due to coin.');
      game.player.hand.splice(idx,1);
      game.player.discard.push(card);
    }
  } else {
    game.player.hand.splice(idx,1);
    card.effectFunc(game.player);
    game.player.discard.push(card);
  }
  userSelectedHandCardId = null;
  updateUI();
};
document.getElementById('btn-evolve').onclick = () => {
  // evolve: user must select a Stage1 in hand (click it), and then choose target active/bench number
  if (game.phase !== 'playing') { alert('Evolve during playing phase only.'); return; }
  if (!userSelectedHandCardId) { alert('Select a Stage1 Pokémon card in your hand (click it).'); return; }
  const idx = findCardInHandById(game.player, userSelectedHandCardId);
  if (idx === -1) return;
  const card = game.player.hand[idx];
  if (!(card.type === 'Pokemon' && card.stage !== 'Basic')) { alert('Select a Stage1 Pokémon card to evolve.'); return; }
  const target = prompt('Evolve which target? type "A" for Active or bench slot number 1-5:','A');
  if (!target) return;
  if (target.toUpperCase() === 'A') {
    evolveFromHand(idx, 'active', 0);
  } else {
    const slot = parseInt(target)-1;
    if (isNaN(slot) || slot < 0 || slot >= game.player.bench.length) { alert('Invalid bench slot'); return; }
    evolveFromHand(idx, 'bench', slot);
  }
  userSelectedHandCardId = null;
};
document.getElementById('btn-attack').onclick = () => {
  if (game.phase !== 'playing') { alert('Game not in playing phase'); return; }
  if (game.currentPlayer !== game.player) { alert('Not your turn'); return; }
  playerAttack();
};
document.getElementById('btn-end-turn').onclick = () => {
  if (game.phase !== 'playing') { alert('Game not in playing phase'); return; }
  if (game.currentPlayer !== game.player) { alert('Not your turn'); return; }
  // End turn without attacking (allowed but rules said turn ends automatically on attack; ending manually ok)
  endTurn();
};

document.getElementById('btn-reveal-state').onclick = () => {
  alert('Computer hand size: ' + game.computer.hand.length + '\nComputer bench size: ' + game.computer.bench.length + '\nComputer prizes left: ' + game.computer.prizes.length);
};
document.getElementById('btn-resume-setup').onclick = () => {
  if (game.phase !== 'setup') return;
  // allow player to finalize starting Active selection if they have at least 1 bench pokemon
  if (game.player.bench.length === 0) {
    alert('You must place at least one Basic on your bench during setup and then select one to be Active.');
    return;
  }
  if (chosenBenchIndexDuringSetup === null) {
    alert('Select a bench Pokémon by clicking its slot to choose it as Active, then click Resume Setup.');
    return;
  }
  // move chosen bench to active
  game.player.active = game.player.bench.splice(chosenBenchIndexDuringSetup,1)[0];
  log('You chose ' + game.player.active.name + ' as your starting Active Pokémon.');
  chosenBenchIndexDuringSetup = null;

  // For computer: automatically place the first Basic in hand to bench and pick active
  // Place up to 5 basics from hand onto bench
  let placed = 0;
  for (let i = game.computer.hand.length-1; i>=0 && placed < 5; i--) {
    const c = game.computer.hand[i];
    if (c.type === 'Pokemon' && c.stage === 'Basic') {
      game.computer.hand.splice(i,1);
      c.bornTurn = nowTurn();
      game.computer.bench.push(c);
      placed++;
    }
  }
  // if no bench, try to put one and promote
  if (game.computer.bench.length > 0) {
    game.computer.active = game.computer.bench.shift();
  } else {
    // if still no basic (rare due to mulligans), try pull from deck
    for (let i = game.computer.deck.length-1; i>=0 && game.computer.bench.length===0; i--) {
      const c = game.computer.deck[i];
      if (c.type === 'Pokemon' && c.stage === 'Basic') {
        game.computer.deck.splice(i,1);
        c.bornTurn = nowTurn();
        game.computer.bench.push(c);
        game.computer.active = game.computer.bench.shift();
      }
    }
  }

  // Setup done. Set phase to playing.
  game.phase = 'playing';
  game.currentPlayer = game.player; // user always first
  game.opponent = game.computer;
  game.player.supporterUsedThisTurn = false;
  game.player.energyAttachedThisTurn = false;
  game.computer.supporterUsedThisTurn = false;
  game.computer.energyAttachedThisTurn = false;
  document.getElementById('btn-resume-setup').disabled = true;
  log('Setup finished. Game begins. You go first.');
  updateUI();
};

window.onload = () => {
  setupNewGame();
  // allow bench clicks to choose active during setup
  renderBench(game.player, 'player-bench', true);
};