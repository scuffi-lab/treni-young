/**
 * Treni Young — confronto "chi sale / chi scende" su Trenitalia.
 * Web app Google Apps Script: interroga l'API lefrecce.it (la stessa di trenitalia.com),
 * solo treni diretti o anche con cambi (a scelta), tariffa Young inclusa, entrambe le direzioni, con controllo fuori fascia.
 */

var BASE = 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website';
var TOLLERANZA = 2.0;      // euro: treni fuori fascia segnalati se costano al massimo questo in piu' del migliore in fascia
var LOTTO = 25;            // richieste parallele per giro
var NRICH = 0;
var GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Treni Young')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- utilità date (stringhe locali "YYYY-MM-DDTHH:MM", nessun fuso) ---------- */

function toD(s) {
  return new Date(Date.UTC(+s.substr(0, 4), +s.substr(5, 2) - 1, +s.substr(8, 2),
    s.length > 10 ? +s.substr(11, 2) : 0, s.length > 10 ? +s.substr(14, 2) : 0));
}
function fromD(d) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
function addMin(s, m) { return fromD(new Date(toD(s).getTime() + m * 60000)); }
function addDays(dateStr, n) { return fromD(new Date(toD(dateStr).getTime() + n * 86400000)).substr(0, 10); }
function wd(dateStr) { return toD(dateStr).getUTCDay(); }
function off(fromWd, toWd, minimo) {
  var o = ((toWd - fromWd) % 7 + 7) % 7;
  while (o < (minimo || 0)) o += 7;
  return o;
}
function adesso() { return Utilities.formatDate(new Date(), 'Europe/Rome', "yyyy-MM-dd'T'HH:mm"); }

/* ---------- API Trenitalia ---------- */

function stazione(nome) {
  var r = UrlFetchApp.fetch(BASE + '/locations/search?name=' + encodeURIComponent(nome) + '&limit=10',
    { muteHttpExceptions: true });
  var res = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : [];
  if (!res.length) throw new Error('Stazione non trovata: ' + nome);
  var multi = res.filter(function (x) { return x.multistation; });
  return (multi.length ? multi[0] : res[0]).id;
}

function richiesta(dep, arr, quando, frecce) {
  return {
    url: BASE + '/ticket/solutions', method: 'post', contentType: 'application/json',
    headers: { 'Accept-Language': 'it-IT' }, muteHttpExceptions: true,
    payload: JSON.stringify({
      departureLocationId: dep, arrivalLocationId: arr, departureTime: quando + ':00.000',
      adults: 1, children: 0,
      criteria: { frecceOnly: frecce, regionalOnly: false, noChanges: false, order: 'DEPARTURE_DATE', limit: 10, offset: 0 },
      advancedSearchRequest: { bestFare: false }
    })
  };
}

/** Somma per ogni tratta tariffaria l'offerta piu' bassa acquistabile (Young incluse, Senior escluse). */
function prezzo(s) {
  var tot = 0, descr = [];
  if (!s.grids || !s.grids.length) return null;                // tariffe non disponibili: scarta
  for (var i = 0; i < s.grids.length; i++) {
    var best = null, g = s.grids[i];
    g.services.forEach(function (sv) {
      if (/letto|cuccett|excelsior/i.test(sv.name)) return;   // solo posti a sedere
      sv.offers.forEach(function (o) {
        if (o.status !== 'SALEABLE' || !o.price) return;
        if (o.name.toUpperCase().indexOf('SENIOR') >= 0) return;
        if (!best || o.price.amount < best.p) best = { p: o.price.amount, n: o.name, s: sv.name };
      });
    });
    if (!best) return null;
    tot += best.p;
    descr.push(best.n + ' ' + best.s);
  }
  return { p: Math.round(tot * 100) / 100, offerta: descr.join(' + ') };
}

/**
 * Esegue in parallelo tante "catene" di ricerca: ogni catena scorre le partenze di una fascia
 * pagina dopo pagina (10 soluzioni alla volta). Ogni giro manda la pagina successiva di tutte le catene attive.
 */
function eseguiCatene(catene) {
  var giri = 0;
  while (giri < 60) {
    var attive = catene.filter(function (c) { return !c.fine_ok; });
    if (!attive.length) break;
    giri++;
    for (var k = 0; k < attive.length; k += LOTTO) {
      var lotto = attive.slice(k, k + LOTTO);
      NRICH += lotto.length;
      var risposte = UrlFetchApp.fetchAll(lotto.map(function (c) { return richiesta(c.dep, c.arr, c.next, c.frecce); }));
      lotto.forEach(function (c, i) {
        var r = risposte[i], code = r.getResponseCode();
        if (code !== 200) {
          c.errori = (c.errori || 0) + 1;
          if (code < 500 || c.errori > 3) c.fine_ok = true;
          return;
        }
        var sols = JSON.parse(r.getContentText()).solutions || [];
        if (!sols.length) { c.fine_ok = true; return; }
        var ultimo = null;
        sols.forEach(function (s) {
          var so = s.solution, p = so.departureTime.substr(0, 16);
          ultimo = p;
          if (p < c.start || p > c.end || so.status !== 'SALEABLE') return;
          if (!c.cambi && so.trains.length !== 1) return;             // solo diretti, salvo opzione "anche con cambi"
          var pr = prezzo(s);
          if (!pr) return;
          var t = so.trains[0], nCambi = so.trains.length - 1;
          var treni = so.trains.map(function (x) { return x.acronym + ' ' + x.name; }).join(' + ');
          var key = p + '|' + treni;
          if (c.ris[key] && c.ris[key].prezzo <= pr.p) return;
          c.ris[key] = {
            partenza: p, arrivo: so.arrivalTime.substr(0, 16), da: so.origin, a: so.destination,
            durata: so.duration, treno: treni, cambi: nCambi,
            categoria: nCambi ? (nCambi === 1 ? '1 cambio' : nCambi + ' cambi') : t.denomination,
            prezzo: pr.p, offerta: pr.offerta
          };
        });
        if (!ultimo || ultimo > c.end) c.fine_ok = true;
        else c.next = ultimo > c.next ? addMin(ultimo, 1) : addMin(c.next, 30);
      });
    }
  }
}

/* ---------- funzione chiamata dalla pagina ---------- */

function cerca(p) {
  var t0 = Date.now();
  var conCambi = p.cambi === 'si';
  var idA = stazione(p.cittaA), idB = stazione(p.cittaB);
  var ora = adesso();

  var wdAndDa = GIORNI.indexOf(p.andataDaGiorno), wdAndA = GIORNI.indexOf(p.andataAGiorno);
  var wdRitDa = GIORNI.indexOf(p.ritornoDaGiorno), wdRitA = GIORNI.indexOf(p.ritornoAGiorno);
  var oAndA = off(wdAndDa, wdAndA);
  var oRitDa = off(wdAndDa, wdRitDa, Math.max(oAndA, 1));
  var oRitA = off(wdAndDa, wdRitA, oRitDa);
  var oArrMax = p.ritornoArrivoMax ? oRitA : null;

  var settimane = [];
  for (var d = p.dal; d <= p.al; d = addDays(d, 1)) {
    if (wd(d) !== wdAndDa) continue;
    var w = {
      etichetta: p.andataDaGiorno + ' ' + d.substr(8, 2) + '/' + d.substr(5, 2) + ' → ' +
        p.ritornoAGiorno + ' ' + addDays(d, oRitA).substr(8, 2) + '/' + addDays(d, oRitA).substr(5, 2),
      andata: [d + 'T' + p.andataDaOra, addDays(d, oAndA) + 'T' + p.andataAOra],
      ritorno: [addDays(d, oRitDa) + 'T' + p.ritornoDaOra, addDays(d, oRitA) + 'T' + p.ritornoAOra],
      limArr: p.ritornoArrivoMax ? addDays(d, oArrMax) + 'T' + p.ritornoArrivoMax : null
    };
    if (w.andata[0] < ora) w.andata[0] = ora;
    if (w.andata[0] <= w.andata[1]) settimane.push(w);
  }
  if (!settimane.length) throw new Error('Nessuna settimana valida nel periodo indicato.');

  // catene: per settimana x verso x tratta x (tutti i treni | solo Frecce). Fascia allargata ai giorni interi (fuori fascia).
  var catene = [], versi = [['AB', idA, idB], ['BA', idB, idA]];
  settimane.forEach(function (w, wi) {
    versi.forEach(function (v) {
      [['andata', v[1], v[2], w.andata], ['ritorno', v[2], v[1], w.ritorno]].forEach(function (leg) {
        var s = leg[3][0].substr(0, 10) + 'T00:00', e = leg[3][1].substr(0, 10) + 'T23:59';
        if (s < ora) s = ora;
        [false, true].forEach(function (fr) {
          catene.push({ wi: wi, verso: v[0], leg: leg[0], dep: leg[1], arr: leg[2], frecce: fr, cambi: conCambi,
                        start: s, end: e, next: s, ris: {} });
        });
      });
    });
  });
  eseguiCatene(catene);

  var out = [];
  settimane.forEach(function (w, wi) {
    var rec = { settimana: w.etichetta, versi: {} };
    versi.forEach(function (v) {
      var gambe = {};
      ['andata', 'ritorno'].forEach(function (leg) {
        var tutte = {};
        catene.filter(function (c) { return c.wi === wi && c.verso === v[0] && c.leg === leg; })
          .forEach(function (c) {
            for (var k in c.ris) if (!tutte[k] || tutte[k].prezzo > c.ris[k].prezzo) tutte[k] = c.ris[k];
          });
        var lista = Object.keys(tutte).map(function (k) { return tutte[k]; })
          .sort(function (a, b) { return a.prezzo - b.prezzo || (a.partenza < b.partenza ? -1 : 1); });
        var fascia = leg === 'andata' ? w.andata : w.ritorno;
        var lim = leg === 'ritorno' ? w.limArr : null;
        lista.forEach(function (r) {
          r.inFascia = r.partenza >= fascia[0] && r.partenza <= fascia[1] && (!lim || r.arrivo <= lim);
        });
        var dentro = lista.filter(function (r) { return r.inFascia; });
        var best = dentro.length ? dentro[0].prezzo : null;
        var fuori = lista.filter(function (r) {
          return !r.inFascia && (best === null || r.prezzo <= best + TOLLERANZA) && (!lim || r.arrivo <= lim);
        });
        // tieni un solo risultato per treno (stesso treno da stazioni diverse della citta')
        gambe[leg] = { inFascia: unici(dentro).slice(0, 5), fuoriFascia: unici(fuori).slice(0, 3) };
      });
      var tot = (gambe.andata.inFascia.length && gambe.ritorno.inFascia.length) ?
        Math.round((gambe.andata.inFascia[0].prezzo + gambe.ritorno.inFascia[0].prezzo) * 100) / 100 : null;
      rec.versi[v[0]] = { totale: tot, andata: gambe.andata, ritorno: gambe.ritorno };
    });
    out.push(rec);
  });

  return {
    generato: ora.replace('T', ' '), secondi: Math.round((Date.now() - t0) / 1000),
    richieste: NRICH, conCambi: conCambi, cittaA: p.cittaA, cittaB: p.cittaB, nomeA: p.nomeA, nomeB: p.nomeB,
    settimane: out
  };
}

/** Usata dalla pagina: restituisce il risultato come testo JSON (trasmissione piu' affidabile). */
function cercaJson(p) {
  return JSON.stringify(cerca(p));
}

function unici(lista) {
  var visti = {}, res = [];
  lista.forEach(function (r) {
    var k = r.treno + '|' + r.partenza.substr(0, 10);
    if (visti[k]) return;
    visti[k] = 1; res.push(r);
  });
  return res;
}

/** Prova dall'editor: Esegui > test e guarda il registro. */
function test() {
  var r = cerca({
    cittaA: 'Pisa', cittaB: 'Torino', nomeA: 'Io', nomeB: 'Lei', dal: '2026-10-08', al: '2026-10-31',
    andataDaGiorno: 'gio', andataDaOra: '15:00', andataAGiorno: 'ven', andataAOra: '12:00',
    ritornoDaGiorno: 'lun', ritornoDaOra: '00:00', ritornoAGiorno: 'lun', ritornoAOra: '23:59', ritornoArrivoMax: '22:00'
  });
  Logger.log('secondi ' + r.secondi + ', richieste ' + r.richieste);
  r.settimane.forEach(function (w) { Logger.log(w.settimana + ' | AB ' + w.versi.AB.totale + ' | BA ' + w.versi.BA.totale); });
}
