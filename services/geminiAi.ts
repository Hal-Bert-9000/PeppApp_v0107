
import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Card } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Funzione helper per il timeout
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout superato (${ms}ms)`)), ms)
        )
    ]);
};

export async function getAiPass(hand: Card[]): Promise<string[] | null> {
  // Log inizio operazione
  console.log("%c[Gemini] Inizio strategia passaggio...", "color: cyan; font-weight: bold;");
  const start = Date.now();

  const handJson = JSON.stringify(hand.map(c => ({ suit: c.suit, rank: c.rank, id: c.id })));
  
  const prompt = `Sei un esperto del gioco "Peppa Scivolosa" (Hearts). 
Scegli 3 carte da passare per evitare penalità (Cuori e Donna di Picche).
Mazzo: ${handJson}
Restituisci solo un array JSON di 3 ID: ["id1", "id2", "id3"]`;

  try {
    // 20 secondi di timeout
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
      20000 
    );

    const elapsed = Date.now() - start;
    const text = response.text || "[]";
    
    console.log(`%c[Gemini] Risposta passaggio ricevuta in ${elapsed}ms: ${text}`, "color: lime; font-weight: bold;");

    const ids = JSON.parse(text.trim());
    
    // Validazione base
    if (Array.isArray(ids) && ids.length === 3) {
      // Verifichiamo che gli ID esistano davvero nella mano
      const validIds = ids.every(id => hand.some(c => c.id === id));
      if (validIds) return ids;
    }
    throw new Error("ID carte non validi o non trovati nella mano");

  } catch (e: any) {
    const elapsed = Date.now() - start;
    console.warn(`%c[Gemini] Errore o Timeout dopo ${elapsed}ms: ${e.message}. Attivazione Fallback (Hal B).`, "color: orange; font-weight: bold;");
    return null; // Triggera il fallback nel chiamante
  }
}

export async function getAiMove(gameState: GameState, botId: number): Promise<Card | null> {
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) return null;

  // Log inizio operazione
  // console.log(`%c[Gemini] Bot ${bot.name} sta pensando alla mossa...`, "color: cyan;"); 
  const start = Date.now();

  // Ottimizzazione: invia solo dati essenziali per ridurre i token e velocizzare
  const handJson = JSON.stringify(bot.hand.map(c => ({ suit: c.suit, rank: c.rank, id: c.id, value: c.value })));
  const trickJson = JSON.stringify(gameState.currentTrick.map(t => ({ 
    card: { suit: t.card.suit, rank: t.card.rank, value: t.card.value }
  })));

  const prompt = `Gioco: Hearts (Peppa). 
Obiettivo: Evitare prese con Cuori o Q-Picche.
Lead: ${gameState.leadSuit || 'None'}
Tuo Mazzo: ${handJson}
Tavolo: ${trickJson}
Restituisci SOLO l'ID della carta da giocare.`;

  try {
    // 20 secondi di timeout
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
      20000
    );
    
    const elapsed = Date.now() - start;
    const rawId = response.text?.replace(/[`"'\n\[\]]/g, "").trim();
    
    console.log(`%c[Gemini] Bot ${bot.name} ha scelto ${rawId} in ${elapsed}ms`, "color: lime; font-weight: bold;");

    const selected = bot.hand.find(c => c.id === rawId);
    return selected || null;

  } catch (error: any) {
    const elapsed = Date.now() - start;
    console.warn(`%c[Gemini] Errore/Timeout Bot ${bot.name} dopo ${elapsed}ms: ${error.message}. Attivazione Fallback (Euristica).`, "color: orange; font-weight: bold;");
    return null; // Triggera il fallback nel chiamante
  }
}
