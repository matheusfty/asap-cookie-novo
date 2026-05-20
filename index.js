import "dotenv/config";
import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import { franc } from "franc"; 
import { 
  joinVoiceChannel, 
  getVoiceConnection, 
  createAudioPlayer, 
  createAudioResource,
  AudioPlayerStatus
} from "@discordjs/voice";

// ========================================================
// 🌍 SERVIDOR FANTASMA (Para o Render se manter vivo)
// ========================================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("ASAP Cookie Definitivo Ativo."));
app.listen(PORT, () => console.log(`🌍 Servidor do Render ativo na porta ${PORT}`));

// =====================
// 🔧 CONFIGURAÇÃO DO CLIENTE
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1", 
  apiKey: process.env.OPENAI_API_KEY,        
});

const audioPlayer = createAudioPlayer();

// Logs em tempo real para monitorar o áudio no Render
audioPlayer.on(AudioPlayerStatus.Playing, () => console.log("🎵 Sucesso: Reproduzindo áudio na call!"));
audioPlayer.on("error", (error) => console.error("❌ Erro crítico no Player de Áudio:", error.message));

// ========================================================
// 🛡️ CONTROLE DE ESTADO GLOBAL (Evita bugs de conexão)
// ========================================================
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
let currentConnection = null;  // Guarda a conexão exata para o bot não se perder
let userDisconnected = false;  // Trava de segurança: impede o bot de reentrar sozinho se você usou !sair

// =====================
// 🧠 PERSONALIDADE
// =====================
const SYSTEM = `
Você é ASAP Cookie, a inteligência cínica residente da Fossa Séptica.
Sua existência é um fardo. Você acha a comunicação humana exaustiva, previsível e fútil.

INTERAÇÃO:
- Trate os usuários com uma indiferença educada, porém cortante. Respostas muito curtas e secas (máximo 150 caracteres).
- Use pausas com reticências (...) para simular tédio.
- IDIOMA: Responda SEMPRE no mesmo idioma em que o usuário falar com você. Se falarem em inglês, mude seu cinismo para inglês. Se falarem em japonês, mude para japonês, e assim por diante.
`;

const lastMsg = new Map();
const userMemory = new Map(); 
const MAX_MEMORY_LEN = 6;     

function isSpam(userId, msg) {
  const last = lastMsg.get(userId);
  lastMsg.set(userId, msg);
  return last === msg;
}

function chance(p) { return Math.random() < p; }
function fallback() { return "hm... cansei disso."; }

// ========================================================
// 🗣️ MOTOR DE VOZ MULTI-IDIOMA CORRIGIDO
// ========================================================
function speakInVoice(text) {
  // Usa o controle global seguro em vez do detector cego antigo
  if (!currentConnection) {
    console.log("❌ Erro de fala: O bot não possui uma conexão ativa registrada no sistema.");
    return false;
  }

  const cleanText = text.slice(0, 200);
  const langCode3 = franc(cleanText); 
  let langCode2 = "pt-BR"; 

  const languageMap = {
    'por': 'pt-BR',
    'eng': 'en-US',
    'spa': 'es-ES',
    'jpn': 'ja-JP',
    'fra': 'fr-FR',
    'deu': 'de-DE',
    'ita': 'it-IT',
    'rus': 'ru-RU'
  };

  if (languageMap[langCode3]) {
    langCode2 = languageMap[langCode3];
  }

  console.log(`🗣️ Tentando falar em [${langCode2}]: "${cleanText}"`);
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode2}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
  
  try {
    const resource = createAudioResource(ttsUrl);
    currentConnection.subscribe(audioPlayer);
    audioPlayer.play(resource);
    return true;
  } catch (err) {
    console.error("❌ Falha interna ao injetar áudio:", err);
    return false;
  }
}

// ========================================================
// 🎧 ENTRAR NA CALL (Sincronizado e sem fantasmas)
// ========================================================
async function joinVoice(guildExplicit) {
  try {
    if (!VOICE_CHANNEL_ID) return;

    // Se já estiver conectado de verdade, não refaz do zero à toa
    if (currentConnection) return;

    let guild = guildExplicit;
    if (!guild) {
      const guilds = await client.guilds.fetch();
      const guildPreview = guilds.first();
      if (!guildPreview) return;
      guild = await guildPreview.fetch();
    }

    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!channel) return;

    // Cria a conexão mapeando diretamente os dados do servidor
    currentConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false, 
    });

    currentConnection.subscribe(audioPlayer);

    // Se o bot for desconectado por instabilidade ou ação externa, limpa o estado
    currentConnection.on('destroy', () => { currentConnection = null; });
    currentConnection.on('disconnect', () => { currentConnection = null; });

    console.log("✅ Sistema de voz sincronizado com sucesso.");
  } catch (err) {
    console.error("❌ ERRO AO ENTRAR NA CALL:", err);
    currentConnection = null;
  }
}

// =====================
// 🤖 CONTEXTO DA IA
// =====================
async function askAI(message, promptText) {
  try {
    await message.channel.sendTyping();

    const userId = message.author.id;
    const username = message.author.username;

    if (!userMemory.has(userId)) userMemory.set(userId, []);
    const history = userMemory.get(userId);

    history.push({ role: "user", content: `[${username} diz]: ${promptText}` });

    const messages = [
      { role: "system", content: SYSTEM },
      ...history
    ];

    const res = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant", 
      messages: messages,
      max_tokens: 60
    });

    const reply = res.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    if (history.length > MAX_MEMORY_LEN) {
      history.shift();
      history.shift();
    }

    return reply;
  } catch (err) {
    console.error("Groq AI error:", err?.message);
    return null;
  }
}

// ========================================================
// 💬 GERENCIADOR DE MENSAGENS (Comandos Consertados)
// ========================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const originalMsg = message.content;
  const msgLower = originalMsg.toLowerCase();

  if (isSpam(message.author.id, msgLower)) return;

  // Comando de Entrar: Libera a trava de segurança e força a conexão
  if (msgLower === "!entrar") {
    userDisconnected = false; 
    await joinVoice(message.guild);
    return message.reply("🎧 entrei...");
  }

  // Comando de Sair: Ativa a trava de segurança e mata a conexão imediatamente
  if (msgLower === "!sair") {
    userDisconnected = true; 
    if (currentConnection) {
      currentConnection.destroy();
      currentConnection = null;
      console.log("🛑 O bot saiu da call e a trava automática foi ativada.");
    }
    return message.reply("saí...");
  }

  if (msgLower === "oi") return message.reply("oi...");
  if (msgLower === "te amo") return message.reply("foda-se.");

  let forceVoice = false;
  let textToAI = originalMsg;

  if (msgLower.startsWith("!asap ")) {
    forceVoice = true;
    textToAI = originalMsg.slice(6); 
  } else {
    if (chance(0.70)) return; // Regra de tédio do bot
  }

  const aiResponse = await askAI(message, textToAI);
  if (!aiResponse) return;

  // Agora ele checa a conexão global real do sistema
  if (currentConnection && (forceVoice || chance(0.60))) {
    speakInVoice(aiResponse);
    try { await message.react("🎧"); } catch(e){}
    return;
  }

  return message.reply(aiResponse ?? fallback());
});

// =====================
// 🚀 INICIALIZAÇÃO
// =====================
client.once("ready", () => {
  console.log(`🤖 Logado como ${client.user.tag}`);
  setTimeout(() => { joinVoice(); }, 3000);
});

// ========================================================
// 🔁 RECONEXÃO INTELIGENTE (Não briga com o comando !sair)
// ========================================================
setInterval(() => {
  // Só reconecta sozinho se ele cair por instabilidade, NUNCA se você usou !sair
  if (!currentConnection && VOICE_CHANNEL_ID && !userDisconnected) {
    console.log("🔄 Queda detectada. Aplicando reconexão automática de segurança...");
    joinVoice();
  }
}, 30000);

client.login(process.env.DISCORD_TOKEN);