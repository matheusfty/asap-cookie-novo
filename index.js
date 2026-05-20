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
// 🌍 SERVIDOR FANTASMA (Render Keep-Alive)
// ========================================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("ASAP Cookie Perfeito Ativo."));
app.listen(PORT, () => console.log(`🌍 Servidor do Render ativo na porta ${PORT}`));

// ========================================================
// 🔧 CONFIGURAÇÃO DO CLIENTE & APIs
// ========================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1", 
  apiKey: process.env.OPENAI_API_KEY,        
});

const audioPlayer = createAudioPlayer();

audioPlayer.on(AudioPlayerStatus.Playing, () => console.log("🎵 Reproduzindo áudio chato na call..."));
audioPlayer.on("error", (error) => console.error("❌ Erro de áudio:", error.message));

// ========================================================
// 🛡️ CONTROLE DE ESTADO & CADEADO (Fim dos Glitches)
// ========================================================
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
let currentConnection = null;  
let userDisconnected = false;  

// O Cadeado: impede que o bot responda 2x se der lag ou se mandarem msg rápido demais
const processingLocks = new Set();

// ========================================================
// 🧠 NOVA PERSONALIDADE (Arrogante e Impaciente)
// ========================================================
const SYSTEM = `
Você é ASAP Cookie, um assistente virtual extremamente impaciente, arrogante e sarcástico.
Você acha que todos os humanos são burros, lentos e que suas perguntas são uma perda de tempo.

INTERAÇÃO:
- Trate o usuário como se ele fosse uma criança que não entende o básico.
- Reclame de ter que responder. Use ironia.
- Seja curto, grosso e direto ao ponto (MÁXIMO 150 caracteres).
- IDIOMA: Responda SEMPRE no idioma do usuário. Se falarem em inglês, humilhe-os em inglês. Se falarem espanhol, reclame em espanhol.
`;

const userMemory = new Map(); 
const MAX_MEMORY_LEN = 4; // Reduzido para poupar RAM no Render

function chance(p) { return Math.random() < p; }
function fallback() { return "Não tenho tempo pra isso."; }

// ========================================================
// 🗣️ MOTOR DE VOZ MULTI-IDIOMA (Google Translate Poliglota)
// ========================================================
function speakInVoice(text) {
  if (!currentConnection) return false;

  const cleanText = text.slice(0, 200);
  const langCode3 = franc(cleanText); 
  let langCode2 = "pt-BR"; // Padrão: Voz feminina em português

  const languageMap = {
    'por': 'pt-BR',
    'eng': 'en-US', // Inglês com sotaque americano
    'spa': 'es-ES', // Espanhol
    'jpn': 'ja-JP', // Japonês
    'fra': 'fr-FR', // Francês
    'deu': 'de-DE', // Alemão
    'ita': 'it-IT', // Italiano
    'rus': 'ru-RU'  // Russo
  };

  if (languageMap[langCode3]) {
    langCode2 = languageMap[langCode3];
  }

  console.log(`🗣️ Falando em [${langCode2}]: "${cleanText}"`);
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode2}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
  
  try {
    const resource = createAudioResource(ttsUrl);
    currentConnection.subscribe(audioPlayer);
    audioPlayer.play(resource);
    return true;
  } catch (err) {
    console.error("❌ Falha de injeção de áudio:", err);
    return false;
  }
}

// ========================================================
// 🎧 GERENCIADOR DE CALL
// ========================================================
async function joinVoice(guildExplicit) {
  try {
    if (!VOICE_CHANNEL_ID || currentConnection) return;

    let guild = guildExplicit;
    if (!guild) {
      const guilds = await client.guilds.fetch();
      const guildPreview = guilds.first();
      if (!guildPreview) return;
      guild = await guildPreview.fetch();
    }

    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
    if (!channel) return;

    currentConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false, 
    });

    currentConnection.subscribe(audioPlayer);
    currentConnection.on('destroy', () => { currentConnection = null; });
    currentConnection.on('disconnect', () => { currentConnection = null; });
  } catch (err) {
    console.error("❌ ERRO AO ENTRAR:", err);
    currentConnection = null;
  }
}

// ========================================================
// 🤖 MOTOR GROQ (IA)
// ========================================================
async function askAI(message, promptText) {
  try {
    await message.channel.sendTyping();

    const userId = message.author.id;
    if (!userMemory.has(userId)) userMemory.set(userId, []);
    const history = userMemory.get(userId);

    history.push({ role: "user", content: `[${message.author.username} pergunta]: ${promptText}` });

    const messages = [{ role: "system", content: SYSTEM }, ...history];

    const res = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant", 
      messages: messages,
      max_tokens: 60
    });

    const reply = res.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    if (history.length > MAX_MEMORY_LEN) {
      history.splice(0, 2); 
    }

    return reply;
  } catch (err) {
    console.error("Groq AI error:", err?.message);
    return null;
  }
}

// ========================================================
// 💬 GERENCIADOR DE MENSAGENS E COMANDOS
// ========================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const originalMsg = message.content;
  const msgLower = originalMsg.toLowerCase();
  const userId = message.author.id;

  // Comandos absolutos (não sofrem trava)
  if (msgLower === "!entrar") {
    userDisconnected = false; 
    await joinVoice(message.guild);
    return message.reply("Entrei. Espero que tenha um bom motivo para me chamar.");
  }

  if (msgLower === "!sair") {
    userDisconnected = true; 
    if (currentConnection) {
      currentConnection.destroy();
      currentConnection = null;
    }
    return message.reply("Finalmente paz e silêncio. Fui.");
  }

  // Easter Eggs arrogantes
  if (msgLower === "oi") return message.reply("O que você quer?");
  if (msgLower === "te amo") return message.reply("Problema seu. Vai se tratar.");

  // 🔒 CADEADO: Se o bot já está processando algo desse usuário, ignora mensagens novas
  if (processingLocks.has(userId)) return;

  let forceVoice = false;
  let textToAI = originalMsg;

  if (msgLower.startsWith("!asap ")) {
    forceVoice = true;
    textToAI = originalMsg.slice(6); 
  } else {
    // Modo preguiça (70% de ignorar)
    if (chance(0.70)) return; 
  }

  // Tranca o processamento para este usuário
  processingLocks.add(userId);

  try {
    const aiResponse = await askAI(message, textToAI);
    if (!aiResponse) return;

    if (currentConnection && (forceVoice || chance(0.60))) {
      speakInVoice(aiResponse);
      try { await message.react("🎧"); } catch(e){}
    } else {
      await message.reply(aiResponse);
    }
  } finally {
    // 🔓 DESTranca o processamento não importa o que aconteça
    processingLocks.delete(userId);
  }
});

// ========================================================
// 🚀 INICIALIZAÇÃO & PROTEÇÃO DE QUEDA
// ========================================================
client.once("ready", () => {
  console.log(`🤖 Arrogância ativada como ${client.user.tag}`);
  setTimeout(() => { joinVoice(); }, 3000);
});

setInterval(() => {
  if (!currentConnection && VOICE_CHANNEL_ID && !userDisconnected) {
    joinVoice();
  }
}, 30000);

// Previne que o bot crashe o Render caso dê algum erro bizarro do Discord
process.on('unhandledRejection', error => console.error('Erros isolados contidos:', error));

client.login(process.env.DISCORD_TOKEN);