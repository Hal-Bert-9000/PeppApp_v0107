// hal_bAi.ts

import { Card, Suit, Rank } from '../types'; // Importiamo Card, Suit e Rank dal tuo types.ts

/**
 * Decide quali 3 carte passare nel gioco "Peppa Scivolosa" per l'AI.
 * Implementa una logica di scoring e di valutazione per la strategia "Cappotto" o "Difensiva".
 *
 * @param hand Una lista di oggetti Card che rappresentano la mano dell'AI.
 * @returns Una lista di stringhe (ID delle carte) delle 3 carte da passare.
 */
export function getHalBPassthroughCards(hand: Card[]): string[] {
    if (hand.length <= 3) {
        // Se abbiamo 3 o meno carte, passiamo tutte quelle che abbiamo
        return hand.map(card => card.id);
    }

    // --- Step 1: Valutazione se la mano è adatta per un "Cappotto" ---
    let qSpadeInHand: Card | undefined;
    let heartCount = 0;
    const highHeartsRanks: Rank[] = ['A', 'K', 'Q', 'J']; // Usiamo il tuo Rank type
    let highHeartsInHandCount = 0;
    let highNonHeartCardsCount = 0; // Assi, Re, Donne negli altri semi

    for (const card of hand) {
        if (card.suit === 'spades' && card.rank === 'Q') {
            qSpadeInHand = card;
        } else if (card.suit === 'hearts') {
            heartCount++;
            if (highHeartsRanks.includes(card.rank)) {
                highHeartsInHandCount++;
            }
        } else if (['A', 'K', 'Q'].includes(card.rank)) {
            // Non considerare la Q di Picche di nuovo, che è un caso speciale.
            // Contiamo le carte alte (A, K, Q) degli altri semi (quadri, fiori, picche escluse Q)
            if (!(card.suit === 'spades' && card.rank === 'Q')) {
                highNonHeartCardsCount++;
            }
        }
    }

    // Criteri semplificati per un potenziale Cappotto (da testare e raffinare nel tuo gioco)
    // Questa è una stima euristica. La complessità reale per un Cappotto effettivo sarebbe maggiore.
    const isCappottoStrategy = qSpadeInHand !== undefined && heartCount >= 7 && highHeartsInHandCount >= 3 && highNonHeartCardsCount >= 2;


    // --- Step 2: Assegnazione del Punteggio di "Indesiderabilità" / "Sacrificabilità" ---
    const cardScores: { [cardId: string]: number } = {}; // Mappa ID carta a punteggio

    for (const card of hand) {
        let score = 0;

        if (isCappottoStrategy) {
            // Strategia di Cappotto: vogliamo tenere le carte punti e le carte alte per fare prese
            if (card.suit === 'spades' && card.rank === 'Q') {
                score = -1000; // Massima priorità per TENERE la Peppa (punteggio negativo alto)
            } else if (card.suit === 'hearts') {
                score = -500; // Alta priorità per TENERE i Cuori
                if (highHeartsRanks.includes(card.rank)) {
                    score -= 100; // Ancora più priorità per i Cuori alti
                }
            } else if (['A', 'K', 'Q'].includes(card.rank)) {
                // Priorità per TENERE carte alte per fare prese (non cuori, non Q di picche)
                if (!(card.suit === 'spades' && card.rank === 'Q')) {
                     score = -300;
                }
            } else {
                // Carte basse e non pericolose negli altri semi sono sacrificabili
                score = 10 + card.value; // Usiamo direttamente card.value ora!
                                         // Più alto è il rank, più facilmente sacrificabile in questa strategia.
            }
        } else {
            // Strategia Difensiva: vogliamo eliminare le carte pericolose
            if (card.suit === 'spades' && card.rank === 'Q') {
                score = 1000; // Massima priorità per PASSARE la Peppa (punteggio positivo alto)
            } else if (card.suit === 'hearts') {
                score = 500 + card.value; // Usiamo direttamente card.value ora!
                                          // Più alto è il Cuore, più è prioritario da passare
            } else {
                // Valutazione per voiding (costruire un seme corto)
                // Conta quante carte ci sono di quel seme nella mano
                const sameSuitCards = hand.filter(c => c.suit === card.suit);
                if (sameSuitCards.length <= 2 && !(['A', 'K', 'Q'].includes(card.rank))) { // Se il seme è corto e la carta non è alta
                    score += 200 + card.value; // Usiamo direttamente card.value ora!
                                                // Buona candidata per voiding, con carte basse preferite
                }

                // Carte basse e inutili in semi lunghi
                if (['2', '3', '4', '5'].includes(card.rank) && sameSuitCards.length > 2) {
                    score += 50;
                }
            }
        }
        cardScores[card.id] = score;
    }

    // --- Step 3: Selezione Finale ---
    // Ordina le carte in base al loro punteggio di indesiderabilità/sacrificabilità in ordine decrescente
    const sortedCards = [...hand].sort((a, b) => cardScores[b.id] - cardScores[a.id]);

    // Restituisce gli ID delle prime 3 carte
    return sortedCards.slice(0, 3).map(card => card.id);
}
