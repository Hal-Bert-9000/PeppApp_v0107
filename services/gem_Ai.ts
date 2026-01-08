
import { Card, GameState, Rank } from '../types';

/**
 * GEM AI - Advanced Offline Logic
 * Implementa regole specifiche:
 * 1. Mai passare 3, 4, 5 di Cuori.
 * 2. Mai passare 2 e 3 (qualsiasi seme).
 * 3. Passare carte "infami" (7, 8, 9, 10, J).
 * 4. Tenere le Picche (protezione Q).
 * 5. Tenere Asso Quadri/Fiori.
 */

// Pesi per la scelta dello scarto (Punteggio alto = Carta da passare)
const getPassScore = (card: Card): number => {
    let score = 0;

    // REGOLA 1: Non passare mai 3, 4, 5 di Cuori
    if (card.suit === 'hearts' && ['3', '4', '5'].includes(card.rank)) {
        return -1000; // Bloccate
    }

    // REGOLA 2: Non passare mai 2 e 3 (di qualsiasi seme)
    if (['2', '3'].includes(card.rank)) {
        return -500; // Bloccate
    }

    // REGOLA 3: Carte "Infami" (7-J) sono ideali da passare
    // Sono troppo alte per stare sotto, troppo basse per vincere sicuro.
    if (['7', '8', '9', '10', 'J'].includes(card.rank)) {
        score += 150;
        // Se sono cuori "infami" ancora meglio passarli
        if (card.suit === 'hearts') score += 50; 
    }

    // REGOLA 4: Non passare quasi mai carte a Picche (servono per parare la Q o se si ha la Q)
    if (card.suit === 'spades') {
        // Eccezione: se ho A, K di picche e poche picche, sono pericolosissime.
        if (['A', 'K'].includes(card.rank)) score += 50;
        else score -= 200; // Tieni le picche basse/medie
    }

    // REGOLA 5: Non passare mai Asso a Quadri e Fiori (controllo gioco)
    if (['A'].includes(card.rank) && (card.suit === 'diamonds' || card.suit === 'clubs')) {
        return -300; 
    }

    // Altre regole generali:
    // Passa cuori alti (A, K, Q) se non stai facendo cappotto
    if (card.suit === 'hearts' && ['A', 'K', 'Q'].includes(card.rank)) {
        score += 200;
    }

    // Passa A o K secchi di altri semi se non coperti dalle regole sopra
    if (card.value >= 13) {
        score += 80;
    }

    return score;
};

export function getGemPass(hand: Card[]): string[] {
    console.log("%c[GEM] Calcolo carte da passare (Regole Infami/LowHearts)...", "color: #34d399; font-weight: bold;");
    
    // Calcola score per ogni carta
    const scoredCards = hand.map(c => ({
        id: c.id,
        score: getPassScore(c)
    }));

    // Ordina decrescente (score alto = passa)
    scoredCards.sort((a, b) => b.score - a.score);

    return scoredCards.slice(0, 3).map(sc => sc.id);
}

/**
 * Logica di Gioco GEM
 * Regola 6: Cercare di prendere alla prima mano con Asso, poi K.
 */
export function getGemMove(gameState: GameState, botId: number): Card {
    const bot = gameState.players.find(p => p.id === botId);
    if (!bot) throw new Error("Bot not found");
    const hand = bot.hand;
    const trick = gameState.currentTrick;
    const leadSuit = gameState.leadSuit;
    
    // Filtra carte legali
    let legalMoves = hand;
    if (trick.length > 0 && leadSuit) {
        const following = hand.filter(c => c.suit === leadSuit);
        if (following.length > 0) legalMoves = following;
    } else {
        // Lead
        if (!gameState.heartsBroken && hand.some(c => c.suit !== 'hearts')) {
            legalMoves = hand.filter(c => c.suit !== 'hearts');
        }
    }

    if (legalMoves.length === 1) return legalMoves[0];

    // --- STRATEGIA LEAD (Primo di mano) ---
    if (trick.length === 0) {
        // REGOLA 6: Se è inizio partita (prime mani), prova a comandare con Assi sicuri
        // Consideriamo "inizio partita" se abbiamo ancora molte carte (es. > 10)
        if (hand.length > 10) {
            // Cerca Assi di Fiori o Quadri
            const earlyAce = legalMoves.find(c => c.rank === 'A' && (c.suit === 'clubs' || c.suit === 'diamonds'));
            if (earlyAce) {
                console.log(`%c[GEM] Regola 6: Lead aggressivo con Asso (${earlyAce.id})`, "color: #34d399;");
                return earlyAce;
            }
            // Se non ho Asso, ma ho il K e l'Asso è già uscito (memoria semplice: controlliamo se abbiamo il K)
            // Per ora semplifichiamo: se ho il K e una buona sequenza, gioco K.
            const earlyKing = legalMoves.find(c => c.rank === 'K' && (c.suit === 'clubs' || c.suit === 'diamonds'));
            if (earlyKing) {
                 // Semplificazione: gioca K se ti senti forte
                 return earlyKing;
            }
        }

        // Strategia standard Lead: Gioca la carta più bassa possibile (meglio se non picche)
        // Evita di aprire a picche se possibile
        const nonSpades = legalMoves.filter(c => c.suit !== 'spades');
        const candidates = nonSpades.length > 0 ? nonSpades : legalMoves;
        return candidates.sort((a, b) => a.value - b.value)[0];
    }

    // --- STRATEGIA FOLLOW (Rispondere) ---
    if (trick.length > 0 && leadSuit) {
        // Calcola vincente attuale
        let maxVal = -1;
        trick.forEach(t => {
            if (t.card.suit === leadSuit && t.card.value > maxVal) maxVal = t.card.value;
        });

        // 1. DUCKING: Prova a stare sotto
        // Ordina le mosse dalla più alta alla più bassa
        const sortedMoves = [...legalMoves].sort((a, b) => b.value - a.value);
        const safeCard = sortedMoves.find(c => c.value < maxVal);

        if (safeCard) {
            // Se posso stare sotto, gioco la carta più alta che mi permette di stare sotto (Massimizzo lo scarto di carte "infami" come il J o 10 se non prendono)
            return safeCard;
        } else {
            // 2. MUST WIN: Devo prendere per forza
            // Se devo prendere, prendo col massimo per liberarmi di carichi (Regola implicita)
            // MA attenzione alla Q di Picche. Se gioco Picche > K e c'è la Q in giro... rischio.
            
            // Regola 6 (parte 2): Se devo prendere e ho Asso o K, usiamoli ora che sono "costretto" così me li levo.
            return sortedMoves[0]; // Gioca la più alta
        }
    }

    // --- STRATEGIA DISCARD (Scarto su altro seme) ---
    // Priorità: Q Picche -> A/K Picche (se pericolosi) -> Cuori Alti -> Carte Infami (7-J)
    
    // 1. Via la Q Picche
    const qSpade = legalMoves.find(c => c.suit === 'spades' && c.rank === 'Q');
    if (qSpade) return qSpade;

    // 2. Via Cuori Alti (A, K, Q, J)
    const highHearts = legalMoves.filter(c => c.suit === 'hearts' && c.value >= 11).sort((a,b) => b.value - a.value);
    if (highHearts.length > 0) return highHearts[0];

    // 3. Via Asso o K di Picche (pericolo)
    const highSpades = legalMoves.filter(c => c.suit === 'spades' && c.value >= 13);
    if (highSpades.length > 0) return highSpades[0];

    // 4. Via Carte Infami (7, 8, 9, 10, J) di qualsiasi seme
    const infami = legalMoves.filter(c => c.value >= 7 && c.value <= 11).sort((a,b) => b.value - a.value);
    if (infami.length > 0) return infami[0];

    // 5. Via la più alta
    return [...legalMoves].sort((a, b) => b.value - a.value)[0];
}
