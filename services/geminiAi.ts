
import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Card } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function getAiPass(hand: Card[]): Promise<string[]> {
  const handJson = JSON.stringify(hand.map(c => ({ suit: c.suit, rank: c.rank, id: c.id })));
  
  const prompt = `Sei un esperto del gioco "Peppa Scivolosa". 
Scegli 3 carte da passare per evitare penalità (Cuori e Donna di Picche).
Mazzo: ${handJson}
Restituisci solo un array JSON di 3 ID: ["id1", "id2", "id3"]`;

  try {
    const response = await ai.models.generateContent({
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
    });
    const text = response.text || "[]";
    const ids = JSON.parse(text.trim());
    return Array.isArray(ids) ? ids.slice(0, 3) : hand.sort((a,b) => b.value - a.value).slice(0, 3).map(c => c.id);
  } catch (e: any) {
    if (e.message?.includes("429") || e.message?.includes("quota")) {
      console.warn("Gemini Quota Exceeded - Using local logic for passing");
    }
    // Fallback: passa le 3 carte di valore più alto
    return hand.sort((a,b) => b.value - a.value).slice(0, 3).map(c => c.id);
  }
}

export async function getAiMove(gameState: GameState, botId: number): Promise<Card | null> {
  const bot = gameState.players.find(p => p.id === botId);
  if (!bot) return null;

  const handJson = JSON.stringify(bot.hand.map(c => ({ suit: c.suit, rank: c.rank, id: c.id })));
  const trickJson = JSON.stringify(gameState.currentTrick.map(t => ({ 
    player: gameState.players[t.playerId].name,
    card: { suit: t.card.suit, rank: t.card.rank }
  })));

  const prompt = `Gioco: Peppa Scivolosa. 
Obiettivo: Evitare di vincere prese con Cuori o Donna di Picche (-26).
Seme leader: ${gameState.leadSuit || 'Nessuno'}
Tuo Mazzo: ${handJson}
Trick attuale: ${trickJson}
Quale carta giochi? Restituisci SOLO l'ID della carta.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        temperature: 0.1,
        maxOutputTokens: 20,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    
    const rawId = response.text?.replace(/[`"']/g, "").trim();
    const selected = bot.hand.find(c => c.id === rawId);
    return selected || null;
  } catch (error: any) {
    return null; // Il chiamante gestirà il fallback
  }
}
