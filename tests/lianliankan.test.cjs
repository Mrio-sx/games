const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game(storageBlocked = false) {
  const elements = new Map(), callbacks = new Map(), events = new Map();
  let now = 0, serial = 0;
  function element() {
    return { textContent: '', className: '', disabled: false, hidden: false,
      classList: { add() {}, toggle() {} }, setAttribute() {}, appendChild() {},
      addEventListener(name, fn) { this[name] = fn; } };
  }
  const document = { hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, addEventListener(name, fn) { events.set(name, fn); } };
  const context = vm.createContext({ document, performance: { now: () => now },
    localStorage: { getItem() { if (storageBlocked) throw Error('blocked'); return null; }, setItem() { if (storageBlocked) throw Error('blocked'); } },
    setInterval(fn) { callbacks.set(++serial, fn); return serial; },
    setTimeout(fn) { callbacks.set(++serial, fn); return serial; },
    clearInterval(id) { callbacks.delete(id); }, clearTimeout(id) { callbacks.delete(id); } });
  const html = fs.readFileSync(path.join(__dirname, '..', 'lianliankan.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { run: code => vm.runInContext(code, context), elements, document, events,
    advance(ms) { now += ms; }, fire() { for (const fn of [...callbacks.values()]) fn(); } };
}

// Independent oracle: enumerate up to two bend points and check each straight segment.
function oracle(a, b, values) {
  if (a === b || !values[a] || values[a] !== values[b]) return false;
  const point = i => [Math.floor(i / 8) + 1, i % 8 + 1];
  const start = point(a), end = point(b);
  function clear(p, q) {
    if (p[0] !== q[0] && p[1] !== q[1]) return false;
    const dr = Math.sign(q[0] - p[0]), dc = Math.sign(q[1] - p[1]);
    let [r, c] = p;
    while (true) {
      const isEnd = (r === start[0] && c === start[1]) || (r === end[0] && c === end[1]);
      if (!isEnd && r >= 1 && r <= 8 && c >= 1 && c <= 8 && values[(r - 1) * 8 + c - 1]) return false;
      if (r === q[0] && c === q[1]) return true;
      r += dr; c += dc;
    }
  }
  const route = pts => pts.slice(1).every((p, i) => clear(pts[i], p));
  if (route([start, end])) return true;
  for (let k = 0; k <= 9; k++) {
    if (route([start, [start[0], k], [end[0], k], end])) return true;
    if (route([start, [k, start[1]], [k, end[1]], end])) return true;
  }
  return false;
}

test('straight, one bend, two bends, outside routes, blockers and unequal fruit', () => {
  const g = game();
  g.run('board=Array(64).fill(null); board[9]=board[12]="a"');
  assert.ok(g.run('findPath(9,12)'));
  g.run('board[12]=null;board[26]="a"');
  assert.ok(g.run('findPath(9,26)'));
  g.run('board=Array(64).fill("x");board[0]=board[7]="a"');
  const outside = g.run('findPath(0,7)');
  assert.ok(outside.some(p => p.r === 0));
  g.run('board=Array(64).fill("x");board[9]=board[14]="a";[1,2,3,4,5,6].forEach(i=>board[i]=null)');
  assert.ok(g.run('findPath(9,14)'));
  g.run('board=Array(64).fill("x");board[9]=board[54]="a"');
  assert.equal(g.run('findPath(9,54)'), null);
  g.run('board=Array(64).fill("x");board[9]=board[27]="a";[10,18,19].forEach(i=>board[i]=null)');
  assert.equal(g.run('findPath(9,27)'), null, 'a corridor requiring three bends is rejected');
  g.run('board=Array(64).fill(null);board[9]="a";board[10]="b"');
  assert.equal(g.run('findPath(9,10)'), null);
  assert.equal(g.run('findPath(9,9)'), null);
});

test('path search agrees with an independent geometric oracle on 2400 random cases', () => {
  const g = game(); let seed = 7391;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 2400; trial++) {
    const board = Array.from({length:64}, () => random() < .45 ? null : 1 + Math.floor(random()*5));
    const a = Math.floor(random()*64), b = Math.floor(random()*64);
    board[a] = board[b] = 1;
    g.run(`board=${JSON.stringify(board)}`);
    assert.equal(!!g.run(`findPath(${a},${b})`), oracle(a,b,board), `case ${trial}`);
  }
});

test('initial board, score, rapid clicks, cancellation, hints and shuffle limits', () => {
  const g = game();g.run('begin()');
  assert.equal(g.run('board.length'), 64);
  assert.equal(g.run('Object.values(board.reduce((o,v)=>(o[v]=(o[v]||0)+1,o),{})).every(n=>n%2===0)'), true);
  assert.ok(g.run('findMove()'));
  g.run('choose(0);choose(0)');assert.equal(g.run('selected'), null);
  g.run('var move=findMove();choose(move.a);choose(move.b);choose(move.a)');
  assert.equal(g.run('effect.type'), 'match');
  g.run('finishEffect();finishEffect()');
  assert.equal(g.run('score'), 10);assert.equal(g.run('board.filter(Boolean).length'), 62);
  for(let i=0;i<5;i++)g.elements.get('hint').click();
  assert.equal(g.run('hints'),0);assert.equal(g.run('hintCells.length'),2);
  const before=g.run('JSON.stringify(board.filter(Boolean).sort())');
  for(let i=0;i<5;i++)g.elements.get('shuffle').click();
  assert.equal(g.run('shuffles'),0);
  assert.equal(g.run('JSON.stringify(board.filter(Boolean).sort())'),before);
  assert.ok(g.run('findMove()'));
});

test('automatic deadlock recovery and bounded shuffle fallback preserve all fruit and holes', () => {
  const g=game();g.run('begin();board=Array.from({length:64},(_,i)=>String((Math.floor(i/8)+i%8)%8+1))');
  assert.equal(g.run('findMove()'),null);
  g.run('ensureMove()');assert.ok(g.run('findMove()'));assert.equal(g.run('shuffles'),3);
  g.run('var pair=findMove();board[pair.a]=board[pair.b]=null;var holes=board.map((v,i)=>v?null:i).filter(v=>v!==null);var before=JSON.stringify(board.filter(Boolean).sort());var originalFindMove=findMove;findMove=()=>null;reshuffle();findMove=originalFindMove');
  assert.ok(g.run('findMove()'));
  assert.equal(g.run('JSON.stringify(board.filter(Boolean).sort())===before'),true);
  assert.equal(g.run('holes.every(i=>board[i]===null)'),true);
});

test('pause and page visibility freeze time, including pending matches', () => {
  const g=game();g.run('begin()');g.advance(1500);
  g.run('var move=findMove();choose(move.a);choose(move.b);pause()');
  assert.equal(g.run('state'),'paused');assert.equal(g.run('score'),10);
  assert.equal(g.run('remaining'),178500);
  g.advance(20000);g.fire();assert.equal(g.run('remaining'),178500);
  g.run('pause()');g.advance(500);g.run('settleTime()');assert.equal(g.run('remaining'),178000);
  g.document.hidden=true;g.events.get('visibilitychange')();assert.equal(g.run('state'),'paused');
  g.document.hidden=false;g.events.get('visibilitychange')();assert.equal(g.run('state'),'paused');
});

test('win, timeout, invalid selection, restart and blocked local storage', () => {
  const g=game(true);g.run('begin();board=Array(64).fill(null);board[0]=board[1]="a";draw()');
  g.advance(1000);g.run('choose(0);choose(1);finishEffect()');
  assert.equal(g.run('state'),'won');assert.equal(g.run('score'),10);assert.equal(g.run('best'),1000);
  g.run('begin();board[0]="a";board[1]="b";choose(0);choose(1)');
  assert.equal(g.run('effect.type'),'invalid');g.run('finishEffect()');assert.equal(g.run('selected'),null);assert.equal(g.run('score'),0);
  g.run('begin()');g.advance(180001);g.fire();
  assert.equal(g.run('state'),'lost');assert.equal(g.run('remaining'),0);
  g.run('begin()');assert.equal(g.run('state'),'running');assert.equal(g.run('score'),0);assert.equal(g.run('remaining'),180000);assert.equal(g.run('hints'),3);
});

test('expiry and restart cancel pending animations without awarding stale points', () => {
  const g=game();g.run('begin()');g.advance(179900);
  g.run('var move=findMove();choose(move.a);choose(move.b)');g.advance(101);g.fire();
  assert.equal(g.run('state'),'lost');assert.equal(g.run('score'),0);
  g.run('begin();var move=findMove();choose(move.a);choose(move.b);begin()');g.fire();
  assert.equal(g.run('score'),0);assert.equal(g.run('board.filter(Boolean).length'),64);
});

test('a full automatically played game reaches victory without a deadlock', () => {
  const g=game();g.run('begin()');
  for(let i=0;i<32;i++){
    assert.ok(g.run('findMove()'));
    g.run('var next=findMove();choose(next.a);choose(next.b);finishEffect()');
  }
  assert.equal(g.run('state'),'won');assert.equal(g.run('score'),320);
  assert.equal(g.run('board.filter(Boolean).length'),0);
});
