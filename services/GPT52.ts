
import { Card, GameState, Rank } from '../types';

/**
 * AI GPT52 (Peppa variante aggressiva/calcolatrice):
 * - Logica avanzata per cappotto e ducking.
 * - Loggata dettagliatamente in console.
 */

const LOG_STYLE = "color: #a78bfa; font-weight: bold; background: #2e1065; padding: 2px 4px; border-radius: 4px;";
const LOG_INFO = "color: #c4b5fd;";

// ---------- Helpers punteggio ----------
const heartPenalty = (card: Card): number => {
  if (card.suit !== 'hearts') return 0;
  // assumo che value sia 2..14 (A=14)
  return -card.value;
};

const peppaPenalty = (card: Card): number => {
  return (card.suit === 'spades' && card.rank === 'Q') ? -26 : 0;
};

const cardPenalty = (card: Card): number => heartPenalty(card) + peppaPenalty(card);

// Valore netto SE vinco una presa contenente "trickCards"
const netIfWinTrick = (trickCards: Card[]): number => {
  const penalties = trickCards.reduce((s, c) => s + cardPenalty(c), 0);
  return 10 + penalties; // +10 per presa, penalità negative se presenti
};

// Stima rischio "avvelenamento" (più avanti nella mano => più gente void => più rischio che scarichino cuori/peppa)
const poisonRiskFactor = (handSize: number): number => {
  if (handSize <= 4) return 1.0;
  if (handSize <= 7) return 0.6;
  if (handSize <= 10) return 0.35;
  return 0.2;
};

// Decide se ha senso tentare cappotto (euristica semplice)
const wantsCappotto = (hand: Card[]): boolean => {
  const hearts = hand.filter(c => c.suit === 'hearts');
  const hasPeppa = hand.some(c => c.suit === 'spades' && c.rank === 'Q');
  const highHearts = hearts.filter(c => c.value >= 11).length; // J,Q,K,A
  // molto conservativo: tanti cuori + diversi alti, e idealmente Q♠
  return hearts.length >= 8 && highHearts >= 3 && hasPeppa;
};

// ---------- PASS (3 carte) ----------
const getPassScore = (card: Card, hand: Card[], cappotto: boolean): number => {
  let score = 0;

  // In cappotto NON voglio passare cuori o peppa (di solito)
  if (cappotto) {
    if (card.suit === 'hearts') return -1000;
    if (card.suit === 'spades' && card.rank === 'Q') return -1000;
  }

  // Q♠ quasi sempre da passare (enorme rischio)
  if (card.suit === 'spades' && card.rank === 'Q') score += 1000;

  // Cuori: più sono alti, più sono pericolosi (penalità pesante se li prendi)
  if (card.suit === 'hearts') {
    score += 200 + card.value * 15; // scala forte
  }

  // Carte “medie” (7-10,J) spesso prendono prese a metà partita => rischio di vincere prese avvelenate
  if ([7, 8, 9, 10, 11].includes(card.value)) score += 120;

  // A/K non-cuori sono utili per prendere prese pulite (+10 netti), quindi NON passarli di base
  if (card.suit !== 'hearts' && (card.rank === 'A' || card.rank === 'K')) score -= 180;

  // Picche alte (A/K♠) possono forzarti a vincere prese dove ti scaricano cuori/peppa:
  // le tengo, ma non sono sacre come A/K di altri semi.
  if (card.suit === 'spades' && (card.rank === 'A' || card.rank === 'K')) score += 40;

  // Evita di passare 2 e 3 (sono ottime per “duckare” e controllare)
  if (card.rank === '2' || card.rank === '3') score -= 200;

  return score;
};

export function getGPT52Pass(hand: Card[]): string[] {
  const cappotto = wantsCappotto(hand);
  
  console.groupCollapsed(`%c[GPT52] Calcolo Passaggio (Cappotto: ${cappotto ? 'SI' : 'NO'})`, LOG_STYLE);

  const scoredCards = hand.map(c => ({
    id: c.id,
    card: `${c.rank}${c.suit}`,
    score: getPassScore(c, hand, cappotto),
  }));

  // Log dettagliato punteggi
  console.table(scoredCards.sort((a, b) => b.score - a.score));

  const toPass = scoredCards.slice(0, 3).map(sc => sc.id);
  console.log(`%cCarte scelte: ${toPass.join(', ')}`, LOG_INFO);
  console.groupEnd();

  return toPass;
}

// ---------- MOVE ----------
export function getGPT52Move(gameState: GameState, botId: number): Card {
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) throw new Error("Bot not found");

  const hand = bot.hand;
  const trick = gameState.currentTrick;
  const leadSuit = gameState.leadSuit;

  const cappotto = wantsCappotto(hand);
  const risk = poisonRiskFactor(hand.length);

  // --- Start Log Group ---
  console.groupCollapsed(`%c[GPT52] Mossa Bot ${bot.name}`, LOG_STYLE);
  console.log(`%cMano residua: ${hand.length} carte. Rischio Avvelenamento: ${(risk * 100).toFixed(0)}%`, LOG_INFO);
  console.log(`%cStrategia Cappotto: ${cappotto ? 'ATTIVA' : 'DISATTIVA'}`, cappotto ? "color: red; font-weight: bold;" : LOG_INFO);
  
  if (leadSuit) console.log(`%cSeme Lead: ${leadSuit}`, LOG_INFO);
  else console.log(`%cÈ il primo di mano (Lead)`, "color: yellow;");

  // --- legal moves ---
  let legalMoves = hand;
  if (trick.length > 0 && leadSuit) {
    const following = hand.filter(c => c.suit === leadSuit);
    if (following.length > 0) legalMoves = following;
  }

  // Helpers ordinamenti
  const asc = (a: Card, b: Card) => a.value - b.value;
  const desc = (a: Card, b: Card) => b.value - a.value;

  // Se mossa obbligata
  if (legalMoves.length === 1) {
      console.log(`%cMossa obbligata: ${legalMoves[0].rank} ${legalMoves[0].suit}`, LOG_INFO);
      console.groupEnd();
      return legalMoves[0];
  }

  // Carte "pulite" = non cuori e non Q♠
  const isClean = (c: Card) => !(c.suit === 'hearts' || (c.suit === 'spades' && c.rank === 'Q'));

  let chosenCard: Card;

  // =========================
  // LEAD (inizio presa)
  // =========================
  if (trick.length === 0) {
    if (cappotto) {
      console.log("%c[LEAD] Strategia Cappotto: Cerco cuori o comando", LOG_INFO);
      const hearts = legalMoves.filter(c => c.suit === 'hearts').sort(desc);
      if (hearts.length > 0) chosenCard = hearts[0];
      else {
          const highNonHearts = legalMoves.filter(c => c.suit !== 'hearts').sort(desc);
          chosenCard = highNonHearts[0];
      }
    } else {
        // Non cappotto:
        const clean = legalMoves.filter(isClean);

        if (risk >= 0.6) {
           console.log("%c[LEAD] Rischio Alto: Lead basso e pulito per difesa", LOG_INFO);
           const lowClean = clean.length ? [...clean].sort(asc)[0] : [...legalMoves].sort(asc)[0];
           chosenCard = lowClean;
        } else {
           const strongClean = clean.filter(c => c.rank === 'A' || c.rank === 'K').sort(desc);
           if (strongClean.length > 0) {
               console.log("%c[LEAD] Rischio Basso: Gioco carichi puliti (A/K) per punti sicuri", LOG_INFO);
               chosenCard = strongClean[0];
           } else if (clean.length > 0) {
               console.log("%c[LEAD] Gioco pulito più alto disponibile", LOG_INFO);
               chosenCard = [...clean].sort(desc)[0];
           } else {
               console.log("%c[LEAD] Solo carte pericolose: Gioco la minima", "color: orange;");
               chosenCard = [...legalMoves].sort(asc)[0];
           }
        }
    }
  }

  // =========================
  // FOLLOW (posso seguire seme)
  // =========================
  else if (trick.length > 0 && leadSuit && legalMoves.some(c => c.suit === leadSuit)) {
    // carta vincente attuale sul seme di attacco
    let maxVal = -1;
    trick.forEach(t => {
      if (t.card.suit === leadSuit && t.card.value > maxVal) maxVal = t.card.value;
    });

    const trickCardsSoFar = trick.map(t => t.card);
    const currentNetIfSomeoneWins = netIfWinTrick(trickCardsSoFar);

    // Se la presa fin qui è "pulita" (net +10), voglio spesso prenderla per negarla agli altri
    // Se è avvelenata (net negativo), voglio duckare.
    const shouldTryToWin = cappotto
      ? true
      : (currentNetIfSomeoneWins >= 9); // quasi pulita => prendo

    console.log(`%c[FOLLOW] Max tavolo: ${maxVal}. Valore presa netto: ${currentNetIfSomeoneWins}`, LOG_INFO);
    console.log(`%c[FOLLOW] Intenzione: ${shouldTryToWin ? 'VINCERE (Clean/Cappotto)' : 'DUCKING (Schivare)'}`, LOG_INFO);

    const sortedAsc = [...legalMoves].sort(asc);
    const sortedDesc = [...legalMoves].sort(desc);

    // Trova la minima carta che può vincere
    const winning = sortedAsc.find(c => c.value > maxVal);
    // Trova la massima carta che resta sotto (duck "alto")
    const duckHigh = [...sortedDesc].find(c => c.value < maxVal);

    if (shouldTryToWin) {
      if (winning) {
          console.log("-> Vinco col minimo necessario");
          chosenCard = winning;           
      } else {
          console.log("-> Non posso vincere: gioco la più bassa");
          chosenCard = sortedAsc[0];                   
      }
    } else {
      if (duckHigh) {
          console.log("-> Ducking: sto sotto con la più alta possibile");
          chosenCard = duckHigh;         
      } else if (winning) {
          console.log("-> FORZATO A VINCERE: uso il minimo");
          chosenCard = winning;
      } else {
          chosenCard = sortedAsc[0];
      }
    }
  }

  // =========================
  // DISCARD (non posso seguire seme)
  // =========================
  else {
      // Qui posso buttare “veleno” nella presa di qualcun altro.
      if (cappotto) {
        console.log("%c[DISCARD] Cappotto: Scarto carte alte non-cuori", LOG_INFO);
        const nonHearts = legalMoves.filter(c => c.suit !== 'hearts');
        chosenCard = [...nonHearts].sort(desc)[0] ?? [...legalMoves].sort(desc)[0];
      } else {
        const peppa = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');
        if (peppa) {
            console.log("%c[DISCARD] SCARICO LA PEPPA (Q Pique)!", "color: red; font-weight: bold; font-size: 1.1em;");
            chosenCard = peppa;
        } else {
            const highHearts = legalMoves.filter(c => c.suit === 'hearts').sort(desc);
            if (highHearts.length > 0) {
                console.log("%c[DISCARD] Scarico Cuori alto", "color: pink;");
                chosenCard = highHearts[0];
            } else {
                const mid = legalMoves.filter(c => c.value >= 7 && c.value <= 11).sort(desc);
                if (mid.length > 0) {
                    console.log("%c[DISCARD] Scarico carta media 'infame' (7-J)", LOG_INFO);
                    chosenCard = mid[0];
                } else {
                    console.log("%c[DISCARD] Scarico carico generico più alto", LOG_INFO);
                    chosenCard = [...legalMoves].sort(desc)[0];
                }
            }
        }
      }
  }

  console.log(`%cDecisione Finale: ${chosenCard.rank} ${chosenCard.suit}`, "color: #fff; background: #2e1065; padding: 2px;");
  console.groupEnd();
  return chosenCard;
}
