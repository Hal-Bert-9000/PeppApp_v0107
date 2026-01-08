
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameState, Card, Player, PassDirection } from './types';
import { createDeck, shuffle } from './constants';
import { getAiPass, getAiMove } from './services/geminiAi';
import PlayingCard from './components/PlayingCard';

const TOTAL_ROUNDS = 4;
const USER_TURN_TIME = 40;
const BOT_MAX_TIME = 15; // Aumentato visualmente per matchare il timeout AI
const ATTESA = 2000; // ms

const AI_NAMES = [
  "Andrew Martin", "Bomb #20", "HAL 9000", "Joshua WOPR", 
  "MU‑TH‑UR 6000", "Neuromancer", "Nexus‑7", "R. Daneel Olivaw", 
  "Robbie", "SAM 104", "T‑800", "Roy Batty"
];

const App: React.FC = () => {
  const botNames = useMemo(() => shuffle([...AI_NAMES]).slice(0, 3), []);
  // Mazziere iniziale casuale (Regola n.6)
  const [dealerOffset] = useState(() => Math.floor(Math.random() * 4));

  const initialPlayers: Player[] = useMemo(() => [
    { id: 0, name: 'Charlie Bartom', hand: [], isHuman: true, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [] },
    { id: 1, name: botNames[0], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [] },
    { id: 2, name: botNames[1], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [] },
    { id: 3, name: botNames[2], hand: [], isHuman: false, score: 0, pointsThisRound: 0, tricksWon: 0, selectedToPass: [] },
  ], [botNames]);

  const [gameState, setGameState] = useState<GameState>({
    players: initialPlayers,
    currentTrick: [],
    turnIndex: 0,
    leadSuit: null,
    heartsBroken: false,
    roundNumber: 1,
    passDirection: 'right', // Inizia con Destra (Nuova Regola n.4)
    gameStatus: 'dealing',
    winningMessage: null,
    receivedCards: []
  });

  const [timeLeft, setTimeLeft] = useState(USER_TURN_TIME);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastWinnerId, setLastWinnerId] = useState<number | null>(null);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calcolo dinamico del Mazziere e del Primo di Mano
  const dealerIndex = (gameState.roundNumber - 1 + dealerOffset) % 4;
  const isUserDealer = dealerIndex === 0;
  const startingPlayerIndex = (gameState.roundNumber + dealerOffset) % 4;

  const getRank = (playerId: number) => {
    const isScoring = gameState.gameStatus === 'scoring' || gameState.gameStatus === 'gameOver';
    const scores = gameState.players.map(p => p.score + (isScoring ? p.pointsThisRound : 0));
    const sortedScores = [...new Set(scores)].sort((a, b) => b - a);
    const player = gameState.players.find(p => p.id === playerId)!;
    const scoreToCompare = player.score + (isScoring ? player.pointsThisRound : 0);
    return sortedScores.indexOf(scoreToCompare) + 1;
  };

  const getHeuristicMove = useCallback((hand: Card[], leadSuit: Card['suit'] | null, heartsBroken: boolean): Card => {
    let playable = hand;
    if (leadSuit) {
      const sameSuit = hand.filter(c => c.suit === leadSuit);
      if (sameSuit.length > 0) playable = sameSuit;
    } else {
        // Se non c'è lead suit e i cuori non sono rotti, evita di giocare cuori se possibile
        if (!heartsBroken && hand.length > 0) {
            const nonHearts = hand.filter(c => c.suit !== 'hearts');
            if (nonHearts.length > 0) playable = nonHearts;
        }
    }
    // Euristica semplice: gioca la carta più bassa disponibile
    return [...playable].sort((a,b) => a.value - b.value)[0];
  }, []);

  const playCard = useCallback((playerId: number, card: Card) => {
    setGameState(prev => {
      if (prev.currentTrick.some(t => t.playerId === playerId)) return prev;
      if (prev.turnIndex !== playerId) return prev;
      const isLead = prev.currentTrick.length === 0;
      const nextPlayers = prev.players.map(p => 
        p.id === playerId ? { ...p, hand: p.hand.filter(c => c.id !== card.id) } : p
      );
      return {
        ...prev,
        players: nextPlayers,
        currentTrick: [...prev.currentTrick, { playerId, card }],
        turnIndex: (prev.turnIndex + 1) % 4,
        leadSuit: isLead ? card.suit : prev.leadSuit,
        heartsBroken: prev.heartsBroken || card.suit === 'hearts'
      };
    });
  }, []);

  // --- GESTIONE PASSAGGIO CARTE BOT (INTEGRAZIONE GEMINI) ---
  useEffect(() => {
    if (gameState.gameStatus === 'passing') {
      if (gameState.passDirection === 'none') return; 
      
      const botsWithoutPass = gameState.players.filter(p => !p.isHuman && p.selectedToPass.length === 0);
      
      // Funzione asincrona per gestire la selezione delle carte dei bot
      const processBotPasses = async () => {
          for (const bot of botsWithoutPass) {
              // getAiPass ha già un fallback interno se Gemini fallisce/timeout
              const selectedIds = await getAiPass(bot.hand);
              
              setGameState(prev => ({
                ...prev,
                players: prev.players.map(p => p.id === bot.id ? { ...p, selectedToPass: selectedIds } : p)
              }));
          }
      };

      if (botsWithoutPass.length > 0) {
          processBotPasses();
      }
    }
  }, [gameState.gameStatus, gameState.passDirection, gameState.players]); // Aggiunto gameState.players per monitorare changes

  // --- TIMER ---
  useEffect(() => {
    if (gameState.gameStatus === 'playing' && gameState.currentTrick.length < 4) {
      const currentPlayer = gameState.players[gameState.turnIndex];
      // Se è un bot diamo tempo visivo fino a 15s, se umano 40s
      setTimeLeft(currentPlayer.isHuman ? USER_TURN_TIME : BOT_MAX_TIME);
      
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setTimeLeft(prev => prev > 0 ? prev - 1 : 0), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState.turnIndex, gameState.gameStatus, gameState.currentTrick.length]);

  // --- AUTO-PLAY UMANO SE SCADE TEMPO ---
  useEffect(() => {
    if (timeLeft === 0 && gameState.gameStatus === 'playing' && !isProcessing) {
      const currentPlayer = gameState.players[gameState.turnIndex];
      // Solo per umano, i bot sono gestiti dall'effetto successivo
      if (currentPlayer.isHuman && currentPlayer.hand.length > 0) {
        const card = getHeuristicMove(currentPlayer.hand, gameState.leadSuit, gameState.heartsBroken);
        if (card) playCard(gameState.turnIndex, card);
      }
    }
  }, [timeLeft, gameState.gameStatus, isProcessing]);

  // --- GESTIONE MOSSA BOT (INTEGRAZIONE GEMINI CON TIMEOUT) ---
  useEffect(() => {
    const currentPlayer = gameState.players[gameState.turnIndex];
    
    // Se tocca a un bot, non stiamo già processando e la mano non è finita
    if (gameState.gameStatus === 'playing' && !currentPlayer.isHuman && gameState.currentTrick.length < 4 && !isProcessing) {
      setIsProcessing(true);

      const makeBotMove = async () => {
          // Attesa minima di 1 secondo per UX (così non gioca istantaneamente)
          const minDelayPromise = new Promise(resolve => setTimeout(resolve, 1000));
          
          // Chiamata a Gemini (che ha un timeout interno di 15s nel service)
          const aiMovePromise = getAiMove(gameState, currentPlayer.id);

          // Attendiamo il completamento di entrambi (il più lento definisce il tempo, ma Gemini ha un cap di 15s)
          const [_, aiCard] = await Promise.all([minDelayPromise, aiMovePromise]);
          
          // Se Gemini restituisce null (errore o timeout), usiamo l'euristica
          const finalCard = aiCard || getHeuristicMove(currentPlayer.hand, gameState.leadSuit, gameState.heartsBroken);
          
          playCard(gameState.turnIndex, finalCard);
          setIsProcessing(false);
      };

      makeBotMove();
    }
  }, [gameState.turnIndex, gameState.gameStatus, gameState.currentTrick.length]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) { // <-- QUANDO CI SONO 4 CARTE SUL TAVOLO
      
      // Calcolo preventivo del vincitore per l'effetto UI
      const trick = gameState.currentTrick;
      const leadSuitUsed = gameState.leadSuit!;
      let winnerId = trick[0].playerId;
      let maxVal = -1;
      trick.forEach(t => {
        if (t.card.suit === leadSuitUsed && t.card.value > maxVal) {
          maxVal = t.card.value;
          winnerId = t.playerId;
        }
      });

      const timer = setTimeout(() => {         // <-- ATTESA in ms inserita nelle const in alto
        
        // Attiva l'effetto grafico per 5.5 secondi
        setLastWinnerId(winnerId);
        setTimeout(() => setLastWinnerId(null), 5500);

        setGameState(prev => {                 // ... calcolo del vincitore, assegnazione punti e pulizia del tavolo ...
          const trick = prev.currentTrick;
          const leadSuitUsed = prev.leadSuit!;
          let winnerId = trick[0].playerId;
          let maxVal = -1;
          trick.forEach(t => {
            if (t.card.suit === leadSuitUsed && t.card.value > maxVal) {
              maxVal = t.card.value;
              winnerId = t.playerId;
            }
          });

          let trickPoints = 10; 
          trick.forEach(t => {
            if (t.card.suit === 'hearts') trickPoints -= t.card.value;
            if (t.card.suit === 'spades' && t.card.rank === 'Q') trickPoints -= 26;
          });

          const nextPlayers = prev.players.map(p => p.id === winnerId ? { ...p, pointsThisRound: p.pointsThisRound + trickPoints, tricksWon: p.tricksWon + 1 } : p);
          
          if (nextPlayers[0].hand.length === 0) {
            // VERIFICA REGOLA CAPPOTTO
            // Tutti i cuori (104) + Peppa (26) = 130 punti di penalità totale
            const slamPlayer = nextPlayers.find(p => (p.tricksWon * 10 - p.pointsThisRound) === 130);
            let processedPlayers = nextPlayers;
            let slamMsg = null;

            if (slamPlayer) {
              slamMsg = `CAPPOTTO DI ${slamPlayer.name.toUpperCase()}!`;
              processedPlayers = nextPlayers.map(p => ({
                ...p,
                pointsThisRound: p.id === slamPlayer.id ? 45 : -15
              }));
            }

            const endRoundPlayers = processedPlayers.map(p => ({
              ...p, 
              score: p.score + p.pointsThisRound,
              tricksWon: 0 
            }));

            return { 
              ...prev, 
              players: endRoundPlayers, 
              gameStatus: prev.roundNumber >= TOTAL_ROUNDS ? 'gameOver' : 'scoring', 
              currentTrick: [],
              winningMessage: slamMsg
            };
          }
          return { ...prev, players: nextPlayers, currentTrick: [], turnIndex: winnerId, leadSuit: null };
        });
      }, ATTESA);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentTrick]);

  const startNewRound = useCallback(() => {
    const deck = shuffle(createDeck());
    // Regola n.4: Sequenza Destra, Sinistra, Fronte, No
    const directions: PassDirection[] = ['right', 'left', 'across', 'none'];
    const dir = directions[(gameState.roundNumber - 1) % 4];
    const hands = [deck.slice(0,13), deck.slice(13,26), deck.slice(26,39), deck.slice(39,52)];
    const newPlayers = gameState.players.map((p, i) => ({
      ...p, hand: hands[i].sort((a,b) => a.suit === b.suit ? a.value - b.value : a.suit.localeCompare(b.suit)),
      pointsThisRound: 0, tricksWon: 0, selectedToPass: []
    }));
    
    setGameState(prev => ({
      ...prev, players: newPlayers, passDirection: dir, gameStatus: 'passing', // Sempre 'passing' per mostrare il popup
      currentTrick: [], turnIndex: startingPlayerIndex, heartsBroken: false, leadSuit: null, receivedCards: [],
      winningMessage: null
    }));
  }, [gameState.roundNumber, gameState.players, startingPlayerIndex]);

  const toggleSelectToPass = (cardId: string) => {
    setGameState(prev => {
      const p = prev.players[0];
      const isSelected = p.selectedToPass.includes(cardId);
      if (!isSelected && p.selectedToPass.length >= 3) return prev;
      const next = isSelected ? p.selectedToPass.filter(id => id !== cardId) : [...p.selectedToPass, cardId];
      return { ...prev, players: prev.players.map(pl => pl.id === 0 ? { ...pl, selectedToPass: next } : pl) };
    });
  };

  const executePass = async () => {
    await new Promise(r => setTimeout(r, 1000));
    setGameState(prev => {
      const cardsToPass = prev.players.map(p => p.hand.filter(c => p.selectedToPass.includes(c.id)));
      const newPlayers = prev.players.map((p, i) => {
        let fromIdx = 0;
        if (prev.passDirection === 'left') fromIdx = (i + 1) % 4;
        else if (prev.passDirection === 'right') fromIdx = (i + 3) % 4;
        else if (prev.passDirection === 'across') fromIdx = (i + 2) % 4;
        
        const newHand = p.hand.filter(c => !p.selectedToPass.includes(c.id)).concat(cardsToPass[fromIdx]);
        return { ...p, hand: newHand.sort((a,b) => a.suit === b.suit ? a.value - b.value : a.suit.localeCompare(b.suit)), selectedToPass: [] };
      });
      
      const receiverIdx = (0 + (prev.passDirection === 'left' ? 1 : prev.passDirection === 'right' ? 3 : 2)) % 4;
      return { 
        ...prev, 
        players: newPlayers, 
        gameStatus: 'receiving', 
        receivedCards: cardsToPass[receiverIdx], 
        turnIndex: startingPlayerIndex 
      };
    });
  };

  const currentTrickValue = useMemo(() => {
    let pts = 10; 
    if (gameState.currentTrick && gameState.currentTrick.length > 0) {
      gameState.currentTrick.forEach(t => {
        if (t.card.suit === 'hearts') pts -= t.card.value;
        if (t.card.suit === 'spades' && t.card.rank === 'Q') pts -= 26;
      });
    }
    return pts;
  }, [gameState.currentTrick]);
  {/* --------------- COMPOSIZIONE UI_SMALL ------------------*/}
  const PlayerInfoWidget = ({ player, isBot, isCurrent, isLastWinner }: { player: Player, isBot: boolean, isCurrent: boolean, isLastWinner: boolean }) => (
    <div className={`flex flex-row items-center gap-2 bg-black/65 px-2 py-2 rounded-xl border 
      ${isLastWinner 
          ? 'border-b-4 border-b-sky-400 shadow-[0_15px_20px_rgba(44,153,255,0.85)] border-t-white/10 border-x-white/10' // shadow-[0_0_25px_5px_rgba(44,153,255,10.85)]
          : (isCurrent 
              ? 'border-yellow-400 scale-105 shadow-[0_0_15px_rgba(250,204,21,0.3)]' 
              : 'border-white/10')
      } 
      shadow-xl backdrop-blur-md transition-all duration-300 pointer-events-auto`}>
      <div className="flex flex-col min-w-[70px]">
        <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-0.5">{isBot ? 'Bot' : 'Giocatore'}</span>
        <span className="font-bold text-sm tracking-tight truncate">{player.name}</span>
      </div>
      <div className="w-[1px] h-6 bg-white/10" />
      <div className="flex flex-col items-center w-[40px]">
        <span className="text-[9px] font-bold opacity-40 uppercase">Rank</span>
        <span className="font-bold text-yellow-400 text-base">{getRank(player.id)}°</span>
      </div>
      <div className="w-[1px] h-6 bg-white/10" />
      <div className="flex flex-col items-center w-[40px]">
        <span className="text-[9px] font-bold opacity-40 uppercase">Prese</span>
        <span className="font-bold text-base text-cyan-400">{player.tricksWon}</span>
      </div>
      <div className="w-[1px] h-6 bg-white/10" />
      <div className="flex flex-col items-center w-[40px]">
        <span className="text-[9px] font-bold opacity-40 uppercase">Punti</span>
        <span className={`font-bold text-base ${player.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {player.score}
        </span>
      </div>
    </div>
  );

  const getTranslatedDirection = (dir: PassDirection) => {
    switch (dir) {
      case 'left': return 'S';
      case 'right': return 'D';
      case 'across': return 'C';
      case 'none': return '-';
      default: return dir;
    }
  };

  const getPassDirectionDescription = (dir: PassDirection) => {
    switch (dir) {
      case 'left': return 'LE CARTE SI PASSANO A SINISTRA';
      case 'right': return 'LE CARTE SI PASSANO A DESTRA';
      case 'across': return 'LE CARTE SI PASSANO AL CENTRO';
      case 'none': return 'LE CARTE NON SI PASSANO';
      default: return '';
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center overflow-hidden text-white font-sans select-none relative">
       {/* ---------------  ------------------*/}
      <div className="relative w-full h-full flex items-center justify-center z-10 pointer-events-none">
        {/* --------------- Bot Widgets ----------------- UI_small ?? ----------- */}
        <div className="absolute top-[3vh] left-1/2 -translate-x-1/2 z-20">
          <PlayerInfoWidget player={gameState.players[2]} isBot={true} isCurrent={gameState.turnIndex === 2 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 2} />
        </div>
        <div className="absolute left-[1vw] top-[70vh] z-20">
          <PlayerInfoWidget player={gameState.players[1]} isBot={true} isCurrent={gameState.turnIndex === 1 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 1} />
        </div>
        <div className="absolute right-[1vw] top-[70vh] z-20">
          <PlayerInfoWidget player={gameState.players[3]} isBot={true} isCurrent={gameState.turnIndex === 3 && gameState.gameStatus === 'playing'} isLastWinner={lastWinnerId === 3} />
        </div>
        
        {/* -------- POSIZIONE VALORE MANO (FLUTTUANTE AL CENTRO) 
        {gameState.currentTrick.length > 0 && (
          <div className="absolute top-[35%] left-[50%] -translate-x-1/2 -translate-y-1/2 z-[300]">
             <div className={`animate-pulse slow text-5xl font-extrabold drop-shadow-[0_0_16px_rgba(255,255,255,0.8)] ${currentTrickValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {currentTrickValue > 0 ? `+${currentTrickValue}` : currentTrickValue}
             </div>
          </div>
        )}    -------- */}

        {/* --------------- POSIZIONE CARTE SUL TAVOLO ------------------*/}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none shadow-none">
          {gameState.currentTrick.map((t) => {
            let positionClasses = "";
            let rotation = "";
            switch (t.playerId) {
              case 0: positionClasses = "left-[48%] top-[69%] -translate-x-1/2 scale-120 z-[300]"; rotation = "rotate-0"; break; // SUD USER
              case 1: positionClasses = "left-[42%] top-[61%] -translate-y-1/2 z-[250]"; rotation = "-rotate-90"; break; // OVEST SINISTRA
              case 2: positionClasses = "left-[51%] top-[51%] -translate-x-1/2 z-[200]"; rotation = "rotate-180"; break; // NORD 
              case 3: positionClasses = "right-[40%] top-[62%] -translate-y-1/2 z-[250]"; rotation = "rotate-90"; break; // EST DESTRA
            }
            return (
              <div key={t.playerId} className={`absolute transition-all duration-500 animate-deal ${positionClasses} ${rotation} z-20`}>
                <PlayingCard card={t.card} isSmall scale={1.4} noShadow />
              </div>
            );
          })}
        </div>
      </div>

      {/* --------------------- USER DASHBOARD WIDGET (SUD) ---------------------- */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[350] pointer-events-none">
        <div className={`flex flex-row items-center justify-between gap-2 bg-black/65 px-2 py-2 rounded-xl border 
            ${lastWinnerId === 0 
                ? 'border-t-4 border-t-sky-400 shadow-[0_-15px_20px_rgba(44,153,255,0.85)] border-b-white/10 border-x-white/10' // originale: shadow-[0_0_25px_rgba(34,211,238,0.5)]
                : (gameState.turnIndex === 0 && gameState.gameStatus === 'playing' 
                    ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.3)]' 
                    : 'border-white/10')
            } 
            shadow-xl backdrop-blur-md transition-all duration-300 pointer-events-auto`}>
            
            {/* 1. Mano */}
            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Mano</span>
                <span className="font-bold text-base text-white tracking-tighter">{gameState.roundNumber} / {TOTAL_ROUNDS}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            {/* 2. Round */}
            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Round</span>
                <span className="font-bold text-base text-yellow-400 uppercase">{getTranslatedDirection(gameState.passDirection)}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            {/* 3. TRK.PT (NEW) */}
             <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">TRK.PT</span>
                <span className={`font-bold text-base ${gameState.currentTrick.length === 0 ? 'text-white/60' : (currentTrickValue >= 0 ? 'text-emerald-400' : 'text-red-400')}`}>
                   {gameState.currentTrick.length === 0 ? '--' : (currentTrickValue > 0 ? `+${currentTrickValue}` : currentTrickValue)}
                </span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            {/* 4. Giocatore */}
            <div className="flex flex-col items-center w-[140px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Giocatore</span>
                <span className="font-bold text-xl text-white truncate w-full text-center">{gameState.players[0].name}</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            {/* 5. Rank */}
             <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Rank</span>
                <span className="font-bold text-yellow-400 text-base">{getRank(0)}°</span>
            </div>
            <div className="w-[1px] h-8 bg-white/10" />

            {/* 6. Prese */}
            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Prese</span>
                <span className="font-bold text-base text-sky-400">{gameState.players[0].tricksWon}</span>
            </div>
             <div className="w-[1px] h-8 bg-white/10" />

            {/* 7. Punti */}
            <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold opacity-40 uppercase mb-1">Punti</span>
                <span className={`font-bold text-base ${gameState.players[0].score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {gameState.players[0].score}
                </span>
            </div>
             <div className="w-[1px] h-8 bg-white/10" />

            {/* 8. Time */}
             <div className="flex flex-col items-center w-[40px]">
                <span className="text-[9px] font-bold uppercase opacity-40 leading-none mb-1">Time</span>
                <span className={`font-bold text-base transition-all duration-300 ${timeLeft < 10 && gameState.gameStatus === 'playing' ? 'text-red-500 animate-pulse' : 'text-white/60'}`}>
                    {gameState.gameStatus === 'playing' ? `${timeLeft}s` : '--'}
                </span>
            </div>
        </div>
      </div>

      {/* -------------------  DISPOSIZIONE CARTE USER A VENTAGLIO ----------------------*/}
      <div className="fixed bottom-[-15px] w-full flex justify-center z-[250] px-6">
        <div className="flex justify-center -space-x-[5rem] md:-space-x-[6rem] transition-all duration-500">
          {gameState.players[0].hand.map((card, i) => {
            const total = gameState.players[0].hand.length;
            const offset = i - (total - 1) / 2;
            const rotation = offset * 4; 
            const translateY = (offset * offset) * 1.65;

            const isSelected = gameState.players[0].selectedToPass.includes(card.id);
            const isPlayable = gameState.gameStatus === 'playing' && gameState.turnIndex === 0 && (
              !gameState.leadSuit || card.suit === gameState.leadSuit || gameState.players[0].hand.every(c => c.suit !== gameState.leadSuit)
            );
            
            return (
              <div 
                key={card.id} 
                className="group relative transition-all duration-300" 
                style={{ 
                    zIndex: i,
                    transform: `translateY(${translateY}px) rotate(${rotation}deg)`,
                    transformOrigin: '50% 120%'
                }}
              >
                <div 
                    className={`transition-all duration-200 ${isSelected ? '-translate-y-8 scale-110 z-10' : 'hover:-translate-y-12 hover:scale-110 hover:z-10'}`}
                >
                    <div className="scale-110 md:scale-120">
                      <PlayingCard 
                        card={card} 
                        noShadow 
                        highlighted={isSelected || (isPlayable && gameState.gameStatus === 'playing')} 
                        onClick={() => {
                            if (gameState.gameStatus === 'passing' && gameState.passDirection !== 'none') toggleSelectToPass(card.id);
                            if (gameState.gameStatus === 'playing' && isPlayable && !isProcessing) playCard(0, card);
                        }} 
                      />
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* ------------------  PASSA 3 CARTE ---------------------*/}
      {gameState.gameStatus === 'passing' && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center pointer-events-none">
          <div className="bg-black/95 p-6 rounded-2xl border border-yellow-400/50 text-center shadow-[0_0_100px_rgba(0,0,0,0.8)] animate-deal pointer-events-auto max-w-md transform -translate-y-40">
            <h2 className="text-xl font-extrabold mb-1 text-yellow-400 uppercase tracking-tighter leading-none">{getPassDirectionDescription(gameState.passDirection)}</h2>
            {gameState.passDirection === 'none' ? (
                <button 
                  onClick={() => setGameState(prev => ({ ...prev, gameStatus: 'playing' }))}
                  className="w-full mt-4 py-3 rounded-xl font-extrabold text-lg transition-all duration-300 bg-yellow-400 text-black shadow-lg cursor-pointer hover:bg-white"
                >
                  GIOCA
                </button>
            ) : (
                <button 
                  disabled={gameState.players[0].selectedToPass.length !== 3} 
                  onClick={executePass} 
                  className={`w-full mt-4 py-3 rounded-xl font-extrabold text-lg transition-all duration-300 ${gameState.players[0].selectedToPass.length === 3 ? 'bg-yellow-400 text-black shadow-lg cursor-pointer hover:bg-white' : 'bg-white/5 text-white/50 cursor-not-allowed'}`}
                >
                  {gameState.players[0].selectedToPass.length === 3 ? 'CONFERMA' : `${3 - gameState.players[0].selectedToPass.length} DA SCEGLIERE`}
                </button>
            )}
          </div>
        </div>
      )}
      {/* ------------------  RICEVI 3 CARTE ---------------------*/}
      {gameState.gameStatus === 'receiving' && (
        <div className="fixed inset-0 bg-black/65 z-[500] flex items-center justify-center">
           <div className="bg-black/60 p-10 rounded-3xl border border-white/10 text-center animate-deal shadow-2xl backdrop-blur-xl transform -translate-y-24">
              <h2 className="text-3xl font-extrabold text-emerald-400 mb-8 uppercase tracking-tighter">Hai ricevuto:</h2>
              <div className="flex gap-4 mb-10 justify-center">{gameState.receivedCards.map(c => <PlayingCard key={c.id} card={c} isSmall />)}</div>
              <button onClick={() => setGameState(s => ({...s, gameStatus: 'playing'}))} className="w-full bg-emerald-500 py-5 rounded-full font-extrabold text-xl shadow-lg hover:bg-emerald-400 transition-colors">GIOCA</button>
           </div>
        </div>
      )}

      {/* -------------------  POPUP PUNTEGGI ----------------------*/}
      {gameState.gameStatus === 'scoring' && (
        <div className="fixed inset-0 bg-black/98 z-[600] flex items-center justify-center">
          <div className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl animate-deal transform -translate-y-12 backdrop-blur-xl">
            {gameState.winningMessage && (
              <div className="bg-yellow-400 text-black text-center py-2 rounded-xl font-black text-2xl mb-6 animate-pulse uppercase">
                {gameState.winningMessage}
              </div>
            )}
            <h2 className="text-4xl font-bold text-center mb-10 uppercase tracking-tighter">Punteggi</h2>
            <div className="space-y-3 mb-8">
              {[...gameState.players].sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={p.id} className={`flex justify-between items-center bg-white/5 py-1.5 px-5 rounded-xl border ${p.isHuman ? 'border-emerald-500' : 'border-white/5'}`}>
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold opacity-10">{i+1}</span>
                    <span className="font-bold text-lg">{p.name}</span>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className={`text-sm font-bold opacity-60 ${p.pointsThisRound >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.pointsThisRound > 0 ? `+${p.pointsThisRound}` : p.pointsThisRound}
                    </span>
                    <div className={`text-xl font-bold ${p.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.score}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setGameState(s => ({...s, roundNumber: s.roundNumber + 1, gameStatus: 'dealing'}))} className="w-full bg-emerald-500 py-5 rounded-full font-extrabold text-xl transition-all shadow-xl hover:bg-emerald-400">PROSSIMO ROUND</button>
          </div>
        </div>
      )}
      {/* -------------------  DEALING ----------------------*/}
      {gameState.gameStatus === 'dealing' && (
        <div className="fixed bottom-[10%] bg-black/98 z-[700] flex items-center justify-center">
          <div className="text-center animate-deal">
            <h1 className="text-[12rem] font-extrabold tracking-tighter text-yellow-400 leading-none">ROUND{gameState.roundNumber}</h1>
            <p className="text-2xl mb-2 font-extrabold text-yellow-400 uppercase tracking-wide leading-none">{getPassDirectionDescription(gameState.passDirection)}</p>
            <p className="text-3xl mb-12 font-extrabold tracking-[0.5em]">{isUserDealer ? 'SERVI TU LE CARTE' : `SERVE LE CARTE: ${gameState.players[dealerIndex].name}`}</p>
            <button onClick={startNewRound} className="bg-white text-black px-6 py-2 rounded-xl font-extrabold text-3xl shadow-xl hover:scale-105 active:scale-95 transition-all">VAI</button>
          </div>
        </div>
      )}
      {/* -------------------  GAME OVER ----------------------*/}
      {gameState.gameStatus === 'gameOver' && (
        <div className="fixed inset-0 bg-black z-[1000] flex flex-col items-center justify-center p-6">
           <h1 className="text-6xl font-black text-yellow-400 mb-2 uppercase tracking-tighter">Fine Partita</h1>
           <div className="w-full max-w-lg bg-white/5 rounded-3xl p-8 border border-white/10 mb-8">
              {[...gameState.players].sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={p.id} className="flex justify-between items-center py-3 border-b border-white/5 last:border-0">
                   <div className="flex items-center gap-4">
                      <span className="text-3xl font-black opacity-20">{i+1}</span>
                      <span className="text-2xl font-bold">{p.name}</span>
                   </div>
                   <span className={`text-3xl font-black ${p.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{p.score}</span>
                </div>
              ))}
           </div>
           <button onClick={() => window.location.reload()} className="bg-white text-black px-12 py-5 rounded-full font-black text-2xl hover:scale-105 transition-transform">GIOCA ANCORA</button>
        </div>
      )}
    </div>
  );
};

export default App;
