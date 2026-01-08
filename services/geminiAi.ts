
import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Card } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Funzione helper per gestire il timeout di 15 secondi
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout superato (${ms}ms)`)), ms)
        )
    ]);
};

export async function getAiPass(hand: Card[]): Promise<string[]> {
  console.log("%c[Gemini] Inizio strategia passaggio...", "color: cyan");
  const start = Date.now();

  const handJson = JSON.stringify(hand.map(c => ({ suit: c.suit, rank: c.rank, id: c.id, value: c.value })));
  
  const prompt = `Sei un giocatore esperto di "Hearts" (Peppa). 
Devi passare 3 carte a un avversario.
Obiettivo: Liberarsi di carte alte o pericolose (Asso/Re/Donna di Picche, carte alte di Cuori).
La tua mano: ${handJson}
Restituisci SOLO un array JSON di 3 ID (stringhe) delle carte da passare: ["id1", "id2", "id3"]`;

  try {
    // Timeout impostato a 15 secondi
    const response = await withTimeout(
        ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING,
            }
            }
        }
        }),
        15000 // 15000ms = 15 secondi
    );

    const elapsed = Date.now() - start;
    console.log(`%c[Gemini] Risposta passaggio ricevuta in ${elapsed}ms`, "color: lime", response.text);

    const text = response.text || "[]";
    const ids = JSON.parse(text.trim());
    
    // Validazione base: devono essere 3 ID e devono esistere nella mano
    if (Array.isArray(ids) && ids.length === 3 && ids.every(id => hand.some(c => c.id === id))) {
        return ids;
    }
    throw new Error("Formato risposta AI non valido");

  } catch (e: any) {
    const elapsed = Date.now() - start;
    console.warn(`%c[Gemini] Errore o Timeout dopo ${elapsed}ms: ${e.message}. Uso Fallback.`, "color: orange");
    // Fallback: passa le 3 carte di valore più alto
    return hand.sort((a,b) => b.value - a.value).slice(0, 3).map(c => c.id);
  }
}

export async function getAiMove(gameState: GameState, botId: number): Promise<Card | null> {
  // console.log(`%c[Gemini] Bot ${botId} sta pensando...`, "color: cyan");
  const start = Date.now();
  
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) return null;

  // Filtra carte giocabili per l'AI per inviare al prompt solo quelle valide (ottimizza il contesto)
  let playable = bot.hand;
  if (gameState.currentTrick.length > 0 && gameState.leadSuit) {
      const sameSuit = bot.hand.filter(c => c.suit === gameState.leadSuit);
      if (sameSuit.length > 0) playable = sameSuit;
  }
  // Regola cuori spezzati se è il primo di mano
  if (gameState.currentTrick.length === 0 && !gameState.heartsBroken && playable.length > 0) {
      const nonHearts = playable.filter(c => c.suit !== 'hearts');
      if (nonHearts.length > 0) playable = nonHearts;
  }

  const handJson = JSON.stringify(playable.map(c => ({ suit: c.suit, rank: c.rank, id: c.id, value: c.value })));
  const trickJson = JSON.stringify(gameState.currentTrick.map(t => ({ 
    card: { suit: t.card.suit, rank: t.card.rank, value: t.card.value }
  })));

  const prompt = `Gioco: Hearts (Peppa).
Obiettivo: Evitare di prendere cuori o la donna di picche (Q-spades).
Seme conduttore: ${gameState.leadSuit || 'Nessuno'}.
Carte sul tavolo: ${trickJson}
Le tue carte GIOCABILI: ${handJson}
Scegli la carta migliore da giocare. Restituisci SOLO l'ID della carta.`;

  try {
    // Timeout impostato a 15 secondi
    const response = await withTimeout(
        ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
            temperature: 0.1,
            maxOutputTokens: 20,
            thinkingConfig: { thinkingBudget: 0 }
        }
        }), 
        15000 // 15 secondi
    );
    
    const elapsed = Date.now() - start;
    const rawId = response.text?.replace(/[`"'\n\[\]]/g, "").trim();
    
    console.log(`%c[Gemini] Bot ${botId} ha scelto ${rawId} in ${elapsed}ms`, "color: lime");

    // Cerca l'ID nella mano completa del bot
    const selected = bot.hand.find(c => c.id === rawId);
    return selected || null;

  } catch (error: any) {
    const elapsed = Date.now() - start;
    console.warn(`%c[Gemini] Errore/Timeout Bot ${botId} dopo ${elapsed}ms: ${error.message}. Uso Fallback.`, "color: orange");
    return null; // Il chiamante gestirà il fallback
  }
}
