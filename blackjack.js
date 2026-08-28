/* ==========================================================================
   שולחן הבלאק ג'ק — מנוע המשחק
   צ'יפים וירטואליים בלבד. אין כסף אמיתי, אין רכישה, אין פרסים.

   חוקים:
   - 6 חפיסות, ערבוב מחדש כשנותרו פחות מ-25% מהקלפים
   - בלאק ג'ק (21 בשני קלפים) משלם 3:2
   - הדילר לוקח עד 16 ועוצר על 17 (כולל 17 רך)
   - הכפלה מותרת רק על שני הקלפים הראשונים; מחלקת קלף אחד ועוצרת
   - תיקו מחזיר את ההימור
   ========================================================================== */
(function () {
  'use strict';

  var SUITS = [
    { s: '♠', color: 'black' },
    { s: '♥', color: 'red'   },
    { s: '♦', color: 'red'   },
    { s: '♣', color: 'black' }
  ];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var DECKS         = 6;
  var START_BALANCE = 1000;
  var STORAGE_KEY   = 'bj-balance-v1';
  var DEALER_DELAY  = 620;   // ms בין קלפי הדילר

  // ---------- אלמנטים ----------
  var el = {};
  ['dealerCards', 'playerCards', 'dealerScore', 'playerScore', 'gameMessage',
   'balance', 'currentBet', 'dealBtn', 'hitBtn', 'standBtn', 'doubleBtn',
   'resetBtn', 'clearBetBtn'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  // אם ה-DOM של השולחן לא קיים, אל תעשה כלום.
  if (!el.dealerCards || !el.playerCards || !el.dealBtn) return;

  // ---------- מצב ----------
  var shoe        = [];
  var dealerHand  = [];
  var playerHand  = [];
  var balance     = loadBalance();
  var bet         = 0;
  var inRound     = false;
  var canDouble   = false;
  var dealerBusy  = false;   // חוסם קלט בזמן תור הדילר

  // ---------- חפיסה ----------
  function buildShoe() {
    var cards = [];
    for (var d = 0; d < DECKS; d++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 0; r < RANKS.length; r++) {
          cards.push({ rank: RANKS[r], suit: SUITS[s].s, color: SUITS[s].color });
        }
      }
    }
    // ערבוב פישר-ייטס
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
    }
    return cards;
  }

  function draw() {
    if (shoe.length < DECKS * 52 * 0.25) shoe = buildShoe();
    return shoe.pop();
  }

  // ---------- חישוב יד ----------
  // אס נספר כ-11, ומורד ל-1 כל עוד היד שבורה.
  function handValue(hand) {
    var total = 0, aces = 0;
    for (var i = 0; i < hand.length; i++) {
      var r = hand[i].rank;
      if (r === 'A') { aces++; total += 11; }
      else if (r === 'K' || r === 'Q' || r === 'J' || r === '10') { total += 10; }
      else { total += parseInt(r, 10); }
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  // יד "רכה" = יש בה אס שעדיין נספר כ-11
  function isSoft(hand) {
    var total = 0, aces = 0;
    for (var i = 0; i < hand.length; i++) {
      var r = hand[i].rank;
      if (r === 'A') { aces++; total += 11; }
      else if (r === 'K' || r === 'Q' || r === 'J' || r === '10') { total += 10; }
      else { total += parseInt(r, 10); }
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return aces > 0;
  }

  function isBlackjack(hand) {
    return hand.length === 2 && handValue(hand) === 21;
  }

  // ---------- רינדור ----------
  function cardEl(card, faceDown) {
    var d = document.createElement('div');
    d.className = 'bj-card' + (faceDown ? ' bj-back' : ' bj-' + card.color);
    if (faceDown) { d.setAttribute('aria-label', 'קלף סגור'); return d; }

    d.setAttribute('aria-label', card.rank + ' ' + card.suit);
    d.innerHTML =
      '<span class="bj-corner bj-tl">' + card.rank + '<span class="bj-s">' + card.suit + '</span></span>' +
      '<span class="bj-pip">' + card.suit + '</span>' +
      '<span class="bj-corner bj-br">' + card.rank + '<span class="bj-s">' + card.suit + '</span></span>';
    return d;
  }

  function renderHand(container, hand, hideHole) {
    container.innerHTML = '';
    container.classList.add('bj-hand');
    for (var i = 0; i < hand.length; i++) {
      container.appendChild(cardEl(hand[i], hideHole && i === 1));
    }
  }

  function renderScores(hideHole) {
    if (el.playerScore) {
      el.playerScore.textContent = playerHand.length ? handValue(playerHand) : '—';
    }
    if (!el.dealerScore) return;
    if (!dealerHand.length) { el.dealerScore.textContent = '—'; return; }
    // כשהקלף הסגור מוסתר, מציגים רק את ערך הקלף הגלוי
    el.dealerScore.textContent = hideHole ? handValue([dealerHand[0]]) + ' + ?'
                                          : handValue(dealerHand);
  }

  function renderMoney(flash) {
    if (el.balance)    el.balance.textContent    = balance.toLocaleString('he-IL');
    if (el.currentBet) el.currentBet.textContent = bet.toLocaleString('he-IL');
    if (flash && el.balance) {
      el.balance.classList.remove('bj-flash');
      void el.balance.offsetWidth;          // הפעלה מחדש של האנימציה
      el.balance.classList.add('bj-flash');
    }
  }

  function message(text, kind) {
    if (!el.gameMessage) return;
    el.gameMessage.textContent = text;
    el.gameMessage.className = kind ? 'bj-' + kind : '';
  }

  function setDisabled(node, disabled) {
    if (!node) return;
    node.disabled = !!disabled;
    node.setAttribute('aria-disabled', String(!!disabled));
  }

  function syncButtons() {
    var betting = !inRound && !dealerBusy;
    setDisabled(el.dealBtn,   !betting || bet <= 0);
    setDisabled(el.hitBtn,    !inRound || dealerBusy);
    setDisabled(el.standBtn,  !inRound || dealerBusy);
    setDisabled(el.doubleBtn, !inRound || dealerBusy || !canDouble || balance < bet);
    setDisabled(el.clearBetBtn, !betting || bet <= 0);
    document.querySelectorAll('[data-chip]').forEach(function (c) {
      setDisabled(c, !betting || balance < parseInt(c.dataset.chip, 10));
    });
  }

  // ---------- הימור ----------
  function addChip(amount) {
    if (inRound || dealerBusy) return;
    if (amount > balance) return;
    balance -= amount;
    bet     += amount;
    renderMoney();
    message('הימור: ' + bet.toLocaleString('he-IL') + ' — לחץ "חלק קלפים"');
    syncButtons();
  }

  function clearBet() {
    if (inRound || dealerBusy || bet === 0) return;
    balance += bet;
    bet = 0;
    renderMoney();
    message('הנח הימור כדי להתחיל');
    syncButtons();
  }

  // ---------- סבב ----------
  function deal() {
    if (inRound || dealerBusy || bet <= 0) return;

    dealerHand = [];
    playerHand = [];
    inRound    = true;
    canDouble  = true;

    playerHand.push(draw());
    dealerHand.push(draw());
    playerHand.push(draw());
    dealerHand.push(draw());

    renderHand(el.playerCards, playerHand, false);
    renderHand(el.dealerCards, dealerHand, true);
    renderScores(true);

    var playerBJ = isBlackjack(playerHand);
    var dealerBJ = isBlackjack(dealerHand);

    if (playerBJ || dealerBJ) {
      if (playerBJ && dealerBJ)      finish('שניכם עם בלאק ג\'ק — תיקו', 'push', bet);
      else if (playerBJ)             finish('בלאק ג\'ק! משלם 3:2', 'win', Math.floor(bet * 2.5));
      else                           finish('לדילר בלאק ג\'ק', 'lose', 0);
      return;
    }

    message('תורך — קח קלף, עצור או הכפל');
    syncButtons();
  }

  function hit() {
    if (!inRound || dealerBusy) return;
    canDouble = false;
    playerHand.push(draw());
    renderHand(el.playerCards, playerHand, false);
    renderScores(true);

    var v = handValue(playerHand);
    if (v > 21)       finish('נשרפת עם ' + v, 'lose', 0);
    else if (v === 21) stand();
    else               { message('תורך — קח קלף או עצור'); syncButtons(); }
  }

  function doubleDown() {
    if (!inRound || dealerBusy || !canDouble || balance < bet) return;
    balance -= bet;
    bet     *= 2;
    canDouble = false;
    renderMoney(true);

    playerHand.push(draw());
    renderHand(el.playerCards, playerHand, false);
    renderScores(true);

    var v = handValue(playerHand);
    if (v > 21) finish('הכפלת ונשרפת עם ' + v, 'lose', 0);
    else        stand();
  }

  function stand() {
    if (!inRound || dealerBusy) return;
    dealerBusy = true;
    syncButtons();

    // חשיפת הקלף הסגור
    renderHand(el.dealerCards, dealerHand, false);
    renderScores(false);
    message('תור הדילר…');

    // הדילר לוקח עד 16, עוצר על 17 (כולל רך)
    (function dealerStep() {
      if (handValue(dealerHand) < 17) {
        setTimeout(function () {
          dealerHand.push(draw());
          renderHand(el.dealerCards, dealerHand, false);
          renderScores(false);
          dealerStep();
        }, DEALER_DELAY);
        return;
      }
      setTimeout(settle, DEALER_DELAY / 2);
    })();
  }

  function settle() {
    var p = handValue(playerHand);
    var d = handValue(dealerHand);

    if (d > 21)      finish('הדילר נשרף עם ' + d + ' — ניצחת', 'win',  bet * 2);
    else if (p > d)  finish('ניצחת ' + p + ' מול ' + d, 'win',  bet * 2);
    else if (p < d)  finish('הפסדת ' + p + ' מול ' + d, 'lose', 0);
    else             finish('תיקו על ' + p, 'push', bet);
  }

  // payout = מה שחוזר ליתרה (0 = הפסד, bet = תיקו, bet*2 = ניצחון)
  function finish(text, kind, payout) {
    dealerBusy = false;
    inRound    = false;
    canDouble  = false;

    renderHand(el.dealerCards, dealerHand, false);
    renderScores(false);

    balance += payout;
    bet = 0;
    saveBalance();
    renderMoney(payout > 0);

    var suffix = balance <= 0 ? ' · נגמרו הצ\'יפים — "משחק חדש" מאפס ל-' +
                                START_BALANCE.toLocaleString('he-IL') : '';
    message(text + suffix, kind);
    syncButtons();
  }

  function resetGame() {
    if (dealerBusy) return;
    balance    = START_BALANCE;
    bet        = 0;
    inRound    = false;
    canDouble  = false;
    dealerHand = [];
    playerHand = [];
    shoe       = buildShoe();
    saveBalance();

    el.dealerCards.innerHTML = '';
    el.playerCards.innerHTML = '';
    el.dealerCards.classList.add('bj-hand');
    el.playerCards.classList.add('bj-hand');
    renderScores(false);
    renderMoney(true);
    message('הנח הימור כדי להתחיל');
    syncButtons();
  }

  // ---------- שמירת יתרה ----------
  function loadBalance() {
    try {
      var v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return (isFinite(v) && v >= 0) ? v : START_BALANCE;
    } catch (e) { return START_BALANCE; }
  }
  function saveBalance() {
    try { localStorage.setItem(STORAGE_KEY, String(balance)); } catch (e) { /* מצב פרטי */ }
  }

  // ---------- חיווט ----------
  document.querySelectorAll('[data-chip]').forEach(function (c) {
    c.addEventListener('click', function () { addChip(parseInt(c.dataset.chip, 10)); });
  });
  if (el.clearBetBtn) el.clearBetBtn.addEventListener('click', clearBet);
  el.dealBtn.addEventListener('click', deal);
  if (el.hitBtn)    el.hitBtn.addEventListener('click', hit);
  if (el.standBtn)  el.standBtn.addEventListener('click', stand);
  if (el.doubleBtn) el.doubleBtn.addEventListener('click', doubleDown);
  if (el.resetBtn)  el.resetBtn.addEventListener('click', resetGame);

  // קיצורי מקלדת
  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea, select')) return;
    var k = e.key.toLowerCase();
    if (k === 'h') hit();
    else if (k === 's') stand();
    else if (k === 'd') doubleDown();
    else if (k === 'enter' && !inRound) deal();
  });

  // ---------- אתחול ----------
  shoe = buildShoe();
  el.dealerCards.classList.add('bj-hand');
  el.playerCards.classList.add('bj-hand');
  el.dealerCards.innerHTML = '';
  el.playerCards.innerHTML = '';
  renderScores(false);
  renderMoney();
  message('הנח הימור כדי להתחיל');
  syncButtons();
})();
