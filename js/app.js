import { supabase } from "./supabase.js";

/* =========================================================
   ÉLÉMENTS DE LA PAGE
========================================================= */

const $ = (id) => document.getElementById(id);

const pages = {
    home: $("home-page"),
    create: $("create-page"),
    join: $("join-page"),
    game: $("game-page")
};

// Accueil
const pseudoInput = $("pseudo-input");
const pinInput = $("pin-input");
const homeMessage = $("home-message");
const resumeBtn = $("resume-btn");
const createBtn = $("create-btn");
const joinBtn = $("join-btn");

// Création
const gameCodeElement = $("game-code");
const createPseudo = $("create-pseudo");
const copyBtn = $("copy-btn");
const copyMessage = $("copy-message");
const backFromCreateBtn = $("back-from-create-btn");

// Rejoindre / reprendre
const joinCodeInput = $("join-code");
const joinGameBtn = $("join-game-btn");
const joinMessage = $("join-message");
const backFromJoinBtn = $("back-from-join-btn");

// Jeu
const gameCodeBadge = $("game-code-badge");
const roundNumberElement = $("round-number");
const themeElement = $("theme");
const answerInput = $("answer-input");
const submitAnswerBtn = $("submit-answer-btn");
const answerMessage = $("answer-message");
const myPseudoBadge = $("my-pseudo-badge");
const opponentPseudoBadge = $("opponent-pseudo-badge");
const myNameElement = $("my-name");
const opponentNameElement = $("opponent-name");
const myScoreElement = $("my-score");
const opponentScoreElement = $("opponent-score");
const launchBox = $("launch-box");
const nextRoundBtn = $("next-round-btn");
const resultBox = $("result-box");
const resultTitle = $("result-title");
const resultText = $("result-text");
const resultAnswers = $("result-answers");
const leaveBtn = $("leave-btn");

// Messagerie
const chatToggleBtn = $("chat-toggle-btn");
const chatUnreadBadge = $("chat-unread");
const chatPanel = $("chat-panel");
const chatMessagesElement = $("chat-messages");
const chatInput = $("chat-input");
const chatSendBtn = $("chat-send-btn");
const chatMessage = $("chat-message");
const chatSoundBtn = $("chat-sound-btn");
const roundStats = $("round-stats");
const toast = $("toast");
const toastTitle = $("toast-title");
const toastText = $("toast-text");


/* =========================================================
   STOCKAGE LOCAL
========================================================= */

const KEY_PSEUDO = "synchro_pseudo";       // localStorage : pseudo habituel
const KEY_LAST = "synchro_last_game";      // localStorage : dernier code de partie
const KEY_PLAYER = "synchro_player_id";    // sessionStorage : identité de l'onglet
const KEY_SEAT = "synchro_seat";           // sessionStorage : place + jeton secret

function localGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function localSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignoré */ }
}

function tabGet(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
}

function tabSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* ignoré */ }
}

function tabRemove(key) {
    try { sessionStorage.removeItem(key); } catch { /* ignoré */ }
}

// Identité de l'onglet : survit à un rafraîchissement, mais deux onglets
// d'un même navigateur restent deux joueurs différents.
function loadPlayerId() {
    let id = tabGet(KEY_PLAYER);

    if (!id) {
        id = crypto.randomUUID();
        tabSet(KEY_PLAYER, id);
    }

    return id;
}

function loadLastGame() {
    try {
        return JSON.parse(localGet(KEY_LAST) || "null");
    } catch {
        return null;
    }
}

function loadSavedSeat() {
    try {
        return JSON.parse(tabGet(KEY_SEAT) || "null");
    } catch {
        return null;
    }
}


/* =========================================================
   ÉTAT DU JEU
========================================================= */

const playerId = loadPlayerId();

let currentSession = null;
let currentRound = null;
let playerRole = null;
let seatToken = null;           // jeton secret de ma place (fourni par la base)

const chatState = {
    messages: [],
    ids: new Set(),
    maxId: 0,
    unread: 0,
    open: false,
    fetching: false,
    fetchAgain: false,
    sending: false,
    firstLoadDone: false,
    soundOn: true,
    titleUnread: 0,
    askedPermission: false
};

let gameChannel = null;
let sessionChannel = null;
let sessionChannelOk = false;
let gameChannelOk = false;
let pollTimer = null;

let gameStarted = false;
let lastDisplayedRoundId = null;

let refreshing = false;
let refreshQueued = false;

// Relecture de secours : rare si le temps réel fonctionne, rapide sinon
const POLL_FAST_MS = 1500;
const POLL_SLOW_MS = 6000;
const POLL_HIDDEN_MS = 15000;

const ANSWER_PLACEHOLDER = "Écris ta réponse...";
const ANSWER_SENT_PLACEHOLDER = "Réponse envoyée ✔";


/* =========================================================
   OUTILS
========================================================= */

function showPage(name) {
    Object.values(pages).forEach((page) => page.classList.add("hidden"));
    pages[name].classList.remove("hidden");
}

function generateGameCode() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 5; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }

    return code;
}

const ERROR_TEXTS = {
    NAME_INVALID: "❌ Pseudo invalide (2 à 20 caractères, avec au moins une lettre ou un chiffre).",
    PIN_INVALID: "❌ Le PIN doit contenir exactement 4 chiffres.",
    NOT_FOUND: "❌ Aucune partie avec ce code.",
    FULL: "❌ Partie complète. Pour la reprendre, utilise le pseudo et le PIN d'un des deux joueurs.",
    BAD_PIN: "❌ PIN incorrect pour ce pseudo.",
    NAME_TAKEN: "❌ Ce pseudo est déjà celui du créateur. Choisis un autre pseudo.",
    LOCKED: "❌ Trop d'essais. Réessaie dans 5 minutes."
};

function explainError(code) {
    return ERROR_TEXTS[code] || "❌ Une erreur est survenue.";
}

function errorHas(error, code) {
    return !!error && String(error.message || "").includes(code);
}

// Lit et valide pseudo + PIN. Affiche l'erreur dans `messageElement`.
function requireCredentials(messageElement) {

    const pseudo = pseudoInput.value.trim().replace(/\s+/g, " ");
    const pin = pinInput.value.trim();

    if (pseudo.length < 2) {
        messageElement.textContent = "❌ Choisis un pseudo (2 caractères minimum).";
        pseudoInput.focus();
        return null;
    }

    if (!/^[0-9]{4}$/.test(pin)) {
        messageElement.textContent = "❌ Choisis un PIN de 4 chiffres.";
        pinInput.focus();
        return null;
    }

    localSet(KEY_PSEUDO, pseudo);
    messageElement.textContent = "";

    return { pseudo, pin };
}

// Le champ PIN n'accepte que des chiffres
pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
});

function getNames() {
    const s = currentSession || {};

    const mine = playerRole === "player1" ? s.player1_name : s.player2_name;
    const theirs = playerRole === "player1" ? s.player2_name : s.player1_name;

    return {
        me: mine || "Toi",
        opponent: theirs || "Adversaire"
    };
}

// Les fonctions SQL renvoient un objet ; selon la version, parfois un tableau
function firstRow(data) {
    return Array.isArray(data) ? data[0] : data;
}


/* =========================================================
   ACCUEIL : bouton « Reprendre »
========================================================= */

function refreshResumeButton() {
    const last = loadLastGame();

    if (last && last.code) {
        resumeBtn.textContent = `↩ Reprendre la partie ${last.code}`;
        resumeBtn.classList.remove("hidden");
    } else {
        resumeBtn.classList.add("hidden");
    }
}


/* =========================================================
   CRÉER UNE PARTIE
========================================================= */

createBtn.addEventListener("click", async () => {

    const credentials = requireCredentials(homeMessage);
    if (!credentials) return;

    createBtn.disabled = true;
    homeMessage.textContent = "⏳ Création de la partie...";

    try {

        const { data: game, error: gameError } = await supabase
            .from("games")
            .select("*")
            .eq("slug", "synchro")
            .single();

        if (gameError) throw gameError;

        let result = null;

        // Le code est tiré au hasard ; en cas de doublon on réessaie
        for (let attempt = 0; attempt < 5; attempt++) {

            const { data, error } = await supabase.rpc("create_session", {
                p_game_id: game.id,
                p_code: generateGameCode(),
                p_player_id: playerId,
                p_name: credentials.pseudo,
                p_pin: credentials.pin
            });

            if (error) throw error;

            result = firstRow(data);

            if (!result || result.error !== "CODE_TAKEN") break;
        }

        if (!result || result.error) {
            homeMessage.textContent = explainError(result && result.error);
            return;
        }

        homeMessage.textContent = "";

        await enterSession(result.session, result.role, result.token);

    } catch (error) {

        console.error("Erreur création partie :", error);

        homeMessage.textContent =
            "❌ Impossible de créer la partie. Le script supabase_v2.sql a-t-il été exécuté ?";

    } finally {

        createBtn.disabled = false;
    }
});


/* =========================================================
   REJOINDRE OU REPRENDRE UNE PARTIE
========================================================= */

/*
 * Tout se décide dans la base (fonction `enter_session`) :
 *  - le pseudo désigne la place (joueur 1 ou 2), pas l'ordre d'arrivée
 *  - une place déjà occupée demande le bon PIN
 *  - si la place du joueur 2 est libre, on la prend (avec ce PIN)
 */
async function enterByCode(code, credentials, messageElement) {

    const { data, error } = await supabase.rpc("enter_session", {
        p_code: code,
        p_player_id: playerId,
        p_name: credentials.pseudo,
        p_pin: credentials.pin
    });

    if (error) throw error;

    const result = firstRow(data);

    if (!result || result.error) {
        messageElement.textContent = explainError(result && result.error);
        return false;
    }

    messageElement.textContent = "✅ Connecté !";

    await enterSession(result.session, result.role, result.token);

    if (result.joined) {
        await broadcast("player_joined");
    }

    return true;
}

joinBtn.addEventListener("click", () => {

    const credentials = requireCredentials(homeMessage);
    if (!credentials) return;

    joinMessage.textContent = "";
    joinCodeInput.value = "";

    showPage("join");
    joinCodeInput.focus();
});

joinGameBtn.addEventListener("click", async () => {

    const credentials = requireCredentials(joinMessage);
    if (!credentials) return;

    const code = joinCodeInput.value.trim().toUpperCase();

    if (!code) {
        joinMessage.textContent = "❌ Entre le code de la partie.";
        return;
    }

    joinGameBtn.disabled = true;
    joinMessage.textContent = "⏳ Connexion à la partie...";

    try {

        await enterByCode(code, credentials, joinMessage);

    } catch (error) {

        console.error("Erreur rejoindre :", error);
        joinMessage.textContent =
            "❌ Impossible de rejoindre la partie. Le script supabase_v2.sql a-t-il été exécuté ?";

    } finally {

        joinGameBtn.disabled = false;
    }
});

joinCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinGameBtn.click();
});

resumeBtn.addEventListener("click", async () => {

    const last = loadLastGame();
    if (!last) return;

    const credentials = requireCredentials(homeMessage);
    if (!credentials) return;

    resumeBtn.disabled = true;
    homeMessage.textContent = "⏳ Reprise de la partie...";

    try {

        await enterByCode(last.code, credentials, homeMessage);

    } catch (error) {

        console.error("Erreur reprise :", error);
        homeMessage.textContent = "❌ Impossible de reprendre la partie.";

    } finally {

        resumeBtn.disabled = false;
    }
});


/* =========================================================
   NAVIGATION
========================================================= */

function leaveToHome() {

    cleanupSession();

    // Quitter volontairement : pas de reprise automatique au rechargement
    tabRemove(KEY_SEAT);

    homeMessage.textContent = "";
    refreshResumeButton();
    showPage("home");
}

// Retour à l'accueil avec un message (place reprise, jeton périmé...)
function kickToHome(message) {

    leaveToHome();

    homeMessage.textContent = message;
}

backFromCreateBtn.addEventListener("click", leaveToHome);
backFromJoinBtn.addEventListener("click", leaveToHome);
leaveBtn.addEventListener("click", leaveToHome);

copyBtn.addEventListener("click", async () => {

    try {

        await navigator.clipboard.writeText(gameCodeElement.textContent);

        copyMessage.textContent = "✅ Code copié !";

        setTimeout(() => { copyMessage.textContent = ""; }, 2000);

    } catch (error) {

        console.error(error);
        copyMessage.textContent = "❌ Impossible de copier le code.";
    }
});


/* =========================================================
   ENTRER DANS UNE PARTIE / SORTIR
========================================================= */

async function enterSession(session, role, token) {

    cleanupSession();

    currentSession = session;
    playerRole = role;
    seatToken = token;

    // Place + jeton gardés pour cet onglet (reprise après F5)
    tabSet(KEY_SEAT, JSON.stringify({ code: session.code, role, token }));

    // Dernier code connu (bouton « Reprendre » sur l'accueil)
    localSet(KEY_LAST, JSON.stringify({ code: session.code, role }));

    subscribeToSession(session.id);
    subscribeToGameEvents(session.id);

    if (session.status === "waiting" && !session.player2_id) {

        gameCodeElement.textContent = session.code;
        createPseudo.textContent = session.player1_name || "";
        showPage("create");

    } else {

        startGame();
    }

    schedulePoll();

    await refreshAll();
}

function cleanupSession() {

    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }

    if (gameChannel) {
        supabase.removeChannel(gameChannel);
        gameChannel = null;
    }

    if (sessionChannel) {
        supabase.removeChannel(sessionChannel);
        sessionChannel = null;
    }

    sessionChannelOk = false;
    gameChannelOk = false;

    resetChat();

    currentSession = null;
    currentRound = null;
    playerRole = null;
    seatToken = null;
    gameStarted = false;
    lastDisplayedRoundId = null;
    refreshing = false;
    refreshQueued = false;
}

function startGame() {

    if (gameStarted) return;

    gameStarted = true;

    gameCodeBadge.textContent = currentSession.code;
    roundNumberElement.textContent = "1";

    showWaitingForLaunch();
    renderScores();

    showPage("game");
}


/* =========================================================
   TEMPS RÉEL + RELECTURE DE SECOURS
========================================================= */

function realtimeHealthy() {
    return sessionChannelOk && gameChannelOk;
}

// Relecture périodique : espacée quand le temps réel fonctionne,
// rapprochée sinon, et très espacée quand l'onglet est en arrière-plan.
function schedulePoll() {

    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }

    if (!currentSession) return;

    const delay = document.hidden
        ? POLL_HIDDEN_MS
        : (realtimeHealthy() ? POLL_SLOW_MS : POLL_FAST_MS);

    pollTimer = setTimeout(async () => {

        await refreshAll();

        schedulePoll();

    }, delay);
}

function subscribeToSession(sessionId) {

    const channel = supabase
        .channel(`session-${sessionId}`)
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "game_sessions",
                filter: `id=eq.${sessionId}`
            },
            () => { refreshAll(); }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "rounds",
                filter: `session_id=eq.${sessionId}`
            },
            (payload) => {

                const row = payload.new;

                // Nouvelle manche : affichage immédiat du thème
                if (
                    payload.eventType === "INSERT" &&
                    row && gameStarted &&
                    (!currentRound || row.round_number > currentRound.round_number)
                ) {
                    displayRound(row);
                }

                refreshAll();
            }
        );

    sessionChannel = channel;

    channel.subscribe((status) => {

        if (channel !== sessionChannel) return; // ancien canal

        sessionChannelOk = status === "SUBSCRIBED";
        schedulePoll();
    });
}

function subscribeToGameEvents(sessionId) {

    // Les signaux servent à réagir vite ; l'état réel est toujours
    // relu depuis la base (seul le thème de la nouvelle manche circule ici).
    const channel = supabase
        .channel(`game-${sessionId}`)
        .on(
            "broadcast",
            { event: "game_event" },
            ({ payload }) => {

                // Nouveau message : lecture immédiate de la messagerie
                if (payload && payload.type === "chat_message") {
                    fetchChat();
                    return;
                }

                if (
                    payload &&
                    payload.type === "round_started" &&
                    payload.round &&
                    gameStarted &&
                    (!currentRound || payload.round.round_number > currentRound.round_number)
                ) {
                    displayRound(payload.round);
                }

                refreshAll();
            }
        );

    gameChannel = channel;

    channel.subscribe((status) => {

        if (channel !== gameChannel) return; // ancien canal

        gameChannelOk = status === "SUBSCRIBED";
        schedulePoll();
    });
}

async function broadcast(type, extra = {}) {

    if (!gameChannel) return;

    try {

        await gameChannel.send({
            type: "broadcast",
            event: "game_event",
            payload: { type, ...extra }
        });

    } catch (error) {

        console.error("Erreur broadcast :", error);
    }
}


/* =========================================================
   LECTURE DE L'ÉTAT (session + manche)
========================================================= */

async function fetchSession() {

    if (!currentSession) return null;

    const { data, error } = await supabase
        .from("game_sessions")
        .select("*")
        .eq("id", currentSession.id)
        .single();

    if (error) {
        console.error("Erreur lecture session :", error);
        return null;
    }

    return data;
}

// Retourne la manche, null s'il n'y en a pas, undefined en cas d'erreur
async function fetchLatestRound() {

    if (!currentSession) return undefined;

    const { data, error } = await supabase
        .from("rounds")
        .select("*")
        .eq("session_id", currentSession.id)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Erreur lecture manche :", error);
        return undefined;
    }

    return data;
}

// Garde le rôle de cet appareil cohérent avec la base.
// Retourne false si cet appareil n'occupe plus aucune place
// (quelqu'un l'a reprise avec le bon PIN).
function syncRoleFromSession(session) {

    const isP1 = session.player1_id === playerId;
    const isP2 = session.player2_id === playerId;

    if (isP1 && !isP2) {
        playerRole = "player1";
        return true;
    }

    if (isP2 && !isP1) {
        playerRole = "player2";
        return true;
    }

    return isP1 && isP2; // cas anormal : on ne touche à rien
}

/*
 * Relit tout l'état. Les appels simultanés sont regroupés.
 * La manche est lue AVANT la session : si la manche affiche un
 * résultat, les scores lus ensuite sont forcément à jour
 * (résultat et scores sont écrits dans la même transaction SQL).
 */
async function refreshAll() {

    if (!currentSession) return;

    if (refreshing) {
        refreshQueued = true;
        return;
    }

    refreshing = true;

    try {

        let round = gameStarted ? await fetchLatestRound() : undefined;

        const session = await fetchSession();

        if (!currentSession) return; // on a quitté entre-temps

        if (session) {

            currentSession = session;

            if (!syncRoleFromSession(session)) {

                kickToHome(
                    "ℹ️ Ta place a été reprise depuis un autre appareil. Reconnecte-toi avec ton pseudo et ton PIN."
                );

                return;
            }

            // Le créateur voit arriver le joueur 2
            if (
                !gameStarted &&
                session.player2_id &&
                session.status === "playing"
            ) {
                startGame();
                round = await fetchLatestRound();
            }

            renderScores();
        }

        if (gameStarted) fetchChat();

        if (!gameStarted || round === undefined) return;

        if (round) {

            displayRound(round);
            await checkRoundResult(round);

        } else if (!currentRound) {

            showWaitingForLaunch();
        }

    } finally {

        refreshing = false;

        if (refreshQueued) {
            refreshQueued = false;
            refreshAll();
        }
    }
}


/* =========================================================
   AFFICHAGE
========================================================= */

function renderScores() {

    if (!currentSession) return;

    const names = getNames();

    const myScore = playerRole === "player1"
        ? currentSession.player1_score
        : currentSession.player2_score;

    const opponentScore = playerRole === "player1"
        ? currentSession.player2_score
        : currentSession.player1_score;

    myNameElement.textContent = `${names.me} (toi)`;
    myPseudoBadge.textContent = names.me;
    opponentPseudoBadge.textContent = names.opponent;
    opponentNameElement.textContent = names.opponent;

    myScoreElement.textContent = myScore || 0;
    opponentScoreElement.textContent = opponentScore || 0;

    renderRoundStats();

    updateLaunchButton();
}

// Manches jouées = manches terminées ; chaque synchro donne +1 à chacun,
// donc le score d'un joueur = nombre de synchros.
function renderRoundStats() {

    if (!currentSession || !gameStarted) {
        roundStats.textContent = "";
        return;
    }

    let played = 0;

    if (currentRound) {
        played = currentRound.result
            ? currentRound.round_number
            : currentRound.round_number - 1;
    }

    const synchros = currentSession.player1_score || 0;

    if (played <= 0) {
        roundStats.textContent = "Aucune manche jouée pour l'instant";
        return;
    }

    const rate = Math.round((synchros / played) * 100);

    roundStats.textContent =
        `Manches jouées : ${played} • Synchros : ${synchros} (${rate} %)`;
}

function showWaitingForLaunch() {

    themeElement.textContent = "En attente...";

    answerInput.value = "";
    answerInput.placeholder = ANSWER_PLACEHOLDER;
    answerInput.disabled = true;
    submitAnswerBtn.disabled = true;

    resultBox.classList.add("hidden");
    answerMessage.textContent = "";

    updateLaunchButton();
}

function displayRound(round) {

    // Une lecture lente peut renvoyer une ancienne manche après l'affichage
    // de la suivante : on l'ignore pour éviter un retour en arrière.
    if (currentRound && round.round_number < currentRound.round_number) return;

    const roundChanged = lastDisplayedRoundId !== round.id;

    lastDisplayedRoundId = round.id;
    currentRound = round;

    roundNumberElement.textContent = round.round_number;
    themeElement.textContent = round.theme;

    // On ne réinitialise le champ que pour une NOUVELLE manche,
    // pour ne pas effacer ce que le joueur est en train d'écrire.
    if (roundChanged) {

        answerInput.value = "";
        answerInput.placeholder = ANSWER_PLACEHOLDER;
        answerInput.disabled = false;
        submitAnswerBtn.disabled = false;
        answerMessage.textContent = "";

        resultBox.classList.add("hidden");
        resultAnswers.textContent = "";
    }

    const myReady = playerRole === "player1"
        ? round.player1_ready
        : round.player2_ready;

    // Déjà répondu (y compris après une reprise de partie).
    // La réponse reste secrète tant que la manche n'est pas terminée :
    // on ne peut donc pas la réafficher, seulement indiquer qu'elle est envoyée.
    if (myReady) {

        answerInput.disabled = true;
        submitAnswerBtn.disabled = true;

        if (!answerInput.value) {
            answerInput.placeholder = ANSWER_SENT_PLACEHOLDER;
        }

        if (!round.result) {
            answerMessage.textContent =
                `✅ Réponse envoyée. En attente de ${getNames().opponent}...`;
        }
    }

    if (round.result) {
        displayResult(round);
    }

    renderRoundStats();

    updateLaunchButton();
}

function displayResult(round) {

    if (!round.result) return;

    const names = getNames();

    // Les réponses sont révélées par la base à la fin de la manche
    const myAnswer = playerRole === "player1"
        ? round.player1_answer
        : round.player2_answer;

    const theirAnswer = playerRole === "player1"
        ? round.player2_answer
        : round.player1_answer;

    resultBox.classList.remove("hidden");

    answerInput.disabled = true;
    submitAnswerBtn.disabled = true;
    answerMessage.textContent = "";

    if (round.result === "synchro") {

        resultTitle.textContent = "🎉 SYNCHRO !";
        resultText.textContent =
            "Vous avez pensé à la même chose ! +1 point chacun.";

    } else {

        resultTitle.textContent = "❌ PAS SYNCHRO";
        resultText.textContent =
            "Vous avez donné des réponses différentes.";
    }

    resultAnswers.textContent =
        `${names.me} : « ${myAnswer ?? ""} »  •  ${names.opponent} : « ${theirAnswer ?? ""} »`;

    renderScores();
}

function updateLaunchButton() {

    // Manche en cours : pas de bouton de lancement
    if (currentRound && !currentRound.result) {
        launchBox.classList.add("hidden");
        return;
    }

    if (!currentSession || !gameStarted) return;

    launchBox.classList.remove("hidden");

    const myTurn = currentSession.next_player === playerRole;

    if (myTurn) {

        nextRoundBtn.textContent = `➜ ${getNames().me}, lance la manche`;
        nextRoundBtn.disabled = false;

    } else {

        nextRoundBtn.textContent =
            `⏳ ${getNames().opponent} lance la prochaine manche...`;
        nextRoundBtn.disabled = true;
    }
}


/* =========================================================
   LANCER UNE MANCHE (la base choisit le thème et vérifie le tour)
========================================================= */

nextRoundBtn.addEventListener("click", launchNextRound);

async function launchNextRound() {

    if (!currentSession || currentSession.next_player !== playerRole) return;

    nextRoundBtn.disabled = true;

    try {

        const { data, error } = await supabase.rpc("start_round", {
            p_session_id: currentSession.id,
            p_token: seatToken
        });

        if (error) throw error;

        const newRound = firstRow(data);

        if (!newRound) throw new Error("Manche non créée.");

        displayRound(newRound);

        await broadcast("round_started", { round: newRound });

    } catch (error) {

        console.error("Erreur lancement manche :", error);

        if (errorHas(error, "INVALID_TOKEN")) {
            kickToHome("ℹ️ Ta session a expiré. Reconnecte-toi avec ton pseudo et ton PIN.");
            return;
        }

        if (errorHas(error, "NOT_YOUR_TURN")) {
            await refreshAll();
            return;
        }

        answerMessage.textContent = "❌ Impossible de lancer la manche.";

        updateLaunchButton();
    }
}


/* =========================================================
   ENVOYER UNE RÉPONSE (stockée en secret dans la base)
========================================================= */

submitAnswerBtn.addEventListener("click", submitAnswer);

answerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitAnswer();
});

async function submitAnswer() {

    if (!currentRound || currentRound.result) return;

    const answer = answerInput.value.trim();

    if (!answer) {
        answerMessage.textContent = "❌ Écris d'abord une réponse.";
        return;
    }

    submitAnswerBtn.disabled = true;
    answerInput.disabled = true;
    answerMessage.textContent = "⏳ Envoi de la réponse...";

    const { data, error } = await supabase.rpc("submit_answer", {
        p_round_id: currentRound.id,
        p_token: seatToken,
        p_answer: answer
    });

    const updated = error ? null : firstRow(data);

    if (error || !updated) {

        console.error("Erreur réponse :", error);

        if (errorHas(error, "INVALID_TOKEN")) {
            kickToHome("ℹ️ Ta session a expiré. Reconnecte-toi avec ton pseudo et ton PIN.");
            return;
        }

        answerMessage.textContent = "❌ Impossible d'envoyer la réponse.";
        submitAnswerBtn.disabled = false;
        answerInput.disabled = false;

        return;
    }

    currentRound = updated;

    answerMessage.textContent =
        `✅ Réponse envoyée. En attente de ${getNames().opponent}...`;

    await broadcast("answer_submitted");

    await checkRoundResult(updated);
}


/* =========================================================
   RÉSULTAT (calculé côté base, de façon atomique)
========================================================= */

/*
 * Quand les deux joueurs ont répondu, n'importe lequel des deux
 * clients demande à la base de résoudre la manche (`resolve_round`).
 * La base compare les réponses (sans accents ni majuscules), enregistre
 * le résultat, révèle les réponses, ajoute les points et passe la main,
 * le tout dans une seule transaction, une seule fois.
 */
async function checkRoundResult(round) {

    if (!round || round.result) return;

    if (!round.player1_ready || !round.player2_ready) return;

    const { data, error } = await supabase.rpc("resolve_round", {
        p_round_id: round.id
    });

    if (error) {

        console.error("Erreur résolution manche :", error);

        answerMessage.textContent =
            "❌ Résultat impossible. Le script supabase_v2.sql a-t-il été exécuté ?";

        return;
    }

    const resolved = firstRow(data);

    if (!resolved || !resolved.result) return;

    // Scores et tour mis à jour dans la même transaction
    const session = await fetchSession();

    if (session) currentSession = session;

    displayRound(resolved);

    await broadcast("result_ready");
}


/* =========================================================
   MESSAGERIE (privée : lue et écrite via la base, avec le jeton de place)
========================================================= */

function resetChat() {

    chatState.messages = [];
    chatState.ids = new Set();
    chatState.maxId = 0;
    chatState.unread = 0;
    chatState.open = false;
    chatState.fetching = false;
    chatState.fetchAgain = false;
    chatState.sending = false;
    chatState.firstLoadDone = false;

    chatMessagesElement.textContent = "";
    chatMessage.textContent = "";
    chatInput.value = "";
    chatPanel.classList.add("hidden");

    chatState.titleUnread = 0;
    document.title = BASE_TITLE;
    hideToast();

    updateChatBadge();
}

function updateChatBadge() {

    if (chatState.unread > 0 && !chatState.open) {
        chatUnreadBadge.textContent = chatState.unread > 99 ? "99+" : chatState.unread;
        chatUnreadBadge.classList.remove("hidden");
    } else {
        chatUnreadBadge.classList.add("hidden");
    }
}

function renderChat() {

    const container = chatMessagesElement;

    const wasNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 60;

    const names = getNames();

    container.textContent = "";

    if (chatState.messages.length === 0) {

        const empty = document.createElement("p");
        empty.className = "chat-empty";
        empty.textContent = "Aucun message pour l'instant. Dis bonjour 👋";
        container.appendChild(empty);

        return;
    }

    for (const message of chatState.messages) {

        const mine = message.seat === playerRole;

        const bubble = document.createElement("div");
        bubble.className = "chat-msg " + (mine ? "mine" : "theirs");

        const author = document.createElement("span");
        author.className = "chat-author";
        author.textContent = mine ? names.me : names.opponent;

        const text = document.createElement("div");
        text.textContent = message.body;

        const time = document.createElement("span");
        time.className = "chat-time";
        time.textContent = new Date(message.created_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit"
        });

        bubble.append(author, text, time);
        container.appendChild(bubble);
    }

    const last = chatState.messages[chatState.messages.length - 1];

    if (wasNearBottom || (last && last.seat === playerRole)) {
        container.scrollTop = container.scrollHeight;
    }
}

function addChatMessages(list, notify) {

    let added = false;
    const incoming = [];

    for (const message of list) {

        if (!message || chatState.ids.has(message.id)) continue;

        chatState.ids.add(message.id);
        chatState.messages.push(message);

        if (message.id > chatState.maxId) chatState.maxId = message.id;

        added = true;

        // Message de l'autre joueur (et pas un ancien message rechargé)
        if (notify && message.seat !== playerRole) {

            incoming.push(message);

            if (!chatState.open) chatState.unread++;
        }
    }

    if (!added) return;

    chatState.messages.sort((a, b) => a.id - b.id);

    renderChat();
    updateChatBadge();

    notifyIncoming(incoming);
}

async function fetchChat() {

    if (!currentSession || !seatToken || !gameStarted) return;

    // Une lecture à la fois ; si un signal arrive pendant ce temps, on relit après
    if (chatState.fetching) {
        chatState.fetchAgain = true;
        return;
    }

    chatState.fetching = true;

    const sessionId = currentSession.id;

    try {

        // Léger recouvrement (-10) pour ne rien rater ; les doublons sont ignorés
        const { data, error } = await supabase.rpc("get_messages", {
            p_session_id: sessionId,
            p_token: seatToken,
            p_after: Math.max(0, chatState.maxId - 10)
        });

        if (error) {
            console.error("Erreur lecture messages :", error);
            return;
        }

        if (!currentSession || currentSession.id !== sessionId) return;

        addChatMessages(Array.isArray(data) ? data : [], chatState.firstLoadDone);

        chatState.firstLoadDone = true;

    } finally {

        chatState.fetching = false;

        if (chatState.fetchAgain) {
            chatState.fetchAgain = false;
            fetchChat();
        }
    }
}

async function sendChat() {

    if (!currentSession || !seatToken || chatState.sending) return;

    const body = chatInput.value.trim();

    if (!body) return;

    chatState.sending = true;
    chatSendBtn.disabled = true;
    chatMessage.textContent = "";

    try {

        const { data, error } = await supabase.rpc("send_message", {
            p_session_id: currentSession.id,
            p_token: seatToken,
            p_body: body
        });

        if (error) throw error;

        const message = firstRow(data);

        chatInput.value = "";

        if (message) addChatMessages([message], false);

        await broadcast("chat_message");

    } catch (error) {

        console.error("Erreur envoi message :", error);

        if (errorHas(error, "INVALID_TOKEN")) {
            kickToHome("ℹ️ Ta session a expiré. Reconnecte-toi avec ton pseudo et ton PIN.");
            return;
        }

        chatMessage.textContent = errorHas(error, "RATE_LIMIT")
            ? "⏳ Doucement, attends quelques secondes."
            : "❌ Message non envoyé. Le script supabase_v3_messagerie.sql a-t-il été exécuté ?";

    } finally {

        chatState.sending = false;
        chatSendBtn.disabled = false;
    }
}

function setChatOpen(open) {

    chatState.open = open;

    chatPanel.classList.toggle("hidden", !open);

    if (open) {

        chatState.unread = 0;

        hideToast();

        renderChat();

        chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;

        chatInput.focus();

        askNotificationPermission();
    }

    updateChatBadge();
}

chatToggleBtn.addEventListener("click", () => {
    setChatOpen(!chatState.open);
});


/* =========================================================
   NOTIFICATIONS DE MESSAGE (bulle, son, titre de l'onglet)
========================================================= */

const KEY_SOUND = "synchro_chat_sound";
const BASE_TITLE = document.title;

let audioContext = null;
let toastTimer = null;

chatState.soundOn = localGet(KEY_SOUND) !== "0";

function updateSoundButton() {

    chatSoundBtn.textContent = chatState.soundOn ? "🔔" : "🔕";

    chatSoundBtn.title = chatState.soundOn
        ? "Son activé (cliquer pour couper)"
        : "Son coupé (cliquer pour activer)";
}

function getAudioContext() {

    try {

        const AudioCtx = window.AudioContext || window.webkitAudioContext;

        if (!AudioCtx) return null;

        if (!audioContext) audioContext = new AudioCtx();

        if (audioContext.state === "suspended") audioContext.resume();

        return audioContext;

    } catch {

        return null;
    }
}

// Petit « ding » généré par le navigateur (aucun fichier audio nécessaire)
function playBeep() {

    if (!chatState.soundOn) return;

    const context = getAudioContext();

    if (!context) return;

    try {

        const now = context.currentTime;

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(1175, now + 0.09);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.32);

    } catch (error) {

        console.error("Son impossible :", error);
    }
}

function showToast(title, text) {

    toastTitle.textContent = title;
    toastText.textContent = text.length > 90 ? text.slice(0, 87) + "…" : text;

    toast.classList.remove("hidden");

    if (toastTimer) clearTimeout(toastTimer);

    toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }

    toast.classList.add("hidden");
}

// Demande une seule fois l'autorisation d'afficher une notification du
// navigateur (utile quand l'onglet est en arrière-plan)
function askNotificationPermission() {

    if (chatState.askedPermission) return;

    chatState.askedPermission = true;

    if ("Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch { /* ignoré */ }
    }
}

function notifyIncoming(incoming) {

    if (!incoming.length) return;

    const last = incoming[incoming.length - 1];
    const opponent = getNames().opponent;
    const tabHidden = document.hidden;

    // Messagerie ouverte et onglet visible : le message est déjà sous les yeux
    if (chatState.open && !tabHidden) return;

    playBeep();

    if (!tabHidden) {

        showToast(`💬 ${opponent}`, last.body);

        return;
    }

    // Onglet en arrière-plan : compteur dans le titre + notification système
    chatState.titleUnread += incoming.length;

    document.title = `(${chatState.titleUnread}) 💬 ${BASE_TITLE}`;

    if ("Notification" in window && Notification.permission === "granted") {

        try {

            new Notification(`💬 ${opponent}`, {
                body: last.body.slice(0, 120),
                tag: "synchro-chat"
            });

        } catch { /* non supporté (certains mobiles) */ }
    }
}

chatSoundBtn.addEventListener("click", () => {

    chatState.soundOn = !chatState.soundOn;

    localSet(KEY_SOUND, chatState.soundOn ? "1" : "0");

    updateSoundButton();

    if (chatState.soundOn) playBeep();
});

// Cliquer sur la bulle ouvre la messagerie
toast.addEventListener("click", () => {

    setChatOpen(true);

    chatPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

// Retour sur l'onglet : on retire le compteur du titre
document.addEventListener("visibilitychange", () => {

    if (!document.hidden && chatState.titleUnread) {
        chatState.titleUnread = 0;
        document.title = BASE_TITLE;
    }
});

// Les navigateurs exigent un geste de l'utilisateur avant de jouer un son :
// le premier clic « débloque » l'audio pour la suite.
document.addEventListener("pointerdown", () => { getAudioContext(); }, { once: true });

updateSoundButton();

chatSendBtn.addEventListener("click", sendChat);

chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendChat();
});


/* =========================================================
   DÉMARRAGE
========================================================= */

// Les onglets en arrière-plan sont ralentis par le navigateur :
// on relit l'état dès qu'on revient dessus.
document.addEventListener("visibilitychange", () => {

    schedulePoll();

    if (!document.hidden) refreshAll();
});

window.addEventListener("focus", () => { refreshAll(); });
window.addEventListener("online", () => { refreshAll(); });

pseudoInput.value = localGet(KEY_PSEUDO) || "";

refreshResumeButton();

// Après un rafraîchissement de la page : si cet onglet avait une place
// (jeton encore valable), on retourne directement dans la partie.
async function autoResume() {

    const saved = loadSavedSeat();

    if (!saved || !saved.code || !saved.token) return;

    try {

        const { data, error } = await supabase.rpc("seat_status", {
            p_code: saved.code,
            p_token: saved.token
        });

        if (error) throw error;

        const result = firstRow(data);

        if (!result || result.error || currentSession) {
            if (result && result.error) tabRemove(KEY_SEAT);
            return;
        }

        await enterSession(result.session, result.role, saved.token);

    } catch (error) {

        console.error("Reprise automatique impossible :", error);
    }
}

autoResume();

console.log("🚀 Synchro chargé correctement.");