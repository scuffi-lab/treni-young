# Treni Young

Web app (Google Apps Script) che risponde a una domanda semplice: **conviene che salga io o che scenda lei?**

Dati due città (es. Pisa e Torino), un periodo, le fasce orarie di andata e ritorno e se accettare treni con cambi, l'app interroga in tempo reale il motore di vendita Trenitalia e, **settimana per settimana**, mette a confronto le due direzioni:

- **chi sale** (città 1 → città 2 e ritorno)
- **chi scende** (città 2 → città 1 e ritorno)

indicando il totale più basso per ciascuno e chi conviene che viaggi.

## Regole di ricerca

- **Tariffa Young** (under 30) inclusa: Young, FrecciaYOUNG, Super Economy, Economy, Base… viene presa sempre l'offerta acquistabile più bassa; le offerte Senior sono escluse.
- **Solo treni diretti** oppure **anche con cambi**: si sceglie dal menu "Treni". Con i cambi ogni soluzione mostra il numero di cambi e i treni usati; le soluzioni di cui Trenitalia non fornisce le tariffe vengono scartate.
- **Solo posti a sedere**: vagoni letto e cuccette sono esclusi.
- **Controllo fuori fascia**: vengono segnalati i treni degli stessi giorni ma fuori dalla fascia scelta che costano uguale, meno o al massimo 2 € in più del migliore in fascia (es. un Frecciarossa FrecciaYOUNG a 19 € il giovedì mattina).

## Come funziona

- `Code.gs`: lato server. Cerca gli ID delle stazioni ("Tutte le stazioni" della città), poi scorre tutte le partenze delle fasce pagina per pagina (l'API restituisce 10 soluzioni per volta). La ricerca normale e quella "solo Frecce" vanno in parallelo con `UrlFetchApp.fetchAll`. Per ogni treno legge tutte le offerte e restituisce alla pagina il risultato in JSON. Un mese si cerca in circa 45 secondi.
- `Index.html`: la pagina (mobile-first, tema chiaro/scuro) con il modulo e i risultati affiancati. Ricorda nel browser i campi compilati.
- `appsscript.json`: manifest (fuso Europe/Rome, unico permesso: richieste a servizi esterni).

L'API di Trenitalia (`lefrecce.it`) non accetta chiamate dirette da una pagina web (mancano le intestazioni CORS), per questo le richieste partono dal server di Google.

## Installazione

1. Crea un nuovo progetto su [script.google.com](https://script.google.com) e copia `Code.gs` e `Index.html` (il file HTML deve chiamarsi `Index`).
2. **Esegui il deployment → Nuovo deployment → Applicazione web**, con "Esegui come: Me" e "Chi può accedere: Chiunque".
3. Autorizza il permesso "Connessione a un servizio esterno" e condividi il link `/exec`.

Per aggiornare il codice: **Gestisci deployment → Modifica → Nuova versione** (il link resta lo stesso).

## Note

- I prezzi sono quelli in vendita al momento della ricerca: le tariffe Young/FrecciaYOUNG hanno pochi posti e cambiano spesso.
- L'app non compra biglietti: l'acquisto si fa su trenitalia.com o sull'app Trenitalia.
- Progetto personale, non affiliato a Trenitalia. Usa un'API non documentata che potrebbe cambiare.
