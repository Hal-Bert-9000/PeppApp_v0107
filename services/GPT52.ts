
import { Card, GameState, Rank } from '../types';

/**
 * AI GPT52 (Peppa variante aggressiva/calcolatrice):
 * - Logica avanzata per cappotto e ducking.
 */

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
  console.log("%c[GPT52] Calcolo carte da passare (Advanced AI)...", "color: #818cf8; font-weight: bold;");
  const cappotto = wantsCappotto(hand);

  const scoredCards = hand.map(c => ({
    id: c.id,
    score: getPassScore(c, hand, cappotto),
  }));

  scoredCards.sort((a, b) => b.score - a.score);
  return scoredCards.slice(0, 3).map(sc => sc.id);
}

// ---------- MOVE ----------
export function getGPT52Move(gameState: GameState, botId: number): Card {
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) throw new Error("Bot not found");

  const hand = bot.hand;
  const trick = gameState.currentTrick;
  const leadSuit = gameState.leadSuit;

  // --- legal moves (qui NON imponiamo restrizioni sui cuori, perché il gioco non le ha) ---
  let legalMoves = hand;
  if (trick.length > 0 && leadSuit) {
    const following = hand.filter(c => c.suit === leadSuit);
    if (following.length > 0) legalMoves = following;
  }

  if (legalMoves.length === 1) return legalMoves[0];

  const cappotto = wantsCappotto(hand);
  const risk = poisonRiskFactor(hand.length);

  // Helpers ordinamenti
  const asc = (a: Card, b: Card) => a.value - b.value;
  const desc = (a: Card, b: Card) => b.value - a.value;

  // Carte "pulite" = non cuori e non Q♠
  const isClean = (c: Card) => !(c.suit === 'hearts' || (c.suit === 'spades' && c.rank === 'Q'));

  // =========================
  // LEAD (inizio presa)
  // =========================
  if (trick.length === 0) {
    if (cappotto) {
      // In cappotto spesso vuoi guidare cuori per raccoglierli (e cercare di trascinare dentro anche peppa)
      const hearts = legalMoves.filter(c => c.suit === 'hearts').sort(desc);
      if (hearts.length > 0) return hearts[0];
      // Se non ho cuori, guida alto in un seme dove puoi prendere (per controllare)
      const highNonHearts = legalMoves.filter(c => c.suit !== 'hearts').sort(desc);
      return highNonHearts[0];
    }

    // Non cappotto:
    // 1) Evita di guidare cuori se possibile (puoi regalare una presa "pulita" a qualcuno o peggio)
    // 2) Preferisci guidare carte “pulite” e relativamente alte in semi non-cuori per prendere +10 netti,
    //    MA attenzione: più tardi nella mano, più rischio che ti scarichino cuori/peppa.
    const clean = legalMoves.filter(isClean);

    // Se rischio alto (fine mano), meglio lead basso e “innocuo” per non essere avvelenato
    if (risk >= 0.6) {
      const lowClean = clean.length ? [...clean].sort(asc)[0] : [...legalMoves].sort(asc)[0];
      return lowClean;
    }

    // Se rischio medio/basso: prova a “comandare” con A/K non-cuori (prese pulite)
    const strongClean = clean.filter(c => c.rank === 'A' || c.rank === 'K').sort(desc);
    if (strongClean.length > 0) return strongClean[0];

    // Altrimenti guida la più alta pulita (per prendere), se non esiste guida la più bassa
    if (clean.length > 0) return [...clean].sort(desc)[0];
    return [...legalMoves].sort(asc)[0];
  }

  // =========================
  // FOLLOW (posso seguire seme)
  // =========================
  if (trick.length > 0 && leadSuit && legalMoves.some(c => c.suit === leadSuit)) {
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

    const sortedAsc = [...legalMoves].sort(asc);
    const sortedDesc = [...legalMoves].sort(desc);

    // Trova la minima carta che può vincere
    const winning = sortedAsc.find(c => c.value > maxVal);
    // Trova la massima carta che resta sotto (duck "alto")
    const duckHigh = [...sortedDesc].find(c => c.value < maxVal);

    if (shouldTryToWin) {
      if (winning) return winning;           // vinco col minimo necessario
      return sortedAsc[0];                   // non posso vincere: gioco la più bassa
    } else {
      if (duckHigh) return duckHigh;         // ducko con la più alta sotto (mantengo controllo)
      // Se non posso duckare (sono costretto a vincere), vinco col minimo per non bruciarmi carte
      if (winning) return winning;
      return sortedAsc[0];
    }
  }

  // =========================
  // DISCARD (non posso seguire seme)
  // =========================
  // Qui posso buttare “veleno” nella presa di qualcun altro.

  if (cappotto) {
    // Se faccio cappotto NON scarico cuori/peppa: voglio prenderli io.
    // Scarto carte alte non-cuori che potrebbero farmi vincere prese “sporche” più avanti.
    const nonHearts = legalMoves.filter(c => c.suit !== 'hearts');
    const safeDump = [...nonHearts].sort(desc)[0] ?? [...legalMoves].sort(desc)[0];
    return safeDump;
  }

  // 1) Scarica Q♠ subito
  const peppa = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');
  if (peppa) return peppa;

  // 2) Scarica cuori alti (massima penalità)
  const highHearts = legalMoves.filter(c => c.suit === 'hearts').sort(desc);
  if (highHearts.length > 0) return highHearts[0];

  // 3) Scarica carte medie (7-J) che spesso “incastrano” e ti fanno prendere prese avvelenate
  const mid = legalMoves.filter(c => c.value >= 7 && c.value <= 11).sort(desc);
  if (mid.length > 0) return mid[0];

  // 4) Scarica alte non-cuori (per ridurre rischio di vincere prese avvelenate più avanti)
  const highNonHearts = legalMoves.filter(c => c.suit !== 'hearts').sort(desc);
  if (highNonHearts.length > 0) return highNonHearts[0];

  // 5) fallback: più alta
  return [...legalMoves].sort(desc)[0];
}
